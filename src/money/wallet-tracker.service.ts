import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { ExpectedEntry, GoldHolding, IncomeEntry, LentLoan, WalletAccount, WalletExpense } from 'entities/money.entity';
import { isYmd, todayYmd } from '../billing/billing-rules';
import { goldValue } from './gold-price';
import { GoldPriceService } from './gold-price.service';
import { FxRateService } from './fx-rate.service';
import {
	CreateGoldHoldingDto,
	CreateLentLoanDto,
	CreateTrackerItemDto,
	CreateWalletExpenseDto,
	TrackerBalanceDto,
	UpdateGoldHoldingDto,
	UpdateLentLoanDto,
	UpdateTrackerItemDto,
	UpdateWalletExpenseDto,
} from './wallet-tracker.dto';
import {
	centsToDecimal,
	fromCents,
	monthRange,
	nextBalanceCents,
	normalizeTrackerCurrency,
	summarizeTracker,
	toCents,
	TrackerCurrency,
	TrackerItem,
	TrackerItemKind,
	usdToEgpCents,
} from './wallet-tracker.rules';

const LIST_LIMIT = 300;
const DEFAULT_WALLET_NAME = 'Main Wallet';
const UNDEFINED_TABLE = '42P01';

const isMissingTable = (error: any) => (error?.driverError?.code ?? error?.code) === UNDEFINED_TABLE;

/**
 * The WhatsApp "wallet" tab: one balance (the user's default wallet) plus money items.
 * Not received yet = ExpectedEntry, received = IncomeEntry, so the /money page sees the same data.
 * Every money move updates the item and the balance in one transaction (wallet row locked first).
 */
@Injectable()
export class WalletTrackerService {
	private readonly logger = new Logger(WalletTrackerService.name);

	constructor(
		@InjectDataSource() private readonly dataSource: DataSource,
		private readonly goldPrice: GoldPriceService,
		private readonly fxRate: FxRateService,
	) {}

	async getTracker(userId: string) {
		const m = this.dataSource.manager;
		const [wallet, pending, received, gold, lent, expenses, fx] = await Promise.all([
			this.findWallet(m, userId, false),
			m.find(ExpectedEntry, {
				where: { userId },
				order: { expectedDate: 'ASC', created_at: 'ASC' },
				take: LIST_LIMIT,
			}),
			m.find(IncomeEntry, {
				where: { userId, isActive: true },
				order: { date: 'DESC', created_at: 'DESC' },
				take: LIST_LIMIT,
			}),
			this.getGold(userId),
			this.getLent(userId),
			this.getExpenses(userId),
			this.fxRate.getQuote(),
		]);
		const liveRate = fx?.usdToEgp ?? null;
		const items: TrackerItem[] = [
			...pending.map((row) => this.toPendingItem(row, liveRate)),
			...received.map((row) => this.toReceivedItem(row)),
		];
		const balanceCents = toCents(wallet?.openingBalance);
		return {
			wallet: wallet ? { id: wallet.id, name: wallet.name, currency: wallet.currency } : null,
			summary: summarizeTracker(balanceCents, items, todayYmd()),
			fx: fx
				? { usdToEgp: fx.usdToEgp, updatedAt: fx.updatedAt, stale: fx.stale, source: fx.source }
				: null,
			items,
			gold,
			lent,
			expenses,
		};
	}

	async createGold(userId: string, dto: CreateGoldHoldingDto) {
		await this.withGoldTable(() =>
			this.dataSource.manager.save(
				this.dataSource.manager.create(GoldHolding, {
					userId,
					name: dto.name?.trim() || `Gold ${dto.karat}K`,
					grams: dto.grams.toFixed(3),
					karat: dto.karat,
				}),
			),
		);
		return this.getTracker(userId);
	}

