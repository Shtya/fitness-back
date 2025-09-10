import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import * as path from 'path';
import { ConfigModule } from '@nestjs/config';
import { I18nModule, QueryResolver, HeaderResolver } from 'nestjs-i18n';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { LoggingValidationPipe } from 'common/translationPipe';
import { QueryFailedErrorFilter } from 'common/QueryFailedErrorFilter';
import { UsersModule } from './user/user.module';
import { AssetModule } from './asset/asset.module'; 
import { WorkoutsModule } from './workouts/workouts.module';
import { PlanningModule } from './planning/planning.module';
import { TrainingModule } from './training/training.module';
import { PlansModule } from './plans/plans.module';
import { PrsModule } from './prs/prs.module';

@Module({
  imports: [
    ConfigModule.forRoot(),

    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DATABASE_HOST,
      port: parseInt(process.env.DATABASE_PORT, 10),
      username: process.env.DATABASE_USER,
      password: process.env.DATABASE_PASSWORD,
      database: process.env.DATABASE_NAME,
      entities: [__dirname + '/../**/*.entity{.ts,.js}'],
      synchronize: true,
    }),

    // I18nModule with async configuration
    I18nModule.forRoot({
      fallbackLanguage: 'en',
      loaderOptions: {
        path: path.join(__dirname, '/../i18n/'),
        watch: true,
      },
      resolvers: [{ use: QueryResolver, options: ['lang'] }, new HeaderResolver(['x-lang'])],
    }),

    AuthModule,
    UsersModule,
    AssetModule,
    WorkoutsModule,
    PlanningModule,
    TrainingModule,
    PlansModule,
    PrsModule, 
  ],
  controllers: [AppController],
  providers: [AppService, LoggingValidationPipe, QueryFailedErrorFilter],
  exports: [LoggingValidationPipe],
})
export class AppModule {}
