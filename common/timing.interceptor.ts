import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

const SENSITIVE_QUERY_KEYS = /^(token|access_token|accesstoken|auth|key|signature|sig|password|code)$/i;

export function redactQuery(url: string): string {
  const value = String(url || '');
  const index = value.indexOf('?');
  if (index < 0) return value;
  const path = value.slice(0, index);
  const params = value
    .slice(index + 1)
    .split('&')
    .filter(Boolean)
    .map((pair) => {
      const name = pair.split('=')[0];
      let decoded = name;
      try {
        decoded = decodeURIComponent(name);
      } catch {
        /* keep raw name */
      }
      return SENSITIVE_QUERY_KEYS.test(decoded) ? `${name}=[redacted]` : pair;
    });
  return params.length ? `${path}?${params.join('&')}` : path;
}

@Injectable()
export class TimingInterceptor implements NestInterceptor {
  intercept(context, next) {
    const start = Date.now();

    const request = context.switchToHttp().getRequest();
    const method = request.method;
    // Media links carry a signed ?token=…; never write tokens or other query values to the log.
    const url = redactQuery(request.originalUrl || request.url);

    return next.handle().pipe(
      tap(() => {
        const end = Date.now();
        const time = end - start;

        console.log(`⏱️ [${method}] ${url} → ${time}ms`);
      })
    );
  }
}
