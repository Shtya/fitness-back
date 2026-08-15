import { Injectable } from '@nestjs/common';
import {
  AIProvider,
  ImageGenerateInput,
  ImageGenerateResult,
  ProviderModelMeta,
  ValidateKeyResult,
  applyTemplate,
} from './ai-provider';
import { PROVIDER_REGISTRY } from './providers.registry';

@Injectable()
export class ComfyUIProvider implements AIProvider {
  readonly id = 'comfyui';
  readonly name = 'Local ComfyUI';
  readonly costTier = PROVIDER_REGISTRY.comfyui.costTier;
  readonly capabilities = {
    supportsText: false,
    supportsImage: true,
    supportsImageToImage: true,
    supportsAspectRatio: true,
    supportsNegativePrompt: true,
    supportsSeed: true,
    supportsResolution: true,
  };
  readonly apiKeyFields = ['baseUrl'];

  async getModels(): Promise<ProviderModelMeta[]> {
    return [];
  }

  private root(credentials: Record<string, string>) {
    return (credentials.baseUrl || 'http://127.0.0.1:8188').replace(/\/$/, '');
  }

  async validateKey(credentials: Record<string, string>): Promise<ValidateKeyResult> {
    const base = this.root(credentials);
    try {
      const res = await fetch(`${base}/system_stats`, { method: 'GET' });
      if (!res.ok) {
        return { ok: false, message: `ComfyUI HTTP ${res.status} at ${base}` };
      }
      return { ok: true, message: `Connected to ComfyUI at ${base}` };
    } catch (e: any) {
      return {
        ok: false,
        message: `Cannot reach ComfyUI at ${base}: ${e?.message || 'connection failed'}`,
      };
    }
  }

  private defaultWorkflow(prompt: string, checkpoint?: string) {
    return {
      '3': {
        class_type: 'KSampler',
        inputs: {
          seed: Math.floor(Math.random() * 1e9),
          steps: 20,
          cfg: 7,
          sampler_name: 'euler',
          scheduler: 'normal',
          denoise: 1,
          model: ['4', 0],
          positive: ['6', 0],
          negative: ['7', 0],
          latent_image: ['5', 0],
        },
      },
      '4': {
        class_type: 'CheckpointLoaderSimple',
        inputs: { ckpt_name: checkpoint || 'v1-5-pruned-emaonly.safetensors' },
      },
      '5': {
        class_type: 'EmptyLatentImage',
        inputs: { width: 1024, height: 1024, batch_size: 1 },
      },
      '6': {
        class_type: 'CLIPTextEncode',
        inputs: { text: prompt, clip: ['4', 1] },
      },
      '7': {
        class_type: 'CLIPTextEncode',
        inputs: { text: 'ugly, blurry, low quality, text, watermark', clip: ['4', 1] },
      },
      '8': {
        class_type: 'VAEDecode',
        inputs: { samples: ['3', 0], vae: ['4', 2] },
      },
      '9': {
        class_type: 'SaveImage',
        inputs: { filename_prefix: 'so7ba_studio', images: ['8', 0] },
      },
    };
  }

  private injectPrompt(workflow: any, prompt: string, negative?: string, checkpoint?: string) {
    const clone = JSON.parse(JSON.stringify(workflow));
    for (const node of Object.values(clone) as any[]) {
      if (node?.class_type === 'CLIPTextEncode' && node.inputs) {
        const text = String(node.inputs.text || '');
        if (/negative|ugly|blurry/i.test(text) && negative) {
          node.inputs.text = negative;
        } else if (text.includes('{{prompt}}')) {
          node.inputs.text = applyTemplate(text, { prompt });
        } else if (!/negative|ugly|blurry/i.test(text)) {
          node.inputs.text = prompt;
        }
      }
      if (node?.class_type === 'CheckpointLoaderSimple' && checkpoint && node.inputs) {
        node.inputs.ckpt_name = checkpoint;
      }
    }
    return clone;
  }

  async generateImage(input: ImageGenerateInput): Promise<ImageGenerateResult> {
    const base = this.root(input.credentials);
    const checkpoint = input.credentials.checkpoint;
    let workflow: any;
    if (input.custom?.workflowJson) {
      try {
        workflow = this.injectPrompt(
          JSON.parse(input.custom.workflowJson),
          input.prompt,
          input.negativePrompt,
          checkpoint,
        );
      } catch {
        throw Object.assign(new Error('Invalid ComfyUI Workflow JSON'), {
          status: 400,
          code: 'INVALID_WORKFLOW',
          provider: 'comfyui',
        });
      }
    } else {
      workflow = this.defaultWorkflow(input.prompt, checkpoint);
    }

    const queueRes = await fetch(`${base}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow }),
    });
    const queueRaw = await queueRes.json().catch(() => ({}));
    if (!queueRes.ok) {
      throw Object.assign(
        new Error((queueRaw as any)?.error || `ComfyUI queue HTTP ${queueRes.status}`),
        { status: queueRes.status, code: 'COMFY_QUEUE_ERROR', provider: 'comfyui', raw: queueRaw },
      );
    }
    const promptId = (queueRaw as any)?.prompt_id;
    if (!promptId) {
      throw Object.assign(new Error('ComfyUI did not return prompt_id'), {
        status: 502,
        code: 'NO_PROMPT_ID',
        provider: 'comfyui',
        raw: queueRaw,
      });
    }

    const started = Date.now();
    let imageMeta: { filename: string; subfolder: string; type: string } | null = null;
    while (Date.now() - started < 120000) {
      await new Promise((r) => setTimeout(r, 1500));
      const histRes = await fetch(`${base}/history/${promptId}`);
      if (!histRes.ok) continue;
      const hist = await histRes.json().catch(() => ({}));
      const entry = (hist as any)?.[promptId];
      if (!entry) continue;
      const outputs = entry.outputs || {};
      for (const nodeOut of Object.values(outputs) as any[]) {
        const img = nodeOut?.images?.[0];
        if (img?.filename) {
          imageMeta = {
            filename: img.filename,
            subfolder: img.subfolder || '',
            type: img.type || 'output',
          };
          break;
        }
      }
      if (imageMeta) break;
      if (entry.status?.completed === false && entry.status?.status_str === 'error') {
        throw Object.assign(new Error('ComfyUI workflow failed'), {
          status: 502,
          code: 'COMFY_FAILED',
          provider: 'comfyui',
          raw: entry,
        });
      }
    }

    if (!imageMeta) {
      throw Object.assign(new Error('ComfyUI timed out waiting for image'), {
        status: 504,
        code: 'COMFY_TIMEOUT',
        provider: 'comfyui',
      });
    }

    const viewUrl = `${base}/view?filename=${encodeURIComponent(imageMeta.filename)}&subfolder=${encodeURIComponent(imageMeta.subfolder)}&type=${encodeURIComponent(imageMeta.type)}`;
    const imgRes = await fetch(viewUrl);
    if (!imgRes.ok) {
      throw Object.assign(new Error(`ComfyUI view HTTP ${imgRes.status}`), {
        status: imgRes.status,
        code: 'COMFY_VIEW_ERROR',
        provider: 'comfyui',
      });
    }
    const buf = Buffer.from(await imgRes.arrayBuffer());
    const mime = imgRes.headers.get('content-type') || 'image/png';
    return {
      imageUrl: `data:${mime};base64,${buf.toString('base64')}`,
      mimeType: mime,
      model: checkpoint || 'comfyui-workflow',
      raw: { promptId, imageMeta },
    };
  }
}
