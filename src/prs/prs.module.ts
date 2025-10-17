import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExerciseRecord, User } from 'entities/global.entity';
import { PrsService } from './prs.service';
import { PrsController } from './prs.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ExerciseRecord, User])],
  controllers: [PrsController],
  providers: [PrsService],
})
export class PrsModule {}
