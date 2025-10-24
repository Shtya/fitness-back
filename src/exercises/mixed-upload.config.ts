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
      const isImg = /^image\/(jpeg|png|jpg|gif|webp|svg\+xml)$/i.test(file.mimetype);
      const isVid = /^video\/(mp4|quicktime|x-matroska|webm|x-msvideo)$/i.test(file.mimetype);

      let dir: string;
      if (isImg) {
        dir = join(process.cwd(), 'uploads', 'images', 'progress-photos');
      } else if (isVid) {
        dir = join(process.cwd(), 'uploads', 'videos');
      } else {
        dir = join(process.cwd(), 'uploads', 'other');
      }

      ensureDir(dir);
      cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, randName(file.originalname)),
  }),
  fileFilter: (req, file, cb) => {
    // Allow only images for progress photos
    if (/^image\/(jpeg|png|jpg|gif|webp|svg\+xml)$/i.test(file.mimetype)) {
      return cb(null, true);
    }
    return cb(new Error(`Unsupported file type: ${file.mimetype}. Only images are allowed for progress photos.`), false);
  },
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max for images (reduced from 200MB since we only need images)
  },
};

// Separate configuration for profile photos with more specific settings
export const profilePhotoUploadOptions = {
  storage: diskStorage({
    destination: (req, file, cb) => {
      const dir = join(process.cwd(), 'uploads', 'images', 'progress-photos');
      ensureDir(dir);
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      // Include user ID and side in filename for better organization
      const userId = req.user?.id || 'unknown';
      const side = file.fieldname || 'unknown';
      const ext = extname(file.originalname);
      const rand = Array(8)
        .fill(null)
        .map(() => Math.floor(Math.random() * 16).toString(16))
        .join('');
      cb(null, `user-${userId}-${side}-${Date.now()}-${rand}${ext}`);
    },
  }),
  fileFilter: (req, file, cb) => {
    // Strict image validation for progress photos
    const allowedMimes = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];

    if (allowedMimes.includes(file.mimetype)) {
      return cb(null, true);
    }

    return cb(new Error(`Invalid file type: ${file.mimetype}. Only JPEG, PNG, JPG, and WebP images are allowed.`), false);
  },
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max per image
    files: 4, // Max 4 files (front, back, left, right)
  },
};

const IMG_RE = /^image\/(jpeg|png|jpg|gif|webp|svg\+xml|svg\+XML|svg\+Xml)$/i;
const VID_RE = /^(video\/(mp4|quicktime|x-matroska|webm|x-msvideo)|application\/octet-stream)$/i;

export const mixedUploadOptionsWorkouts = {
  storage: diskStorage({
    destination: (req, file, cb) => {
      const isImg = IMG_RE.test(file.mimetype) || file.fieldname === 'img';
      const isVid = VID_RE.test(file.mimetype) || file.fieldname === 'video';

      let dir: string;
      if (isImg) {
        dir = join(process.cwd(), 'uploads', 'images');
      } else if (isVid) {
        dir = join(process.cwd(), 'uploads', 'videos');
      } else {
        dir = join(process.cwd(), 'uploads', 'other');
      }

      ensureDir(dir);
      cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, randName(file.originalname)),
  }),
  fileFilter: (req, file, cb) => {
    // allow images on 'img' field, videos on 'video' field
    if (file.fieldname === 'img') {
      return IMG_RE.test(file.mimetype) ? cb(null, true) : cb(new Error(`Invalid image type: ${file.mimetype}`), false);
    }
    if (file.fieldname === 'video') {
      return VID_RE.test(file.mimetype) ? cb(null, true) : cb(new Error(`Invalid video type: ${file.mimetype}`), false);
    }
    return cb(new Error(`Unsupported field: ${file.fieldname}`), false);
  },
  // one global limit (applies to both); bump if you upload videos
  limits: {
    fileSize: 50 * 1024 * 1024, // e.g., 50MB to allow short videos
  },
};