	async updateGold(userId: string, id: string, dto: UpdateGoldHoldingDto) {
		await this.withGoldTable(async () => {
			const row = await this.findGold(userId, id);
			if (dto.name !== undefined) row.name = dto.name.trim() || row.name;
			if (dto.grams !== undefined) row.grams = dto.grams.toFixed(3);
			if (dto.karat !== undefined) row.karat = dto.karat;
			await this.dataSource.manager.save(row);
		});
		return this.getTracker(userId);
	}

	async deleteGold(userId: string, id: string) {
		await this.withGoldTable(async () => {
			await this.dataSource.manager.softRemove(await this.findGold(userId, id));
		});
		return this.getTracker(userId);
	}

	/** Holdings valued at today's price; `available: false` until the gold_holdings migration is applied. */
	private async getGold(userId: string) {
		const quotePromise = this.goldPrice.getQuote();
		let rows: GoldHolding[] = [];
		let available = true;
		try {
			rows = await this.dataSource.manager.find(GoldHolding, { where: { userId }, order: { created_at: 'ASC' } });
		} catch (error) {
			if (!isMissingTable(error)) throw error;
			available = false;
		}
		const quote = await quotePromise;
		const holdings = rows.map((row) => {
			const grams = Number(row.grams) || 0;
			return { id: row.id, name: row.name, grams, karat: row.karat, value: goldValue(grams, row.karat, quote?.perGram) };
		});
		const totalValue = quote ? fromCents(holdings.reduce((sum, h) => sum + toCents(h.value ?? 0), 0)) : null;
		const totalGrams = Math.round(holdings.reduce((sum, h) => sum + h.grams, 0) * 1000) / 1000;
		return { available, quote, holdings, totalGrams, totalValue };
	}

	private async findGold(userId: string, id: string) {
		const row = await this.dataSource.manager.findOne(GoldHolding, { where: { id, userId } });
		if (!row) throw new NotFoundException('Gold item not found');
		return row;
	}

	private async withGoldTable<T>(run: () => Promise<T>): Promise<T> {
		try {
			return await run();
		} catch (error) {
			if (isMissingTable(error)) {
				this.logger.warn('gold_holdings table is missing; apply migrations/20261015_gold_holdings.sql');
				throw new ServiceUnavailableException('Gold is not set up yet');
			}
			throw error;
		}
	}

	async createLent(userId: string, dto: CreateLentLoanDto) {
		const person = this.cleanName(dto.person);
		const date = this.cleanDate(dto.date) ?? todayYmd();
		const amount = centsToDecimal(toCents(dto.amount));
		const notes = dto.notes?.trim() || null;
		await this.withLentTable(() =>
			this.dataSource.manager.save(
				this.dataSource.manager.create(LentLoan, {
					userId,
					person,
					amount,
					lentDate: date,
					notes,
				}),
			),
		);
		return this.getTracker(userId);
	}

	async updateLent(userId: string, id: string, dto: UpdateLentLoanDto) {
		const date = this.cleanDate(dto.date);
		await this.withLentTable(async () => {
			const row = await this.findLent(userId, id);
			if (dto.person !== undefined) row.person = this.cleanName(dto.person);
			if (dto.amount !== undefined) row.amount = centsToDecimal(toCents(dto.amount));
			if (date) row.lentDate = date;
			if (dto.notes !== undefined) row.notes = dto.notes.trim() || null;
			await this.dataSource.manager.save(row);
		});
		return this.getTracker(userId);
	}

	async deleteLent(userId: string, id: string) {
		await this.withLentTable(async () => {
			await this.dataSource.manager.softRemove(await this.findLent(userId, id));
		});
		return this.getTracker(userId);
	}

