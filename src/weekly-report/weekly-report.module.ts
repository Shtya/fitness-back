// weekly-report/weekly-report.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WeeklyReport } from 'entities/weekly-report.entity';
import { User } from 'entities/global.entity';
import { WeeklyReportService } from './weekly-report.service';
import { WeeklyReportController } from './weekly-report.controller';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([WeeklyReport, User]),
    NotificationModule,
  ],
  providers: [WeeklyReportService],
  controllers: [WeeklyReportController],
  exports: [WeeklyReportService],
})
export class WeeklyReportModule {}
