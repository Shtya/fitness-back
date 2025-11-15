import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';
import { join } from 'path';
import { NestExpressApplication } from '@nestjs/platform-express';
import { QueryFailedErrorFilter } from 'common/QueryFailedErrorFilter';
import { ExpressAdapter } from '@nestjs/platform-express';
import * as express from 'express';
import { TimingInterceptor } from 'common/timing.interceptor';

// إنشاء تطبيق Express لاستخدامه مع Vercel
const server = express();

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, new ExpressAdapter(server));

  app.useGlobalInterceptors(new TimingInterceptor());
  app.useGlobalFilters(app.get(QueryFailedErrorFilter));
  app.useStaticAssets(join(__dirname, '..', '..', '/uploads'), {
    prefix: '/uploads/',
  });
  app.enableCors({});
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      disableErrorMessages: false,
      transform: true,
      forbidNonWhitelisted: true,
      whitelist: true,
    }),
  );

  await app.init();

  const port = process.env.PORT || 3030;

  if (process.env.VERCEL !== '1') {
    // await app.listen(port);
    await app.listen(port, '0.0.0.0');
    Logger.log(`🚀 Server is running locally on http://localhost:${port}`, 'Bootstrap');
  } else {
    Logger.log(`🚀 NestJS initialized for Vercel (no listen, managed port: ${port})`, 'Bootstrap');
  }

  return app;
}

const appPromise = bootstrap();

export default async (req: express.Request, res: express.Response) => {
  try {
    const app = await appPromise;
    const expressInstance = app.getHttpAdapter().getInstance();
    return expressInstance(req, res);
  } catch (error) {
    Logger.error('Error handling request:', error);
    res.status(500).json({
      message: 'Internal server error',
      error: error.message,
    });
  }
};