	async createExpense(userId: string, dto: CreateWalletExpenseDto) {
		const name = this.cleanName(dto.name);
		const date = this.cleanDate(dto.date) ?? todayYmd();
		const amount = centsToDecimal(toCents(dto.amount));
		const notes = dto.notes?.trim() || null;
		await this.withExpenseTable(() =>
			this.dataSource.transaction(async (m) => {
				const wallet = await this.ensureWallet(m, userId);
				await m.save(
					m.create(WalletExpense, {
						userId,
						name,
						amount,
						spentDate: date,
						notes,
					}),
				);
				await this.moveBalance(m, wallet, -toCents(amount));
			}),
		);
		return this.getTracker(userId);
	}

	async updateExpense(userId: string, id: string, dto: UpdateWalletExpenseDto) {
		const date = this.cleanDate(dto.date);
		await this.withExpenseTable(() =>
			this.dataSource.transaction(async (m) => {
				const row = await this.lockExpense(m, userId, id);
				const before = toCents(row.amount);
				if (dto.name !== undefined) row.name = this.cleanName(dto.name);
				if (dto.amount !== undefined) row.amount = centsToDecimal(toCents(dto.amount));
				if (date) row.spentDate = date;
				if (dto.notes !== undefined) row.notes = dto.notes.trim() || null;
				await m.save(row);
				const delta = before - toCents(row.amount);
				if (delta) {
					const wallet = await this.ensureWallet(m, userId);
					await this.moveBalance(m, wallet, delta);
				}
			}),
		);
		return this.getTracker(userId);
	}

	async deleteExpense(userId: string, id: string) {
		await this.withExpenseTable(() =>
			this.dataSource.transaction(async (m) => {
				const row = await this.lockExpense(m, userId, id);
				const wallet = await this.ensureWallet(m, userId);
				await m.softRemove(row);
				await this.moveBalance(m, wallet, toCents(row.amount));
			}),
		);
		return this.getTracker(userId);
	}

	/** Money still with other people; `available: false` until the lent_loans migration is applied. */
	private async getLent(userId: string) {
		let rows: LentLoan[] = [];
		let available = true;
		try {
			rows = await this.dataSource.manager.find(LentLoan, {
				where: { userId },
				order: { lentDate: 'DESC', created_at: 'DESC' },
			});
		} catch (error) {
			if (!isMissingTable(error)) throw error;
			available = false;
		}
		const loans = rows.map((row) => ({
			id: row.id,
			person: row.person,
			amount: fromCents(toCents(row.amount)),
			date: String(row.lentDate).slice(0, 10),
			notes: row.notes ?? null,
		}));
		const total = fromCents(loans.reduce((sum, loan) => sum + toCents(loan.amount), 0));
		return { available, loans, total };
	}

	private async findLent(userId: string, id: string) {
		const row = await this.dataSource.manager.findOne(LentLoan, { where: { id, userId } });
		if (!row) throw new NotFoundException('Lent item not found');
		return row;
	}

	private async withLentTable<T>(run: () => Promise<T>): Promise<T> {
		try {
			return await run();
		} catch (error) {
			if (isMissingTable(error)) {
				this.logger.warn('lent_loans table is missing; apply migrations/20261016_lent_loans.sql');
				throw new ServiceUnavailableException('Lent money is not set up yet');
			}
			throw error;
		}
	}

	/** Spending log; `available: false` until the wallet_expenses migration is applied. */
	private async getExpenses(userId: string) {
		const today = todayYmd();
		const { start, end } = monthRange(today);
		const empty = { available: false as const, items: [] as Array<{ id: string; name: string; amount: number; date: string; notes: string | null }>, total: 0, spentThisMonth: 0, month: start.slice(0, 7) };
		try {
			// Raw probe so a stale TypeORM metadata miss is not confused with "table missing".
			await this.dataSource.query(`SELECT 1 FROM wallet_expenses WHERE false`);
		} catch (error) {
			if (isMissingTable(error)) {
				this.logger.warn('wallet_expenses table is missing; apply migrations/20261016_wallet_expenses.sql');
				return empty;
			}
			this.logger.warn(`wallet_expenses probe failed: ${error instanceof Error ? error.message : error}`);
			throw error;
		}
		const rows = await this.dataSource.manager.find(WalletExpense, {
			where: { userId },
			order: { spentDate: 'DESC', created_at: 'DESC' },
			take: LIST_LIMIT,
		});
		const items = rows.map((row) => ({
			id: row.id,
			name: row.name,
			amount: fromCents(toCents(row.amount)),
			date: String(row.spentDate).slice(0, 10),
			notes: row.notes ?? null,
		}));
		const total = fromCents(items.reduce((sum, row) => sum + toCents(row.amount), 0));
		const spentThisMonth = fromCents(
			items.reduce((sum, row) => (row.date >= start && row.date <= end ? sum + toCents(row.amount) : sum), 0),
		);
		return { available: true, items, total, spentThisMonth, month: start.slice(0, 7) };
	}

