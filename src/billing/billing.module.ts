// src/modules/billing/billing.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  BillingInvoice,
  BillingPlan,
  PaymentTransaction,
  UserSubscription,
} from '../../entities/billing.entity';
import { User } from '../../entities/global.entity';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BillingPlan,
      UserSubscription,
      BillingInvoice,
      PaymentTransaction,
      User,
    ]),
  ],
  controllers: [BillingController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}