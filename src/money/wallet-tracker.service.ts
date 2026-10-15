import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { ExpectedEntry, GoldHolding, IncomeEntry, WalletAccount } from 'entities/money.entity';
import { isYmd, todayYmd } from '../billing/billing-rules';
import { goldValue } from './gold-price';
import { GoldPriceService } from './gold-price.service';
import {
	CreateGoldHoldingDto,
	CreateTrackerItemDto,
	TrackerBalanceDto,
	UpdateGoldHoldingDto,
	UpdateTrackerItemDto,
} from './wallet-tracker.dto';
import {
	centsToDecimal,
	fromCents,
	nextBalanceCents,
	summarizeTracker,
	toCents,
	TrackerItem,
	TrackerItemKind,
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
	) {}

	async getTracker(userId: string) {
		const m = this.dataSource.manager;
		const [wallet, pending, received, gold] = await Promise.all([
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
		]);
		const items: TrackerItem[] = [
			...pending.map((row) => this.toItem('pending', row.id, row.description, row.amount, row.expectedDate, row.notes)),
			...received.map((row) => this.toItem('received', row.id, row.source, row.amount, row.date, row.notes)),
		];
		const balanceCents = toCents(wallet?.openingBalance);
		return {
			wallet: wallet ? { id: wallet.id, name: wallet.name, currency: wallet.currency } : null,
			summary: summarizeTracker(balanceCents, items, todayYmd()),
			items,
			gold,
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
		const amount = centsToDecimal(toCents(dto.amount));
		const notes = dto.notes?.trim() || null;
		await this.dataSource.transaction(async (m) => {
			if (!dto.received) {
				await m.save(m.create(ExpectedEntry, { userId, description: name, amount, expectedDate: date, notes }));
				return;
			}
			const wallet = await this.ensureWallet(m, userId);
			await m.save(m.create(IncomeEntry, { userId, accountId: wallet.id, source: name, amount, date, notes, isActive: true }));
			await this.moveBalance(m, wallet, toCents(amount));
		});
		return this.getTracker(userId);
	}

	async updateItem(userId: string, kind: TrackerItemKind, id: string, dto: UpdateTrackerItemDto) {
		const date = this.cleanDate(dto.date);
		await this.dataSource.transaction(async (m) => {
			if (kind === 'pending') {
				const row = await this.lockPending(m, userId, id);
				if (dto.name !== undefined) row.description = this.cleanName(dto.name);
				if (dto.amount !== undefined) row.amount = centsToDecimal(toCents(dto.amount));
				if (date) row.expectedDate = date;
				if (dto.notes !== undefined) row.notes = dto.notes.trim() || null;
				await m.save(row);
				return;
			}
			const wallet = await this.ensureWallet(m, userId);
			const row = await this.lockReceived(m, userId, id);
			const before = toCents(row.amount);
			if (dto.name !== undefined) row.source = this.cleanName(dto.name);
			if (dto.amount !== undefined) row.amount = centsToDecimal(toCents(dto.amount));
			if (date) row.date = date;
			if (dto.notes !== undefined) row.notes = dto.notes.trim() || null;
			await m.save(row);
			await this.moveBalance(m, wallet, toCents(row.amount) - before);
		});
		return this.getTracker(userId);
	}

	/** Received ⇄ not received. Receiving adds the amount to the balance; undoing takes it back out. */
	async toggleItem(userId: string, kind: TrackerItemKind, id: string) {
		await this.dataSource.transaction(async (m) => {
			const wallet = await this.ensureWallet(m, userId);
			if (kind === 'pending') {
				const row = await this.lockPending(m, userId, id);
				await m.save(
					m.create(IncomeEntry, {
						userId,
						accountId: wallet.id,
						source: row.description,
						amount: row.amount,
						date: todayYmd(),
						notes: row.notes ?? null,
						isActive: true,
					}),
				);
				await m.softRemove(row);
				await this.moveBalance(m, wallet, toCents(row.amount));
				return;
			}
			const row = await this.lockReceived(m, userId, id);
			await m.save(
				m.create(ExpectedEntry, {
					userId,
					description: row.source,
					amount: row.amount,
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

	private toItem(kind: TrackerItemKind, id: string, name: string, amount: string, date: string, notes?: string | null): TrackerItem {
		return { id, kind, name, amount: fromCents(toCents(amount)), date: String(date).slice(0, 10), notes: notes ?? null };
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
