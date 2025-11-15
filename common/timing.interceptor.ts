import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class TimingInterceptor implements NestInterceptor {
  intercept(context, next) {
    const start = Date.now();

    const request = context.switchToHttp().getRequest();
    const method = request.method;
    const url = request.originalUrl || request.url;

    return next.handle().pipe(
      tap(() => {
        const end = Date.now();
        const time = end - start;

        console.log(`⏱️ [${method}] ${url} → ${time}ms`);
      })
    );
  }
}
