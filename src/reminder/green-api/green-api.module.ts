// src/modules/green-api/green-api.module.ts
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { GreenApiService } from './green-api.service';
import { GreenApiController } from './green-api.controller';

@Module({
  imports: [HttpModule],
  controllers: [GreenApiController],
  providers: [GreenApiService],
  exports: [GreenApiService],
})
export class GreenApiModule {}