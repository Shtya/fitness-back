import { Module } from '@nestjs/common';
import { MoneyService } from './money.service';
import { MoneyController } from './money.controller';
import { WalletTrackerController } from './wallet-tracker.controller';
import { WalletTrackerService } from './wallet-tracker.service';
import { GoldPriceService } from './gold-price.service';
import { JwtService } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
	WalletAccount,
	IncomeEntry,
	ExpenseEntry,
	FinancialCommitment,
	ZakatLog,
	FinanceNotification,
	ExpectedEntry,
	GoldHolding,
} from 'entities/money.entity';

@Module({
	imports: [
		TypeOrmModule.forFeature([
			WalletAccount,
			IncomeEntry,
			ExpenseEntry,
			FinancialCommitment,
			ZakatLog,
			FinanceNotification,
			ExpectedEntry,
			GoldHolding,
		]),
	],
	providers: [MoneyService, WalletTrackerService, GoldPriceService, JwtService],
	controllers: [MoneyController, WalletTrackerController],
})
export class MoneyModule {}