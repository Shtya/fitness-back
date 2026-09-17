import {
	ExecutionContext,
	Injectable,
	UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { verifyMediaToken } from '../utils/whatsapp-media-signed-url';

/**
 * The resource a signed token must be bound to, derived from the route.
 *
 * One story draft holds several clips, so the draft id alone is not specific enough:
 * a token for part 1 must not read part 2. Every other signed route addresses a
 * single object and uses its id as-is.
 */
function signedResourceId(params: Record<string, unknown> | undefined): string {
	const draftId = String(params?.draftId || '');
	if (draftId) return `${draftId}:${String(params?.index ?? '')}`;
	return String(params?.attachmentId || params?.downloadId || '');
}

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
			const parsed = verifyMediaToken(token, signedResourceId(request?.params));
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
