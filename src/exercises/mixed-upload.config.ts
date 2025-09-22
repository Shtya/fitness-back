// src/plan-exercises/mixed-upload.config.ts
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}
function randName(original: string) {
  const ext = extname(original);
  const rand = Array(16)
    .fill(null)
    .map(() => Math.floor(Math.random() * 16).toString(16))
    .join('');
  return `${Date.now()}-${rand}${ext}`;
}

export const mixedUploadOptions = {
  storage: diskStorage({
    destination: (req, file, cb) => {
      const isImg = /^image\/(jpeg|png|jpg|gif|webp|svg\+xml)$/.test(file.mimetype);
      const isVid = /^video\/(mp4|quicktime|x-matroska|webm|x-msvideo)$/.test(file.mimetype);
      const dir = join(process.cwd(), 'uploads', isImg ? 'images' : isVid ? 'videos' : 'other');
      ensureDir(dir);
      cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, randName(file.originalname)),
  }),
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|jpg|gif|webp|svg\+xml)$/.test(file.mimetype) || /^video\/(mp4|quicktime|x-matroska|webm|x-msvideo)$/.test(file.mimetype)) return cb(null, true);
    return cb(new Error('Unsupported file type'), false);
  },
  limits: {
    fileSize: 200 * 1024 * 1024, // 200MB max (video)
  },
};
