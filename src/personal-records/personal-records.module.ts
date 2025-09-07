import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PersonalRecordsService } from './personal-records.service';
import { PersonalRecordsController } from './personal-records.controller';
import { PersonalRecord, PersonalRecordAttempt, User } from 'entities/global.entity';

@Module({
  imports: [TypeOrmModule.forFeature([PersonalRecord, PersonalRecordAttempt, User])],
  providers: [PersonalRecordsService],
  controllers: [PersonalRecordsController],
  exports: [PersonalRecordsService],
})
export class PersonalRecordsModule {}
