import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class LoggerMiddleware implements NestMiddleware {
	private readonly logger = new Logger('HTTP');

	use(req: Request, res: Response, next: NextFunction) {
		const { method, originalUrl, protocol, hostname, ip, headers, query, params } = req;
		const userAgent = headers['user-agent'] || '';
		const authorization = headers['authorization'] || '';

		// Log complete URL for Postman testing
		const fullUrl = `${protocol}://${hostname}:${process.env.PORT || 5010}${originalUrl}`;

		this.logger.log(`═══════════════════════════════════════════════════════════════════`);
		this.logger.log(`[${method}] ${fullUrl}`);
		if (authorization) this.logger.log(`${authorization}`);


		if (query && Object.keys(query).length > 0) {
			this.logger.log(`Query Params: ${JSON.stringify(query)}`);
		}

		// Fix: Check if params exists before using Object.keys
		if (params && Object.keys(params).length > 0) {
			this.logger.log(`Route Params: ${JSON.stringify(params)}`);
		}




		if (['POST', 'PATCH', 'PUT'].includes(method)) {

			// 👇 ADD THIS FIRST (for files)
			if ((req as any).file) {
				this.logger.log('📎 Uploaded File:');
				console.log({
					fieldname: (req as any).file.fieldname,
					originalname: (req as any).file.originalname,
					mimetype: (req as any).file.mimetype,
					size: (req as any).file.size,
				});
			}

			if ((req as any).files) {
				this.logger.log('📎 Uploaded Files:');
				console.log((req as any).files);
			}

			// Existing body logging
			if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
				this.logger.log(`📦 REQUEST BODY (RAW - NOT HIDDEN):`);
				console.log(JSON.stringify(req.body, null, 2));
			} else if (req.body && typeof req.body === 'object' && Object.keys(req.body).length === 0) {
				this.logger.log(`📦 REQUEST BODY: Empty object {}`);
			} else if (req.body) {
				this.logger.log(`📦 REQUEST BODY: ${JSON.stringify(req.body)}`);
			} else {
				this.logger.log(`📦 REQUEST BODY: No body or body is null/undefined`);
			}
		}


		// Log response details when finished
		const start = Date.now();
		res.on('finish', () => {
			const duration = Date.now() - start;
			const { statusCode, statusMessage } = res;
			const contentLength = res.get('content-length') || '0';

			// Color code based on status
			let statusEmoji = '✅';
			if (statusCode >= 400 && statusCode < 500) statusEmoji = '⚠️';
			if (statusCode >= 500) statusEmoji = '❌';

			this.logger.log(`${statusEmoji} RESPONSE: ${statusCode} ${statusMessage} | Time: ${duration}ms | Size: ${contentLength} bytes`);
			this.logger.log(`═══════════════════════════════════════════════════════════════════`);
		});

		next();
	}
}