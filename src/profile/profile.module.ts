import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';
import { ProgressPhoto, BodyMeasurement } from 'entities/profile.entity';
import { User } from 'entities/global.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProgressPhoto, BodyMeasurement, User]),
  ],
  controllers: [ProfileController],
  providers: [ProfileService],
  exports: [ProfileService],
})
export class ProfileModule {}