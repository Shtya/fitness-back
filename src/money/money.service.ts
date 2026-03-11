// src/money/money.service.ts

import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual, LessThanOrEqual } from 'typeorm';
import {
	WalletAccount,
	IncomeEntry,
	ExpenseEntry,
	FinancialCommitment,
	ZakatLog,
	FinanceNotification,
	ExpectedEntry,
} from 'entities/money.entity';
import {
	CreateWalletAccountDto,
	UpdateWalletAccountDto,
	CreateIncomeEntryDto,
	UpdateIncomeEntryDto,
	CreateExpenseEntryDto,
	UpdateExpenseEntryDto,
	CreateFinancialCommitmentDto,
	UpdateFinancialCommitmentDto,
	CreateZakatLogDto,
	UpdateZakatLogDto,
	CreateFinanceNotificationDto,
	UpdateFinanceNotificationDto,
} from './money.dto';

@Injectable()
export class MoneyService {
	constructor(
		@InjectRepository(WalletAccount)
		private readonly walletRepo: Repository<WalletAccount>,

		@InjectRepository(IncomeEntry)
		private readonly incomeRepo: Repository<IncomeEntry>,

		@InjectRepository(ExpenseEntry)
		private readonly expenseRepo: Repository<ExpenseEntry>,

		@InjectRepository(FinancialCommitment)
		private readonly commitmentRepo: Repository<FinancialCommitment>,

		@InjectRepository(ZakatLog)
		private readonly zakatRepo: Repository<ZakatLog>,

		@InjectRepository(FinanceNotification)
		private readonly notificationRepo: Repository<FinanceNotification>,

		@InjectRepository(ExpectedEntry)
		private readonly expectedRepo: Repository<ExpectedEntry>,
	) { }

	/* =========================================================
	 * Wallet Accounts
	 * ======================================================= */

	async createWallet(userId: string, dto: CreateWalletAccountDto) {
		const wallet = this.walletRepo.create({
			userId,
			name: dto.name ?? 'Main Wallet',
			currency: dto.currency ?? 'EGP',
			openingBalance: dto.openingBalance ?? 0,
			isDefault: dto.isDefault ?? false,
			notes: dto.notes ?? null,
		});

		if (wallet.isDefault) {
			await this.walletRepo.update({ userId, isDefault: true }, { isDefault: false });
		}

		return this.walletRepo.save(wallet);
	}

	async getWallets(userId: string) {
		return this.walletRepo.find({
			where: { userId },
			order: { created_at: 'DESC' },
		});
	}

	async getWalletById(userId: string, id: string) {
		const wallet = await this.walletRepo.findOne({ where: { id, userId } });
		if (!wallet) throw new NotFoundException('Wallet account not found');
		return wallet;
	}

	async updateWallet(userId: string, id: string, dto: UpdateWalletAccountDto) {
		const wallet = await this.getWalletById(userId, id);

		if (dto.isDefault === true) {
			await this.walletRepo.update({ userId, isDefault: true }, { isDefault: false });
		}

		Object.assign(wallet, dto);
		return this.walletRepo.save(wallet);
	}

	async deleteWallet(userId: string, id: string) {
		const wallet = await this.getWalletById(userId, id);
		await this.walletRepo.softRemove(wallet);
		return { message: 'Wallet deleted successfully' };
	}

	/* =========================================================
	 * Income
	 * ======================================================= */

	async createIncome(userId: string, dto: CreateIncomeEntryDto) {
		const income = this.incomeRepo.create({
			userId,
			accountId: dto.accountId ?? null,
			source: dto.source,
			notes: dto.notes ?? null,
			amount: dto.amount,
			date: dto.date,
			recurring: dto.recurring ?? false,
			recurrenceType: dto.recurrenceType ?? 'monthly',
			recurrenceEvery: dto.recurrenceEvery ?? 1,
			isActive: true,
		});

		return this.incomeRepo.save(income);
	}

