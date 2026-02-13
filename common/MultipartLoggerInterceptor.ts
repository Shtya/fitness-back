import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import * as util from 'util';

@Injectable()
export class MultipartLoggerInterceptor implements NestInterceptor {
  private readonly logger = new Logger('MULTIPART');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest(); 
    const body = req.body ?? {};
    let clonedBody: any = { ...body };

    // Parse answers if it’s JSON string
    if (typeof clonedBody.answers === 'string') {
      try {
        clonedBody.answers = JSON.parse(clonedBody.answers);
      } catch (e) {
        clonedBody.answers = {
          _parseError: 'answers is not valid JSON',
          raw: clonedBody.answers,
        };
      }
    }

    // Optional: shorten huge strings (to avoid spam logs)
    clonedBody = this.shortenLargeValues(clonedBody);

    this.logger.log('📦 req.body (pretty):');
    console.log(
      util.inspect(clonedBody, {
        depth: 10,
        colors: true,
        maxArrayLength: 200,
        maxStringLength: 5000, // increase if you want
        compact: false,
      }),
    );

    // ---- Pretty print req.files ----
    const files = req.files || [];
    this.logger.log(`📎 req.files count: ${files.length}`);

    if (files.length > 0) {
      console.log(
        util.inspect(
          files.map((f: any) => ({
            fieldname: f.fieldname,
            originalname: f.originalname,
            mimetype: f.mimetype,
            size: f.size,
            filename: f.filename,
            path: f.path,
          })),
          {
            depth: 5,
            colors: true,
            maxArrayLength: 200,
            compact: false,
          },
        ),
      );
    }

    return next.handle();
  }

  private shortenLargeValues(obj: any) {
    if (!obj || typeof obj !== 'object') return obj;

    const out: any = Array.isArray(obj) ? [] : {};
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string' && v.length > 2000) {
        out[k] = `${v.slice(0, 2000)}... [truncated ${v.length - 2000} chars]`;
      } else if (Array.isArray(v) && v.length > 50) {
        out[k] = [...v.slice(0, 50), `... [truncated ${v.length - 50} items]`];
      } else if (v && typeof v === 'object') {
        out[k] = this.shortenLargeValues(v);
      } else {
        out[k] = v;
      }
    }
    return out;
  }
}
