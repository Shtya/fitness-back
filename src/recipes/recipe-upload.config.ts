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

export const recipeImageUploadOptions = {
  storage: diskStorage({
    destination: (req, file, cb) => {
      const uploadDir = join(process.cwd(), 'uploads', 'recipes');
      ensureDir(uploadDir);
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => cb(null, randomName(file.originalname, file.originalname)),
  }),
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|jpg|gif|webp|svg\+xml)$/.test(file.mimetype)) {
      return cb(null, true);
    }
    cb(new Error('Unsupported image type'), false);
  },
  limits: { fileSize: 10 * 1024 * 1024 },
};