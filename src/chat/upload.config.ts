// src/chat/upload.config.ts
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function randomName(original: string) {
  const extension = extname(original || '') || '.png';
  const safeExt = /^\.[a-z0-9]{1,8}$/i.test(extension) ? extension.toLowerCase() : '.png';
  const rand = Array(16)
    .fill(null)
    .map(() => Math.floor(Math.random() * 16).toString(16))
    .join('');
  return `img-${Date.now()}-${rand}${safeExt}`;
}

export const chatImageUploadOptions = {
  storage: diskStorage({
    destination: (req, file, cb) => {
      const uploadDir = join(process.cwd(), 'uploads', 'chat', 'images');
      ensureDir(uploadDir);
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => cb(null, randomName(file.originalname)),
  }),
  fileFilter: (req, file, cb) => {
    const mime = String(file?.mimetype || '').toLowerCase();
    if (
      mime.startsWith('image/') ||
      mime === 'application/octet-stream' ||
      /^image\/(jpeg|png|jpg|gif|webp|bmp|avif|heic|heif|svg\+xml)$/.test(mime)
    ) {
      return cb(null, true);
    }
    cb(null, false);
  },
  limits: { fileSize: 12 * 1024 * 1024 }, // 12MB
};

export const chatVideoUploadOptions = {
  storage: diskStorage({
    destination: (req, file, cb) => {
      const uploadDir = join(process.cwd(), 'uploads', 'chat', 'videos');
      ensureDir(uploadDir);
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => cb(null, randomName(file.originalname)),
  }),
  fileFilter: (req, file, cb) => {
    if (/^video\/(mp4|quicktime|x-matroska|webm|x-msvideo)$/.test(file.mimetype)) return cb(null, true);
    cb(new Error('Unsupported video type'), false);
  },
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
};

export const chatFileUploadOptions = {
  storage: diskStorage({
    destination: (req, file, cb) => {
      const uploadDir = join(process.cwd(), 'uploads', 'chat', 'files');
      ensureDir(uploadDir);
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => cb(null, randomName(file.originalname)),
  }),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
};
