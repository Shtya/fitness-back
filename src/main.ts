import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';
import { join } from 'path';
import { NestExpressApplication } from '@nestjs/platform-express';
import { QueryFailedErrorFilter } from 'common/QueryFailedErrorFilter';
import { TimingInterceptor } from 'common/timing.interceptor';
import {
  createCorsOriginDelegate,
  resolveCorsOrigins,
} from 'common/cors-origins';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Interceptors / filters
  app.useGlobalInterceptors(new TimingInterceptor());
  app.useGlobalFilters(app.get(QueryFailedErrorFilter));

  // WhatsApp media is private and must only be served by guarded controllers.
  // Keep this deny route before the generic public uploads mount for legacy files.
  app.use('/uploads/whatsapp-media', (_req, res) => res.sendStatus(404));

  // Public application assets only.
  app.useStaticAssets(join(__dirname, '..', '..', 'uploads'), {
    prefix: '/uploads/',
  });

  // CORS + global prefix + validation
  // Must allow Authorization preflight from the Vercel frontend (so7bafit.com)
  // to the API host (api.so7bafit.com). Do not use origin:"*" with credentials.
  const allowedOrigins = resolveCorsOrigins();
  app.enableCors({
    origin: createCorsOriginDelegate(allowedOrigins),
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'Accept',
      'Origin',
      'X-Requested-With',
      'X-Lang',
      'X-Request-Id',
    ],
    exposedHeaders: ['Content-Disposition'],
    optionsSuccessStatus: 204,
    preflightContinue: false,
    maxAge: 86400,
  });
  Logger.log(`CORS origins: ${allowedOrigins.join(', ')}`, 'Bootstrap');
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      disableErrorMessages: false,
      transform: true,
      forbidNonWhitelisted: true,
      whitelist: true,
    }),
  );

  const port = process.env.PORT || 3030;

  // VPS / PM2: we ALWAYS listen here
  await app.listen(port as number, '0.0.0.0');
  Logger.log(`🚀 Server is running on http://localhost:${port}/api/v1`, 'Bootstrap');
}

bootstrap();



