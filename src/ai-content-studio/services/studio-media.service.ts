import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

@Injectable()
export class StudioMediaService {
  constructor(private readonly config: ConfigService) {}

  private uploadRoot() {
    const root =
      this.config.get('AI_CONTENT_STUDIO_UPLOAD_DIR') ||
      path.join(process.cwd(), 'uploads', 'ai-content-studio');
    fs.mkdirSync(root, { recursive: true });
    return root;
  }

  publicBaseUrl() {
    return (
      this.config.get('AI_CONTENT_STUDIO_PUBLIC_BASE_URL') ||
      this.config.get('META_WHATSAPP_PUBLIC_API_URL') ||
      this.config.get('PUBLIC_API_URL') ||
      ''
    ).replace(/\/$/, '');
  }

  async persistDataUrl(dataUrl: string, userId: string): Promise<{ filePath: string; publicUrl: string | null; mimeType: string }> {
    const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl);
    if (!match) {
      // Already a remote URL
      return { filePath: '', publicUrl: dataUrl, mimeType: 'image/jpeg' };
    }
    const mimeType = match[1];
    const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
    const filename = `${userId}-${Date.now()}-${randomUUID()}.${ext}`;
    const filePath = path.join(this.uploadRoot(), filename);
    fs.writeFileSync(filePath, Buffer.from(match[2], 'base64'));
    const base = this.publicBaseUrl();
    const publicUrl = base
      ? `${base}/api/v1/ai-content-studio/media/${filename}`
      : null;
    return { filePath, publicUrl, mimeType };
  }

  readFile(filename: string): { buffer: Buffer; mimeType: string } | null {
    if (!/^[a-zA-Z0-9._-]+$/.test(filename)) return null;
    const filePath = path.join(this.uploadRoot(), filename);
    if (!fs.existsSync(filePath)) return null;
    const ext = path.extname(filename).toLowerCase();
    const mimeType =
      ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    return { buffer: fs.readFileSync(filePath), mimeType };
  }
}
