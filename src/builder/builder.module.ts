import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BuilderProject } from 'entities/builder.entity';
import { BuilderService } from './builder.service';
import { BuilderController } from './builder.controller';

@Module({
  imports: [TypeOrmModule.forFeature([BuilderProject])],
  controllers: [BuilderController],
  providers: [BuilderService],
})
export class BuilderModule {}
