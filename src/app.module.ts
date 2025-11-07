import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import * as path from 'path';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
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
import { SettingsModule } from './settings/settings.module';
import { AboutUserModule } from './about-user/about-user.module';
import { ReminderModule } from './reminder/reminder.module';
 
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

    AuthModule,
    AssetModule,
    PlansModule,
    PrsModule,
    PlansModule,
    ChatModule,
    FormModule,
    ExercisesModule,
    NotificationModule,
    NutritionModule,
    ProfileModule,
    WeeklyReportModule,
    StatsModule,
    SettingsModule,
    AboutUserModule,
    ReminderModule,
  ],
  controllers: [AppController],
  providers: [AppService, QueryFailedErrorFilter],
  exports: [],
})
export class AppModule {}
