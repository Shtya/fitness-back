import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';
import { join } from 'path';
import { NestExpressApplication } from '@nestjs/platform-express';
import { QueryFailedErrorFilter } from 'common/QueryFailedErrorFilter';
import { TimingInterceptor } from 'common/timing.interceptor';

async function bootstrap() {
  // rawBody required for Meta webhook X-Hub-Signature-256 verification
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });

  // Interceptors / filters
  app.useGlobalInterceptors(new TimingInterceptor());
  app.useGlobalFilters(app.get(QueryFailedErrorFilter));

  // WhatsApp / Meta media is private and must only be served by guarded controllers.
  app.use('/uploads/whatsapp-media', (_req, res) => res.sendStatus(404));
  app.use('/uploads/meta-whatsapp-media', (_req, res) => res.sendStatus(404));

  // Public application assets only.
  app.useStaticAssets(join(__dirname, '..', '..', 'uploads'), {
    prefix: '/uploads/',
  });

  // Allow any browser origin (reflect request Origin; works with credentials).
  app.enableCors({
    origin: true,
    credentials: true,
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

  const port = process.env.PORT || 3030;

  // VPS / PM2: we ALWAYS listen here
  await app.listen(port as number, '0.0.0.0');
  Logger.log(`🚀 Server is running on http://localhost:${port}/api/v1`, 'Bootstrap');
}

bootstrap();
