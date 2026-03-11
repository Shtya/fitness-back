import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
	WalletAccount,
	IncomeEntry,
	ExpenseEntry,
	FinancialCommitment,
	ZakatLog,
	FinanceNotification,
	ExpectedEntry,
	BalanceMode,
	CommitmentStatus,
	WalletAccountType,
	MoneyCurrency,
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
	CreateExpectedEntryDto,
	UpdateExpectedEntryDto,
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
	) {}

	/* =========================================================
	 * Helpers
	 * ======================================================= */

	private getToday(): string {
		return new Date().toISOString().slice(0, 10);
	}

	private getMonthStart(date: string): string {
		return `${date.slice(0, 7)}-01`;
	}

	private getMonthEnd(date: string): string {
		const [year, month] = date.slice(0, 7).split('-').map(Number);
		const end = new Date(Date.UTC(year, month, 0));
		return end.toISOString().slice(0, 10);
	}

	private clampDate(date: string, min: string, max: string): string {
		if (date < min) return min;
		if (date > max) return max;
		return date;
	}

	private isDateInRange(date?: string | null, from?: string | null, to?: string | null): boolean {
		if (!date) return false;
		if (from && date < from) return false;
		if (to && date > to) return false;
		return true;
	}

	private normalizeMode(mode?: string): BalanceMode {
		return mode === BalanceMode.MONTH ? BalanceMode.MONTH : BalanceMode.TODAY;
	}

	private sumAmounts<T>(rows: T[], getAmount: (row: T) => any): number {
		return rows.reduce((sum, row) => sum + Number(getAmount(row) || 0), 0);
	}

	private getDefaultPeriod(mode?: string, from?: string, to?: string) {
		const today = this.getToday();
		const periodFrom = from || this.getMonthStart(today);
		const periodTo = to || this.getMonthEnd(periodFrom);
		const normalizedMode = this.normalizeMode(mode);
		const effectiveTo =
			normalizedMode === BalanceMode.TODAY
				? this.clampDate(today, periodFrom, periodTo)
				: periodTo;

		return {
			today,
			mode: normalizedMode,
			periodFrom,
			periodTo,
			effectiveTo,
			currentMonth: today.slice(0, 7),
		};
	}

	/* =========================================================
	 * Wallet Accounts
	 * ======================================================= */

	async createWallet(userId: string, dto: any) {
		const wallet = this.walletRepo.create({
			userId,
			name: dto.name ?? 'Main Wallet',
			type: dto.type ?? WalletAccountType.CASH,
			currency: dto.currency ?? MoneyCurrency.EGP,
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
			status: dto.status ?? CommitmentStatus.PENDING,
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
		commitment.status =
			commitment.status === CommitmentStatus.PAID
				? CommitmentStatus.PENDING
				: CommitmentStatus.PAID;
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

	async getDashboard(userId: string, mode?: string) {
		const period = this.getDefaultPeriod(mode);

		const [wallets, incomes, expenses, commitments, zakatLogs, notifications, expectedEntries] =
			await Promise.all([
				this.getWallets(userId),
				this.getIncome(userId),
				this.getExpenses(userId),
				this.getCommitments(userId),
				this.getZakatLogs(userId),
				this.getNotifications(userId),
				this.getExpected(userId),
			]);

		const currentMonthFrom = period.periodFrom;
		const currentMonthTo = period.periodTo;
		const effectiveTo = period.effectiveTo;

		const realAccountsTotal = this.sumAmounts(wallets, (wallet) => wallet.openingBalance);
		const openingBalance = realAccountsTotal;

		const monthIncome = incomes.filter(
			(item) => item.isActive !== false && this.isDateInRange(item.date, currentMonthFrom, currentMonthTo),
		);
		const currentIncomeRows = incomes.filter(
			(item) => item.isActive !== false && this.isDateInRange(item.date, currentMonthFrom, effectiveTo),
		);

		const monthExpense = expenses.filter(
			(item) => item.isActive !== false && this.isDateInRange(item.date, currentMonthFrom, currentMonthTo),
		);
		const currentExpenseRows = expenses.filter(
			(item) => item.isActive !== false && this.isDateInRange(item.date, currentMonthFrom, effectiveTo),
		);

		const monthExpected = expectedEntries.filter((item) =>
			this.isDateInRange(item.expectedDate, currentMonthFrom, currentMonthTo),
		);
		const currentExpectedRows = expectedEntries.filter((item) =>
			this.isDateInRange(item.expectedDate, currentMonthFrom, effectiveTo),
		);

		const monthCommitmentRows = commitments.filter(
			(item) =>
				item.status !== CommitmentStatus.CANCELLED &&
				this.isDateInRange(item.dueDate, currentMonthFrom, currentMonthTo),
		);
		const currentCommitmentRows = commitments.filter(
			(item) =>
				item.status !== CommitmentStatus.CANCELLED &&
				item.status !== CommitmentStatus.PAID &&
				this.isDateInRange(item.dueDate, currentMonthFrom, effectiveTo),
		);

		const monthZakatRows = zakatLogs.filter((item) =>
			this.isDateInRange(item.date, currentMonthFrom, currentMonthTo),
		);
		const currentZakatRows = zakatLogs.filter((item) =>
			this.isDateInRange(item.date, currentMonthFrom, effectiveTo),
		);

		const monthlyIncome = this.sumAmounts(monthIncome, (item) => item.amount);
		const currentIncome = this.sumAmounts(currentIncomeRows, (item) => item.amount);

		const monthlyExpenses = this.sumAmounts(monthExpense, (item) => item.amount);
		const currentExpenses = this.sumAmounts(currentExpenseRows, (item) => item.amount);

		const monthlyExpected = this.sumAmounts(monthExpected, (item) => item.amount);
		const currentExpectedAvailable = this.sumAmounts(currentExpectedRows, (item) => item.amount);

		const monthlyCommitments = this.sumAmounts(
			monthCommitmentRows.filter((item) => item.status !== CommitmentStatus.PAID),
			(item) => item.amount,
		);
		const currentCommitmentsDue = this.sumAmounts(currentCommitmentRows, (item) => item.amount);

		const monthlyZakatPaid = this.sumAmounts(monthZakatRows, (item) => item.amount);
		const currentZakatPaid = this.sumAmounts(currentZakatRows, (item) => item.amount);

		const monthlyBalance =
			monthlyIncome + monthlyExpected - monthlyExpenses - monthlyCommitments - monthlyZakatPaid;

		const currentMoneyBalance =
			currentIncome +
			currentExpectedAvailable -
			currentExpenses -
			currentCommitmentsDue -
			currentZakatPaid;

		const stats = {
			mode: period.mode,
			periodFrom: currentMonthFrom,
			periodTo: currentMonthTo,
			effectiveTo,
			openingBalance,
			realAccountsTotal,

			totalIncome: period.mode === BalanceMode.MONTH ? monthlyIncome : currentIncome,
			totalExpenses: period.mode === BalanceMode.MONTH ? monthlyExpenses : currentExpenses,
			totalExpected:
				period.mode === BalanceMode.MONTH ? monthlyExpected : currentExpectedAvailable,
			totalCommitments:
				period.mode === BalanceMode.MONTH ? monthlyCommitments : currentCommitmentsDue,
			totalZakatPaid:
				period.mode === BalanceMode.MONTH ? monthlyZakatPaid : currentZakatPaid,

			currentIncome,
			currentExpenses,
			currentExpectedAvailable,
			currentCommitmentsDue,
			currentZakatPaid,

			monthlyIncome,
			monthlyExpenses,
			monthlyExpected,
			monthlyCommitments,
			monthlyZakatPaid,

			currentMoneyBalance,
			monthlyBalance,

			net: period.mode === BalanceMode.MONTH ? monthlyBalance : currentMoneyBalance,
			balance: period.mode === BalanceMode.MONTH ? monthlyBalance : currentMoneyBalance,
		};

		return {
			mode: period.mode,
			wallets,
			stats,
			incomeCount: incomes.length,
			expenseCount: expenses.length,
			commitmentCount: commitments.length,
			zakatCount: zakatLogs.length,
			expectedCount: expectedEntries.length,
			unreadNotifications: notifications.filter((n) => !n.isRead).length,
			latestNotifications: notifications.slice(0, 10),
		};
	}

	/* =========================================================
	 * Month summary
	 * ======================================================= */

	async getMonthlySummary(userId: string, from?: string, to?: string, mode?: string) {
		const period = this.getDefaultPeriod(mode, from, to);

		const [incomes, expenses, commitments, expectedEntries, zakatLogs] = await Promise.all([
			this.getIncome(userId),
			this.getExpenses(userId),
			this.getCommitments(userId),
			this.getExpected(userId),
			this.getZakatLogs(userId),
		]);

		const rangeFrom = period.periodFrom;
		const rangeTo = period.periodTo;

		const map: Record<
			string,
			{
				month: string;
				income: number;
				expenses: number;
				expected: number;
				commitments: number;
				zakat: number;
				currentIncome: number;
				currentExpenses: number;
				currentExpected: number;
				currentCommitments: number;
				currentZakat: number;
			}
		> = {};

		const ensureMonth = (month: string) => {
			if (!map[month]) {
				const monthStart = `${month}-01`;
				const monthEnd = this.getMonthEnd(monthStart);
				const effectiveTo =
					period.mode === BalanceMode.TODAY && month === period.currentMonth
						? this.clampDate(period.today, monthStart, monthEnd)
						: monthEnd;

				map[month] = {
					month,
					income: 0,
					expenses: 0,
					expected: 0,
					commitments: 0,
					zakat: 0,
					currentIncome: 0,
					currentExpenses: 0,
					currentExpected: 0,
					currentCommitments: 0,
					currentZakat: 0,
				};

				return { monthStart, monthEnd, effectiveTo };
			}

			const monthStart = `${month}-01`;
			const monthEnd = this.getMonthEnd(monthStart);
			const effectiveTo =
				period.mode === BalanceMode.TODAY && month === period.currentMonth
					? this.clampDate(period.today, monthStart, monthEnd)
					: monthEnd;

			return { monthStart, monthEnd, effectiveTo };
		};

		for (const item of incomes) {
			if (item.isActive === false || !this.isDateInRange(item.date, rangeFrom, rangeTo)) continue;
			const month = item.date.slice(0, 7);
			const { effectiveTo } = ensureMonth(month);
			map[month].income += Number(item.amount || 0);
			if (item.date <= effectiveTo) map[month].currentIncome += Number(item.amount || 0);
		}

		for (const item of expenses) {
			if (item.isActive === false || !this.isDateInRange(item.date, rangeFrom, rangeTo)) continue;
			const month = item.date.slice(0, 7);
			const { effectiveTo } = ensureMonth(month);
			map[month].expenses += Number(item.amount || 0);
			if (item.date <= effectiveTo) map[month].currentExpenses += Number(item.amount || 0);
		}

		for (const item of expectedEntries) {
			if (!this.isDateInRange(item.expectedDate, rangeFrom, rangeTo)) continue;
			const month = item.expectedDate.slice(0, 7);
			const { effectiveTo } = ensureMonth(month);
			map[month].expected += Number(item.amount || 0);
			if (item.expectedDate <= effectiveTo) {
				map[month].currentExpected += Number(item.amount || 0);
			}
		}

		for (const item of commitments) {
			if (
				item.status === CommitmentStatus.CANCELLED ||
				!this.isDateInRange(item.dueDate, rangeFrom, rangeTo)
			) {
				continue;
			}

			const month = item.dueDate.slice(0, 7);
			const { effectiveTo } = ensureMonth(month);

			if (item.status !== CommitmentStatus.PAID) {
				map[month].commitments += Number(item.amount || 0);
				if (item.dueDate <= effectiveTo) {
					map[month].currentCommitments += Number(item.amount || 0);
				}
			}
		}

		for (const item of zakatLogs) {
			if (!this.isDateInRange(item.date, rangeFrom, rangeTo)) continue;
			const month = item.date.slice(0, 7);
			const { effectiveTo } = ensureMonth(month);
			map[month].zakat += Number(item.amount || 0);
			if (item.date <= effectiveTo) map[month].currentZakat += Number(item.amount || 0);
		}

		return Object.values(map)
			.sort((a, b) => a.month.localeCompare(b.month))
			.map((row) => ({
				month: row.month,
				income: row.income,
				expenses: row.expenses,
				expected: row.expected,
				commitments: row.commitments,
				zakat: row.zakat,

				currentIncome: row.currentIncome,
				currentExpenses: row.currentExpenses,
				currentExpected: row.currentExpected,
				currentCommitments: row.currentCommitments,
				currentZakat: row.currentZakat,

				net: row.income + row.expected - row.expenses,
				remaining: row.income + row.expected - row.expenses - row.commitments - row.zakat,

				currentNet: row.currentIncome + row.currentExpected - row.currentExpenses,
				currentRemaining:
					row.currentIncome +
					row.currentExpected -
					row.currentExpenses -
					row.currentCommitments -
					row.currentZakat,
			}));
	}

	/* =========================================================
	 * Expected Entries
	 * ======================================================= */

	async createExpected(userId: string, dto: CreateExpectedEntryDto) {
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

	async updateExpected(userId: string, id: string, dto: UpdateExpectedEntryDto) {
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