import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class MetaPublishService {
  constructor(private readonly config: ConfigService) {}

  private graphVersion() {
    return this.config.get('META_GRAPH_API_VERSION') || 'v21.0';
  }

  private graph(path: string) {
    return `https://graph.facebook.com/${this.graphVersion()}${path}`;
  }

  async testFacebook(pageId: string, accessToken: string) {
    if (!pageId || !accessToken) {
      return { ok: false, message: 'Not configured: Page ID or Access Token missing' };
    }
    const res = await fetch(
      this.graph(`/${pageId}?fields=id,name,access_token&access_token=${encodeURIComponent(accessToken)}`),
    );
    const raw = await res.json().catch(() => ({}));
    if (!res.ok || (raw as any)?.error) {
      return {
        ok: false,
        status: res.status,
        code: (raw as any)?.error?.code,
        message: (raw as any)?.error?.message || `Facebook HTTP ${res.status}`,
        raw,
      };
    }
    return { ok: true, message: `Connected to page ${(raw as any).name || pageId}`, page: raw };
  }

  async publishFacebookPhoto(opts: {
    pageId: string;
    accessToken: string;
    imageUrl?: string;
    imageBuffer?: Buffer;
    mimeType?: string;
    caption: string;
  }) {
    const { pageId, accessToken, caption } = opts;
    if (!pageId || !accessToken) {
      throw Object.assign(new Error('Facebook not configured'), {
        status: 400,
        code: 'NOT_CONFIGURED',
        module: 'facebook',
      });
    }

    if (opts.imageUrl && !opts.imageUrl.startsWith('data:')) {
      const form = new URLSearchParams();
      form.set('url', opts.imageUrl);
      form.set('caption', caption);
      form.set('access_token', accessToken);
      form.set('published', 'true');
      const res = await fetch(this.graph(`/${pageId}/photos`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      });
      const raw = await res.json().catch(() => ({}));
      if (!res.ok || (raw as any)?.error) {
        throw Object.assign(
          new Error((raw as any)?.error?.message || `Facebook publish HTTP ${res.status}`),
          {
            status: res.status,
            code: (raw as any)?.error?.code || 'FB_PUBLISH_ERROR',
            module: 'facebook',
            provider: 'facebook',
            raw,
          },
        );
      }
      return { postId: (raw as any).post_id || (raw as any).id, raw };
    }

    // multipart upload from buffer / data URL
    let buffer = opts.imageBuffer;
    let mime = opts.mimeType || 'image/jpeg';
    if (!buffer && opts.imageUrl?.startsWith('data:')) {
      const m = /^data:([^;]+);base64,(.+)$/s.exec(opts.imageUrl);
      if (!m) {
        throw Object.assign(new Error('Invalid image data URL'), {
          status: 400,
          code: 'INVALID_IMAGE',
          module: 'facebook',
        });
      }
      mime = m[1];
      buffer = Buffer.from(m[2], 'base64');
    }
    if (!buffer) {
      throw Object.assign(new Error('No image available for Facebook publish'), {
        status: 400,
        code: 'NO_IMAGE',
        module: 'facebook',
      });
    }

    const form = new FormData();
    form.append('caption', caption);
    form.append('access_token', accessToken);
    form.append('published', 'true');
    form.append('source', new Blob([new Uint8Array(buffer)], { type: mime }), 'post.jpg');

    const res = await fetch(this.graph(`/${pageId}/photos`), {
      method: 'POST',
      body: form as any,
    });
    const raw = await res.json().catch(() => ({}));
    if (!res.ok || (raw as any)?.error) {
      throw Object.assign(
        new Error((raw as any)?.error?.message || `Facebook publish HTTP ${res.status}`),
        {
          status: res.status,
          code: (raw as any)?.error?.code || 'FB_PUBLISH_ERROR',
          module: 'facebook',
          provider: 'facebook',
          raw,
        },
      );
    }
    return { postId: (raw as any).post_id || (raw as any).id, raw };
  }

  async testInstagram(igUserId: string, accessToken: string) {
    if (!igUserId || !accessToken) {
      return { ok: false, message: 'Not configured: Instagram Business Account ID or Access Token missing' };
    }
    const res = await fetch(
      this.graph(
        `/${igUserId}?fields=id,username,account_type,media_count&access_token=${encodeURIComponent(accessToken)}`,
      ),
    );
    const raw = await res.json().catch(() => ({}));
    if (!res.ok || (raw as any)?.error) {
      return {
        ok: false,
        status: res.status,
        code: (raw as any)?.error?.code,
        message: (raw as any)?.error?.message || `Instagram HTTP ${res.status}`,
        raw,
      };
    }
    const accountType = String((raw as any).account_type || '').toUpperCase();
    if (accountType && !['BUSINESS', 'CREATOR'].includes(accountType)) {
      return {
        ok: false,
        message: `Account type "${accountType}" is not a Professional (Business/Creator) account`,
        raw,
      };
    }
    return { ok: true, message: `Connected to @${(raw as any).username || igUserId}`, account: raw };
  }

  async publishInstagram(opts: {
    igUserId: string;
    accessToken: string;
    imageUrl: string;
    caption: string;
  }) {
    const { igUserId, accessToken, imageUrl, caption } = opts;
    if (!igUserId || !accessToken) {
      throw Object.assign(new Error('Instagram not configured'), {
        status: 400,
        code: 'NOT_CONFIGURED',
        module: 'instagram',
      });
    }
    if (!imageUrl || imageUrl.startsWith('data:')) {
      throw Object.assign(
        new Error(
          'Instagram requires a publicly reachable HTTPS image URL. Set AI_CONTENT_STUDIO_PUBLIC_BASE_URL and ensure media is accessible.',
        ),
        { status: 400, code: 'PUBLIC_URL_REQUIRED', module: 'instagram' },
      );
    }

    const createRes = await fetch(this.graph(`/${igUserId}/media`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        image_url: imageUrl,
        caption,
        access_token: accessToken,
      }).toString(),
    });
    const createRaw = await createRes.json().catch(() => ({}));
    if (!createRes.ok || (createRaw as any)?.error) {
      throw Object.assign(
        new Error((createRaw as any)?.error?.message || `IG container HTTP ${createRes.status}`),
        {
          status: createRes.status,
          code: (createRaw as any)?.error?.code || 'IG_CONTAINER_ERROR',
          module: 'instagram',
          provider: 'instagram',
          raw: createRaw,
        },
      );
    }
    const creationId = (createRaw as any).id;
    // Wait briefly for container ready
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const st = await fetch(
        this.graph(
          `/${creationId}?fields=status_code&access_token=${encodeURIComponent(accessToken)}`,
        ),
      );
      const stRaw = await st.json().catch(() => ({}));
      const code = (stRaw as any)?.status_code;
      if (code === 'FINISHED' || code === 'PUBLISHED') break;
      if (code === 'ERROR') {
        throw Object.assign(new Error('Instagram media container failed'), {
          status: 502,
          code: 'IG_CONTAINER_FAILED',
          module: 'instagram',
          raw: stRaw,
        });
      }
    }

    const pubRes = await fetch(this.graph(`/${igUserId}/media_publish`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        creation_id: creationId,
        access_token: accessToken,
      }).toString(),
    });
    const pubRaw = await pubRes.json().catch(() => ({}));
    if (!pubRes.ok || (pubRaw as any)?.error) {
      throw Object.assign(
        new Error((pubRaw as any)?.error?.message || `IG publish HTTP ${pubRes.status}`),
        {
          status: pubRes.status,
          code: (pubRaw as any)?.error?.code || 'IG_PUBLISH_ERROR',
          module: 'instagram',
          provider: 'instagram',
          raw: pubRaw,
        },
      );
    }
    return { mediaId: (pubRaw as any).id, creationId, raw: pubRaw };
  }
}
