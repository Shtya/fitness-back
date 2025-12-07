import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import {
  Wallet,
  Transaction,
  AdminSubscription,
  WithdrawalRequest,
  ClientPayment,
} from 'entities/billing.entity';
import { User } from 'entities/global.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Wallet,
      Transaction,
      AdminSubscription,
      WithdrawalRequest,
      ClientPayment,
      User,
    ]),
  ],
  providers: [BillingService],
  controllers: [BillingController],
  exports: [BillingService],
})
export class BillingModule {}
