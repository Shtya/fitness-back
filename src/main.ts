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

  app.useGlobalFilters(app.get(QueryFailedErrorFilter));
  app.useStaticAssets(join(__dirname, '..', '..', '/uploads'), { prefix: '/uploads/' });
  app.enableCors();
  // app.enableCors({
  // 	origin: (origin, callback) => {
  // 		const allowedOrigins = [
  // 			'http://localhost:3000',
  // 			'https://fitness-front-iin2.vercel.app',
  // 			'https://fitdashboard.vercel.app',
  // 		];
  // 		if (!origin || allowedOrigins.includes(origin)) {
  // 			callback(null, true);
  // 		} else {
  // 			callback(new Error('CORS not allowed for this origin'), false);
  // 		}
  // 	},
  // 	credentials: true,
  // 	methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  // 	allowedHeaders: ['Content-Type', 'Authorization', 'x-lang'],
  // 	exposedHeaders: ['Content-Length', 'Content-Range'],
  // });

  // app.enableCors({
  //   origin: '*',
  //   methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
  //   allowedHeaders: ['Content-Type', 'Authorization', 'x-lang'],
  //   exposedHeaders: ['Content-Length', 'Content-Range'],
  // });

  app.setGlobalPrefix('api/v1');

  const loggingValidationPipe = app.get(LoggingValidationPipe);
  app.useGlobalPipes(loggingValidationPipe);

  app.useGlobalPipes(new ValidationPipe({ disableErrorMessages: false, transform: true, forbidNonWhitelisted: true, whitelist: true }));

  Logger.log(`🚀 server is running on port ${port}`);

  await app.listen(port);
}
bootstrap();
