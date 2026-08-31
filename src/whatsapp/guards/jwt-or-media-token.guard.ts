import {
	ExecutionContext,
	Injectable,
	UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { verifyMediaToken } from '../utils/whatsapp-media-signed-url';

@Injectable()
export class JwtOrMediaTokenGuard extends AuthGuard('jwt') {
	canActivate(ctx: ExecutionContext) {
		const request = ctx.switchToHttp().getRequest<{
			method?: string;
			query?: Record<string, unknown>;
			params?: Record<string, unknown>;
			user?: { id: string };
			waMediaToken?: boolean;
		}>();
		if (String(request?.method || '').toUpperCase() === 'OPTIONS') {
			return true;
		}
		const token = String(request?.query?.token || '');
		if (token) {
			const attachmentId = String(request?.params?.attachmentId || '');
			const parsed = verifyMediaToken(token, attachmentId);
			if (!parsed) {
				throw new UnauthorizedException('Invalid or expired media token');
			}
			request.user = { id: parsed.userId };
			request.waMediaToken = true;
			return true;
		}
		return super.canActivate(ctx);
	}

	handleRequest(err: any, user: any) {
		if (err || !user) {
			throw err || new UnauthorizedException('Authentication failed');
		}
		return user;
	}
}