	private async lockExpense(m: EntityManager, userId: string, id: string) {
		const row = await m.findOne(WalletExpense, { where: { id, userId }, lock: { mode: 'pessimistic_write' } });
		if (!row) throw new NotFoundException('Expense not found');
		return row;
	}

	private async withExpenseTable<T>(run: () => Promise<T>): Promise<T> {
		try {
			await this.dataSource.query(`SELECT 1 FROM wallet_expenses WHERE false`);
			return await run();
		} catch (error) {
			if (isMissingTable(error)) {
				this.logger.warn('wallet_expenses table is missing; apply migrations/20261016_wallet_expenses.sql');
				throw new ServiceUnavailableException('Expenses are not set up yet');
			}
			throw error;
		}
	}

	async updateBalance(userId: string, dto: TrackerBalanceDto) {
		await this.dataSource.transaction(async (m) => {
			const wallet = await this.ensureWallet(m, userId);
			const next = nextBalanceCents(toCents(wallet.openingBalance), dto.mode, toCents(dto.amount));
			wallet.openingBalance = centsToDecimal(next);
			await m.save(wallet);
		});
		return this.getTracker(userId);
	}

	async createItem(userId: string, dto: CreateTrackerItemDto) {
		const name = this.cleanName(dto.name);
		const date = this.cleanDate(dto.date) ?? todayYmd();
		const currency = normalizeTrackerCurrency(dto.currency);
		const amount = centsToDecimal(toCents(dto.amount));
		const notes = dto.notes?.trim() || null;
		await this.dataSource.transaction(async (m) => {
			if (!dto.received) {
				await m.save(
					m.create(ExpectedEntry, {
						userId,
						description: name,
						amount,
						currency,
						expectedDate: date,
						notes,
					}),
				);
				return;
			}
			const wallet = await this.ensureWallet(m, userId);
			const settled = await this.settleToEgp(currency, amount);
			await m.save(
				m.create(IncomeEntry, {
					userId,
					accountId: wallet.id,
					source: name,
					amount: settled.egpAmount,
					currency,
					originalAmount: settled.originalAmount,
					fxRate: settled.fxRate,
					date,
					notes,
					isActive: true,
				}),
			);
			await this.moveBalance(m, wallet, toCents(settled.egpAmount));
		});
		return this.getTracker(userId);
	}

