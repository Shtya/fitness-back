// src/plan-exercises/upload.config.ts
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function randomName(base: string, original: string) {
  const name = base.replace(/\.[^/.]+$/, '');
  const extension = extname(original);
  const rand = Array(16)
    .fill(null)
    .map(() => Math.floor(Math.random() * 16).toString(16))
    .join('');
  return `${name}-${rand}${extension}`;
}

export const imageUploadOptions = {
  storage: diskStorage({
    destination: (req, file, cb) => {
      const uploadDir = join(process.cwd(), 'uploads', 'images');
      ensureDir(uploadDir);
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => cb(null, randomName(file.originalname, file.originalname)),
  }),
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|jpg|gif|webp|svg\+xml)$/.test(file.mimetype)) return cb(null, true);
    cb(new Error('Unsupported image type'), false);
  },
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
};

export const videoUploadOptions = {
  storage: diskStorage({
    destination: (req, file, cb) => {
      const uploadDir = join(process.cwd(), 'uploads', 'videos');
      ensureDir(uploadDir);
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => cb(null, randomName(file.originalname, file.originalname)),
  }),
  fileFilter: (req, file, cb) => {
    if (/^video\/(mp4|quicktime|x-matroska|webm|x-msvideo)$/.test(file.mimetype)) return cb(null, true);
    cb(new Error('Unsupported video type'), false);
  },
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB
};
