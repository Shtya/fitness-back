import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';
import { join } from 'path';
import { json, urlencoded } from 'express';
import { NestExpressApplication } from '@nestjs/platform-express';
import { QueryFailedErrorFilter } from 'common/QueryFailedErrorFilter';
import { TimingInterceptor } from 'common/timing.interceptor';
import { sharedDatabaseWarnings } from 'common/runtime-isolation';
import { resolveLogLevels } from 'common/log-levels';
import { corsAllowlistWarning, corsOriginDelegate } from 'common/cors-origin';
import { authAttemptLimiter, securityHeaders } from 'common/security-headers';

async function bootstrap() {
  // rawBody required for Meta webhook X-Hub-Signature-256 verification
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
    // Disable Nest's default 100kb parser — learning roadmap saves need a higher limit.
    bodyParser: false,
    logger: resolveLogLevels(),
  });
  // Re-resolve after ConfigModule has loaded .env.
  app.useLogger(resolveLogLevels());

  app.disable('x-powered-by');
  // Only the local nginx may set X-Forwarded-*; direct clients cannot spoof req.ip / req.secure.
  app.set('trust proxy', 'loopback');
  app.use(securityHeaders());

  // Explicit Express parsers (Nest useBodyParser was still leaving the default limit in place).
  app.use(
    json({
      limit: '25mb',
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use(urlencoded({ extended: true, limit: '25mb' }));

  // Interceptors / filters
  app.useGlobalInterceptors(new TimingInterceptor());
  app.useGlobalFilters(app.get(QueryFailedErrorFilter));

  // CORS must run before static /uploads so canvas capture (html-to-image) can
  // fetch avatars cross-origin. Static middleware otherwise answers first with no ACAO.
  app.enableCors({
    origin: corsOriginDelegate(),
    credentials: true,
  });

  app.use(
    ['/api/v1/auth/login', '/api/v1/auth/forgot-password', '/api/v1/auth/reset-password'],
    authAttemptLimiter({ windowMs: 15 * 60_000, max: 20 }),
  );

  // WhatsApp / Meta media is private and must only be served by guarded controllers.
  app.use('/uploads/whatsapp-media', (_req, res) => res.sendStatus(404));
  app.use('/uploads/meta-whatsapp-media', (_req, res) => res.sendStatus(404));

  // Public application assets only.
  app.useStaticAssets(join(__dirname, '..', '..', 'uploads'), {
    prefix: '/uploads/',
    setHeaders: (res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    },
  });

  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      disableErrorMessages: false,
      transform: true,
      forbidNonWhitelisted: true,
      whitelist: true,
    }),
  );

  // Without this, onApplicationShutdown never runs and the WhatsApp Chromium
  // profile is killed mid-write on every restart, which burns the linked-device
  // session and forces a new QR scan.
  app.enableShutdownHooks();

  const port = process.env.PORT || 3030;

  // VPS / PM2: we ALWAYS listen here
  await app.listen(port as number, '0.0.0.0');
  Logger.log(`🚀 Server is running on http://localhost:${port}/api/v1`, 'Bootstrap');
  for (const warning of sharedDatabaseWarnings()) Logger.warn(warning, 'RuntimeIsolation');
  const corsWarning = corsAllowlistWarning();
  if (corsWarning) Logger.warn(corsWarning, 'CORS');
}

bootstrap();