	async updateItem(userId: string, kind: TrackerItemKind, id: string, dto: UpdateTrackerItemDto) {
		const date = this.cleanDate(dto.date);
		const currency = dto.currency !== undefined ? normalizeTrackerCurrency(dto.currency) : undefined;
		await this.dataSource.transaction(async (m) => {
			if (kind === 'pending') {
				const row = await this.lockPending(m, userId, id);
				if (dto.name !== undefined) row.description = this.cleanName(dto.name);
				if (dto.amount !== undefined) row.amount = centsToDecimal(toCents(dto.amount));
				if (currency) row.currency = currency;
				if (date) row.expectedDate = date;
				if (dto.notes !== undefined) row.notes = dto.notes.trim() || null;
				await m.save(row);
				return;
			}
			const wallet = await this.ensureWallet(m, userId);
			const row = await this.lockReceived(m, userId, id);
			const before = toCents(row.amount);
			if (dto.name !== undefined) row.source = this.cleanName(dto.name);
			if (date) row.date = date;
			if (dto.notes !== undefined) row.notes = dto.notes.trim() || null;
			if (dto.amount !== undefined || currency) {
				const nextCurrency = currency ?? normalizeTrackerCurrency(row.currency);
				const nextAmount = dto.amount !== undefined ? centsToDecimal(toCents(dto.amount)) : row.originalAmount || row.amount;
				if (nextCurrency === 'USD') {
					const rate = row.fxRate ? Number(row.fxRate) : await this.fxRate.requireUsdToEgp();
					row.currency = 'USD';
					row.originalAmount = nextAmount;
					row.fxRate = String(rate);
					row.amount = centsToDecimal(usdToEgpCents(Number(nextAmount), rate));
				} else {
					row.currency = 'EGP';
					row.originalAmount = null;
					row.fxRate = null;
					row.amount = nextAmount;
				}
			}
			await m.save(row);
			await this.moveBalance(m, wallet, toCents(row.amount) - before);
		});
		return this.getTracker(userId);
	}

	/** Received ⇄ not received. Receiving locks USD at today's FX and adds EGP to the balance. */
	async toggleItem(userId: string, kind: TrackerItemKind, id: string) {
		await this.dataSource.transaction(async (m) => {
			const wallet = await this.ensureWallet(m, userId);
			if (kind === 'pending') {
				const row = await this.lockPending(m, userId, id);
				const currency = normalizeTrackerCurrency(row.currency);
				const settled = await this.settleToEgp(currency, row.amount);
				await m.save(
					m.create(IncomeEntry, {
						userId,
						accountId: wallet.id,
						source: row.description,
						amount: settled.egpAmount,
						currency,
						originalAmount: settled.originalAmount,
						fxRate: settled.fxRate,
						date: todayYmd(),
						notes: row.notes ?? null,
						isActive: true,
					}),
				);
				await m.softRemove(row);
				await this.moveBalance(m, wallet, toCents(settled.egpAmount));
				return;
			}
			const row = await this.lockReceived(m, userId, id);
			const currency = normalizeTrackerCurrency(row.currency);
			const pendingAmount = currency === 'USD' && row.originalAmount ? row.originalAmount : row.amount;
			await m.save(
				m.create(ExpectedEntry, {
					userId,
					description: row.source,
					amount: pendingAmount,
					currency,
					expectedDate: row.date,
					notes: row.notes ?? null,
				}),
			);
			await m.softRemove(row);
			await this.moveBalance(m, wallet, -toCents(row.amount));
		});
		return this.getTracker(userId);
	}

	/** `revertBalance` only matters for received items: take their amount back out of the balance. */
	async deleteItem(userId: string, kind: TrackerItemKind, id: string, revertBalance: boolean) {
		await this.dataSource.transaction(async (m) => {
			if (kind === 'pending') {
				await m.softRemove(await this.lockPending(m, userId, id));
				return;
			}
			const wallet = revertBalance ? await this.ensureWallet(m, userId) : null;
			const row = await this.lockReceived(m, userId, id);
			await m.softRemove(row);
			if (wallet) await this.moveBalance(m, wallet, -toCents(row.amount));
		});
		return this.getTracker(userId);
	}

	private toPendingItem(row: ExpectedEntry, liveRate: number | null): TrackerItem {
		const currency = normalizeTrackerCurrency(row.currency);
		const amount = fromCents(toCents(row.amount));
		const fxRate = currency === 'USD' ? liveRate : null;
		const egpAmount = currency === 'USD' && liveRate ? fromCents(usdToEgpCents(amount, liveRate)) : amount;
		return {
			id: row.id,
			kind: 'pending',
			name: row.description,
			amount,
			egpAmount,
			currency,
			fxRate,
			date: String(row.expectedDate).slice(0, 10),
			notes: row.notes ?? null,
		};
	}

