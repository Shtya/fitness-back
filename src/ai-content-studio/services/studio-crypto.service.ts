import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type StudioSecretsPayload = {
  gemini?: { apiKey?: string };
  groq?: { apiKey?: string };
  cloudflare?: { accountId?: string; apiToken?: string };
  huggingface?: { apiKey?: string; hfProvider?: string };
  openai_compatible?: { apiKey?: string; baseUrl?: string };
  comfyui?: { baseUrl?: string; checkpoint?: string };
  custom?: { apiKey?: string; baseUrl?: string };
  facebook?: { pageId?: string; accessToken?: string };
  instagram?: { igUserId?: string; accessToken?: string };
  [key: string]: Record<string, string | undefined> | undefined;
};

@Injectable()
export class StudioCryptoService {
  constructor(private readonly config: ConfigService) {}

  encryptionKey() {
    const dedicated = this.config.get<string>('AI_CONTENT_STUDIO_ENCRYPTION_KEY')?.trim();
    if (dedicated) {
      const key = Buffer.from(dedicated, 'base64');
      if (key.length !== 32) {
        throw new Error('AI_CONTENT_STUDIO_ENCRYPTION_KEY must decode to 32 bytes');
      }
      return key;
    }
    const jwtSecret = this.config.get<string>('JWT_SECRET') || 'so7bafit-dev-secret';
    return createHash('sha256')
      .update(`so7bafit:ai-content-studio-secrets:${jwtSecret}`)
      .digest();
  }

  encrypt(payload: StudioSecretsPayload): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey(), iv);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(payload), 'utf8'),
      cipher.final(),
    ]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
  }

  decrypt(encoded: string): StudioSecretsPayload {
    const payload = Buffer.from(encoded, 'base64');
    const iv = payload.subarray(0, 12);
    const tag = payload.subarray(12, 28);
    const ciphertext = payload.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey(), iv);
    decipher.setAuthTag(tag);
    return JSON.parse(
      Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'),
    ) as StudioSecretsPayload;
  }

  maskSecret(value: string | null | undefined): string | null {
    if (!value) return null;
    if (value.length <= 4) return '••••';
    return `••••••••${value.slice(-4)}`;
  }
}