	async getIncome(userId: string) {
		return this.incomeRepo.find({
			where: { userId },
			order: { date: 'DESC', created_at: 'DESC' },
		});
	}

	async getIncomeById(userId: string, id: string) {
		const income = await this.incomeRepo.findOne({ where: { id, userId } });
		if (!income) throw new NotFoundException('Income entry not found');
		return income;
	}

	async updateIncome(userId: string, id: string, dto: UpdateIncomeEntryDto) {
		const income = await this.getIncomeById(userId, id);
		Object.assign(income, dto);
		return this.incomeRepo.save(income);
	}

	async deleteIncome(userId: string, id: string) {
		const income = await this.getIncomeById(userId, id);
		await this.incomeRepo.softRemove(income);
		return { message: 'Income entry deleted successfully' };
	}

	/* =========================================================
	 * Expenses
	 * ======================================================= */

	async createExpense(userId: string, dto: CreateExpenseEntryDto) {
		const expense = this.expenseRepo.create({
			userId,
			accountId: dto.accountId ?? null,
			description: dto.description,
			category: dto.category ?? null,
			notes: dto.notes ?? null,
			amount: dto.amount,
			date: dto.date,
			recurring: dto.recurring ?? false,
			recurrenceType: dto.recurrenceType ?? 'monthly',
			recurrenceEvery: dto.recurrenceEvery ?? 1,
			isActive: true,
		});

		return this.expenseRepo.save(expense);
	}

	async getExpenses(userId: string) {
		return this.expenseRepo.find({
			where: { userId },
			order: { date: 'DESC', created_at: 'DESC' },
		});
	}

	async getExpenseById(userId: string, id: string) {
		const expense = await this.expenseRepo.findOne({ where: { id, userId } });
		if (!expense) throw new NotFoundException('Expense entry not found');
		return expense;
	}

	async updateExpense(userId: string, id: string, dto: UpdateExpenseEntryDto) {
		const expense = await this.getExpenseById(userId, id);
		Object.assign(expense, dto);
		return this.expenseRepo.save(expense);
	}

	async deleteExpense(userId: string, id: string) {
		const expense = await this.getExpenseById(userId, id);
		await this.expenseRepo.softRemove(expense);
		return { message: 'Expense entry deleted successfully' };
	}

	/* =========================================================
	 * Commitments
	 * ======================================================= */

	async createCommitment(userId: string, dto: CreateFinancialCommitmentDto) {
		const commitment = this.commitmentRepo.create({
			userId,
			accountId: dto.accountId ?? null,
			name: dto.name,
			type: dto.type ?? 'التزام',
			amount: dto.amount,
			dueDate: dto.dueDate,
			status: dto.status ?? 'pending',
			recurring: dto.recurring ?? false,
			recurrenceType: dto.recurrenceType ?? 'monthly',
			recurrenceEvery: dto.recurrenceEvery ?? 1,
			jamiaStart: dto.jamiaStart ?? null,
			jamiaEnd: dto.jamiaEnd ?? null,
			jamiaMyMonth: dto.jamiaMyMonth ?? null,
			notes: dto.notes ?? null,
		});

		return this.commitmentRepo.save(commitment);
	}

	async getCommitments(userId: string) {
		return this.commitmentRepo.find({
			where: { userId },
			order: { dueDate: 'ASC', created_at: 'DESC' },
		});
	}

	async getCommitmentById(userId: string, id: string) {
		const commitment = await this.commitmentRepo.findOne({ where: { id, userId } });
		if (!commitment) throw new NotFoundException('Commitment not found');
		return commitment;
	}

	async updateCommitment(userId: string, id: string, dto: UpdateFinancialCommitmentDto) {
		const commitment = await this.getCommitmentById(userId, id);
		Object.assign(commitment, dto);
		return this.commitmentRepo.save(commitment);
	}

	async deleteCommitment(userId: string, id: string) {
		const commitment = await this.getCommitmentById(userId, id);
		await this.commitmentRepo.softRemove(commitment);
		return { message: 'Commitment deleted successfully' };
	}