	private toReceivedItem(row: IncomeEntry): TrackerItem {
		const currency = normalizeTrackerCurrency(row.currency);
		const egpAmount = fromCents(toCents(row.amount));
		const fxRate = row.fxRate != null ? Number(row.fxRate) : null;
		const amount =
			currency === 'USD' && row.originalAmount != null ? fromCents(toCents(row.originalAmount)) : egpAmount;
		return {
			id: row.id,
			kind: 'received',
			name: row.source,
			amount,
			egpAmount,
			currency,
			fxRate: Number.isFinite(fxRate as number) ? fxRate : null,
			date: String(row.date).slice(0, 10),
			notes: row.notes ?? null,
		};
	}

	/** Convert a nominal amount into the EGP that joins the wallet (locks today's FX for USD). */
	private async settleToEgp(currency: TrackerCurrency, amount: string) {
		if (currency !== 'USD') {
			return { egpAmount: centsToDecimal(toCents(amount)), originalAmount: null as string | null, fxRate: null as string | null };
		}
		let rate: number;
		try {
			rate = await this.fxRate.requireUsdToEgp();
		} catch {
			throw new BadRequestException('USD exchange rate is unavailable right now');
		}
		return {
			egpAmount: centsToDecimal(usdToEgpCents(Number(amount), rate)),
			originalAmount: centsToDecimal(toCents(amount)),
			fxRate: String(rate),
		};
	}

	private cleanName(value: string): string {
		const name = String(value ?? '').trim();
		if (!name) throw new BadRequestException('Name is required');
		return name;
	}

	private cleanDate(value?: string): string | undefined {
		if (value === undefined) return undefined;
		if (!isYmd(value)) throw new BadRequestException('Invalid date');
		return value;
	}

	private async moveBalance(m: EntityManager, wallet: WalletAccount, deltaCents: number) {
		if (!deltaCents) return;
		wallet.openingBalance = centsToDecimal(toCents(wallet.openingBalance) + deltaCents);
		await m.save(wallet);
	}

	private async lockPending(m: EntityManager, userId: string, id: string) {
		const row = await m.findOne(ExpectedEntry, { where: { id, userId }, lock: { mode: 'pessimistic_write' } });
		if (!row) throw new NotFoundException('Item not found');
		return row;
	}

	private async lockReceived(m: EntityManager, userId: string, id: string) {
		const row = await m.findOne(IncomeEntry, { where: { id, userId }, lock: { mode: 'pessimistic_write' } });
		if (!row) throw new NotFoundException('Item not found');
		return row;
	}

	private async findWallet(m: EntityManager, userId: string, lock: boolean) {
		const options = lock ? { lock: { mode: 'pessimistic_write' as const } } : {};
		return (
			(await m.findOne(WalletAccount, { where: { userId, isDefault: true }, order: { created_at: 'ASC' }, ...options })) ??
			(await m.findOne(WalletAccount, { where: { userId }, order: { created_at: 'ASC' }, ...options }))
		);
	}

	/** Locked default wallet; created on first use. Names stay unique per user, including soft-deleted ones. */
	private async ensureWallet(m: EntityManager, userId: string): Promise<WalletAccount> {
		const existing = await this.findWallet(m, userId, true);
		if (existing) return existing;
		const taken = new Set(
			(await m.find(WalletAccount, { where: { userId }, withDeleted: true, select: { id: true, name: true } })).map(
				(w) => w.name,
			),
		);
		let name = DEFAULT_WALLET_NAME;
		for (let i = 2; taken.has(name); i++) name = `${DEFAULT_WALLET_NAME} ${i}`;
		return m.save(m.create(WalletAccount, { userId, name, openingBalance: '0.00', isDefault: true }));
	}
}
