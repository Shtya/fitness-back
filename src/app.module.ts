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
import { AssetModule } from './asset/asset.module';
import { PlansModule } from './plans/plans.module';
import { PrsModule } from './prs/prs.module';
 import { ChatModule } from './chat/chat.module';
import { FormModule } from './form/form.module';
import { NotificationModule } from './notification/notification.module';
import { NutritionModule } from './nutrition/nutrition.module';
import { ExercisesModule } from './exercises/exercises.module';
import { ProfileModule } from './profile/profile.module';
import { WeeklyReportModule } from './weekly-report/weekly-report.module';
import { StatsModule } from './stats/stats.module';

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
    AssetModule,
    PlansModule,
    PrsModule,
    PlansModule,
    ChatModule,
    FormModule,
		ExercisesModule ,
    NotificationModule,
    NutritionModule,
    ProfileModule,
    WeeklyReportModule,
    StatsModule,
  ],
  controllers: [AppController],
  providers: [AppService, LoggingValidationPipe, QueryFailedErrorFilter],
  exports: [LoggingValidationPipe],
})
export class AppModule {}