	async toggleCommitmentStatus(userId: string, id: string) {
		const commitment: any = await this.getCommitmentById(userId, id);
		commitment.status = commitment.status === 'paid' ? 'pending' : 'paid';
		return this.commitmentRepo.save(commitment);
	}

	/* =========================================================
	 * Zakat Logs
	 * ======================================================= */

	async createZakatLog(userId: string, dto: CreateZakatLogDto) {
		const zakat = this.zakatRepo.create({
			userId,
			accountId: dto.accountId ?? null,
			description: dto.description,
			amount: dto.amount,
			date: dto.date,
			isZakat: dto.isZakat ?? false,
			notes: dto.notes ?? null,
		});

		return this.zakatRepo.save(zakat);
	}

	async getZakatLogs(userId: string) {
		return this.zakatRepo.find({
			where: { userId },
			order: { date: 'DESC', created_at: 'DESC' },
		});
	}

	async getZakatLogById(userId: string, id: string) {
		const zakat = await this.zakatRepo.findOne({ where: { id, userId } });
		if (!zakat) throw new NotFoundException('Zakat log not found');
		return zakat;
	}

	async updateZakatLog(userId: string, id: string, dto: UpdateZakatLogDto) {
		const zakat = await this.getZakatLogById(userId, id);
		Object.assign(zakat, dto);
		return this.zakatRepo.save(zakat);
	}

	async deleteZakatLog(userId: string, id: string) {
		const zakat = await this.getZakatLogById(userId, id);
		await this.zakatRepo.softRemove(zakat);
		return { message: 'Zakat log deleted successfully' };
	}

	/* =========================================================
	 * Notifications
	 * ======================================================= */

	async createNotification(userId: string, dto: CreateFinanceNotificationDto) {
		const notification = this.notificationRepo.create({
			userId,
			type: dto.type ?? 'warn',
			text: dto.text,
			timeLabel: dto.timeLabel ?? null,
			isRead: dto.isRead ?? false,
			meta: dto.meta ?? null,
		});

		return this.notificationRepo.save(notification);
	}

	async getNotifications(userId: string) {
		return this.notificationRepo.find({
			where: { userId },
			order: { created_at: 'DESC' },
		});
	}

	async getNotificationById(userId: string, id: string) {
		const notification = await this.notificationRepo.findOne({ where: { id, userId } });
		if (!notification) throw new NotFoundException('Notification not found');
		return notification;
	}

	async updateNotification(userId: string, id: string, dto: UpdateFinanceNotificationDto) {
		const notification = await this.getNotificationById(userId, id);
		Object.assign(notification, dto);
		return this.notificationRepo.save(notification);
	}

	async markNotificationRead(userId: string, id: string) {
		const notification = await this.getNotificationById(userId, id);
		notification.isRead = true;
		return this.notificationRepo.save(notification);
	}

	async deleteNotification(userId: string, id: string) {
		const notification = await this.getNotificationById(userId, id);
		await this.notificationRepo.softRemove(notification);
		return { message: 'Notification deleted successfully' };
	}

	/* =========================================================
	 * Dashboard Summary
	 * ======================================================= */

