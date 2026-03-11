import { Module } from '@nestjs/common';
import { MoneyService } from './money.service';
import { MoneyController } from './money.controller';
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
		]),
	],
	providers: [MoneyService, JwtService],
	controllers: [MoneyController],
})
export class MoneyModule {}