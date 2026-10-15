import { Module } from '@nestjs/common';
import { MoneyService } from './money.service';
import { MoneyController } from './money.controller';
import { WalletTrackerController } from './wallet-tracker.controller';
import { WalletTrackerService } from './wallet-tracker.service';
import { GoldPriceService } from './gold-price.service';
import { FxRateService } from './fx-rate.service';
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
	LentLoan,
	WalletExpense,
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
			LentLoan,
			WalletExpense,
		]),
	],
	providers: [MoneyService, WalletTrackerService, GoldPriceService, FxRateService, JwtService],
	controllers: [MoneyController, WalletTrackerController],
})
export class MoneyModule {}