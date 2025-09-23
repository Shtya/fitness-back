import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';
import { join } from 'path';
import { NestExpressApplication } from '@nestjs/platform-express';
import { LoggingValidationPipe } from 'common/translationPipe';
import { ConfigService } from '@nestjs/config';
import { QueryFailedErrorFilter } from 'common/QueryFailedErrorFilter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const port = process.env.PORT || 3030;
  // Get the ConfigService instance
  const configService = app.get(ConfigService);

  app.useGlobalFilters(app.get(QueryFailedErrorFilter));
  app.useStaticAssets(join(__dirname, '..', '..', '/uploads'), { prefix: '/uploads/' });
  const allowedOrigins = ['http://localhost:3000', 'https://fitness-front-iin2.vercel.app'];
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true); // للسماح بـ Postman وما شابه
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(`CORS blocked for origin: ${origin}`), false);
    },
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'x-lang'],
    exposedHeaders: ['Content-Length', 'Content-Range'],
  });

  app.setGlobalPrefix('api/v1');

  const loggingValidationPipe = app.get(LoggingValidationPipe);
  app.useGlobalPipes(loggingValidationPipe);

  app.useGlobalPipes(new ValidationPipe({ disableErrorMessages: false, transform: true, forbidNonWhitelisted: true, whitelist: true }));

  Logger.log(`🚀 server is running on port ${port}`);

  await app.listen(port);
}
bootstrap();
