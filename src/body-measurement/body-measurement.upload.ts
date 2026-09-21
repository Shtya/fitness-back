import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { BadRequestException } from '@nestjs/common';

const ALLOWED = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];

function tempName(original: string) {
	const ext = extname(original || '').toLowerCase() || '.jpg';
	return `body-measure-${randomUUID()}${ext}`;
}

export const bodyMeasurementUploadOptions = {
	storage: diskStorage({
		destination: (_req, _file, cb) => cb(null, join(tmpdir())),
		filename: (_req, file, cb) => cb(null, tempName(file.originalname)),
	}),
	fileFilter: (_req, file, cb) => {
		if (ALLOWED.includes(file.mimetype)) return cb(null, true);
		return cb(new BadRequestException(`Invalid file type: ${file.mimetype}`), false);
	},
	limits: {
		fileSize: 8 * 1024 * 1024,
		files: 2,
	},
};