	async getDashboard(userId: string) {
		const [wallets, incomes, expenses, commitments, zakatLogs, notifications] = await Promise.all([
			this.getWallets(userId),
			this.getIncome(userId),
			this.getExpenses(userId),
			this.getCommitments(userId),
			this.getZakatLogs(userId),
			this.getNotifications(userId),
		]);

		const openingBalance = wallets.reduce(
			(sum, wallet) => sum + Number(wallet.openingBalance || 0),
			0,
		);

		const totalIncome = incomes.reduce((sum, item) => sum + Number(item.amount || 0), 0);
		const totalExpenses = expenses.reduce((sum, item) => sum + Number(item.amount || 0), 0);
		const totalCommitments = commitments
			.filter((item: any) => item.status !== 'paid')
			.reduce((sum, item) => sum + Number(item.amount || 0), 0);
		const totalZakatPaid = zakatLogs.reduce(
			(sum, item) => sum + Number(item.amount || 0),
			0,
		);

		// Real net after all outgoing money
		const net = totalIncome - totalExpenses - totalCommitments - totalZakatPaid;

		// Final balance
		const balance = openingBalance + net;

		return {
			wallets,
			stats: {
				openingBalance,
				totalIncome,
				totalExpenses,
				totalCommitments,
				totalZakatPaid,
				net,
				balance,
			},
			incomeCount: incomes.length,
			expenseCount: expenses.length,
			commitmentCount: commitments.length,
			zakatCount: zakatLogs.length,
			unreadNotifications: notifications.filter((n) => !n.isRead).length,
			latestNotifications: notifications.slice(0, 10),
		};
	}

	/* =========================================================
	 * Month summary
	 * ======================================================= */

	async getMonthlySummary(userId: string, from?: string, to?: string) {
		const incomes = await this.incomeRepo.find({
			where: {
				userId,
				...(from ? { date: MoreThanOrEqual(from) } : {}),
				...(to ? { date: LessThanOrEqual(to) } : {}),
			},
			order: { date: 'ASC' },
		});

		const expenses = await this.expenseRepo.find({
			where: {
				userId,
				...(from ? { date: MoreThanOrEqual(from) } : {}),
				...(to ? { date: LessThanOrEqual(to) } : {}),
			},
			order: { date: 'ASC' },
		});

		const commitments = await this.commitmentRepo.find({
			where: {
				userId,
				...(from ? { dueDate: MoreThanOrEqual(from) } : {}),
				...(to ? { dueDate: LessThanOrEqual(to) } : {}),
			},
			order: { dueDate: 'ASC' },
		});

		const map: Record<string, any> = {};

		for (const item of incomes) {
			const month = item.date?.slice(0, 7);
			if (!map[month]) map[month] = { month, income: 0, expenses: 0, commitments: 0 };
			map[month].income += Number(item.amount || 0);
		}

		for (const item of expenses) {
			const month = item.date?.slice(0, 7);
			if (!map[month]) map[month] = { month, income: 0, expenses: 0, commitments: 0 };
			map[month].expenses += Number(item.amount || 0);
		}

		for (const item of commitments) {
			const month = item.dueDate?.slice(0, 7);
			if (!map[month]) map[month] = { month, income: 0, expenses: 0, commitments: 0 };
			map[month].commitments += Number(item.amount || 0);
		}

		return Object.values(map)
			.sort((a: any, b: any) => a.month.localeCompare(b.month))
			.map((row: any) => ({
				...row,
				net: row.income - row.expenses,
				remaining: row.income - row.expenses - row.commitments,
			}));
	}







	/* =========================================================
 * Expected Entries
 * ======================================================= */

	async createExpected(userId: string, dto: any) {
		const expected = this.expectedRepo.create({
			userId,
			accountId: dto.accountId ?? null,
			description: dto.description,
			amount: dto.amount,
			expectedDate: dto.expectedDate,
			notes: dto.notes ?? null,
		});

		return this.expectedRepo.save(expected);
	}

	async getExpected(userId: string) {
		return this.expectedRepo.find({
			where: { userId },
			order: { expectedDate: 'ASC', created_at: 'DESC' },
		});
	}

	async getExpectedById(userId: string, id: string) {
		const expected = await this.expectedRepo.findOne({ where: { id, userId } });
		if (!expected) throw new NotFoundException('Expected entry not found');
		return expected;
	}

	async updateExpected(userId: string, id: string, dto: any) {
		const expected = await this.getExpectedById(userId, id);
		Object.assign(expected, dto);
		return this.expectedRepo.save(expected);
	}

	async deleteExpected(userId: string, id: string) {
		const expected = await this.getExpectedById(userId, id);
		await this.expectedRepo.softRemove(expected);
		return { message: 'Expected entry deleted successfully' };
	}
}