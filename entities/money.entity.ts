// src/entities/money.entity.ts

import {
	Entity,
	Column,
	Index,
	ManyToOne,
	OneToMany,
	JoinColumn,
	Unique,
} from 'typeorm';
import { CoreEntity } from './core.entity';
import { User } from './global.entity';

/* =========================================================
 * Enums
 * ======================================================= */

export enum MoneyCurrency {
	EGP = 'EGP',
	USD = 'USD',
	EUR = 'EUR',
}

export enum RecurrenceType {
	MONTHLY = 'monthly',
	WEEKLY = 'weekly',
	CUSTOM_MONTHS = 'custom_months',
}

export enum CommitmentType {
	FIXED = 'التزام',
	SUBSCRIPTION = 'اشتراك',
	JAMIA = 'جمعية',
}

export enum CommitmentStatus {
	PENDING = 'pending',
	PAID = 'paid',
	OVERDUE = 'overdue',
	CANCELLED = 'cancelled',
}

export enum FinanceNotificationType {
	WARN = 'warn',
	OK = 'ok',
	ALERT = 'alert',
}


@Entity('wallet_accounts')
@Unique(['userId', 'name'])
export class WalletAccount extends CoreEntity {
	@ManyToOne(() => User, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'user_id' })
	user!: User;

	@Index()
	@Column({ type: 'uuid', name: 'user_id' })
	userId!: string;

	@Index()
	@Column({ type: 'varchar', length: 120, default: 'Main Wallet' })
	name!: string;

	@Column({ type: 'enum', enum: MoneyCurrency, default: MoneyCurrency.EGP })
	currency!: MoneyCurrency;

	// this matches your UI seed like: 14250 + net
	@Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
	openingBalance!: string;

	@Column({ type: 'boolean', default: true })
	isDefault!: boolean;

	@Column({ type: 'text', nullable: true })
	notes?: string | null;

	@OneToMany(() => IncomeEntry, (income) => income.account)
	incomes!: IncomeEntry[];

	@OneToMany(() => ExpenseEntry, (expense) => expense.account)
	expenses!: ExpenseEntry[];

	@OneToMany(() => FinancialCommitment, (commitment) => commitment.account)
	commitments!: FinancialCommitment[];

	@OneToMany(() => ZakatLog, (zakat) => zakat.account)
	zakatLogs!: ZakatLog[];
}

/* =========================================================
 * Income
 * ======================================================= */

@Entity('income_entries')
export class IncomeEntry extends CoreEntity {
	@ManyToOne(() => User, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'user_id' })
	user!: User;

	@Index()
	@Column({ type: 'uuid', name: 'user_id' })
	userId!: string;

	@ManyToOne(() => WalletAccount, (account) => account.incomes, {
		nullable: true,
		onDelete: 'SET NULL',
	})
	@JoinColumn({ name: 'account_id' })
	account?: WalletAccount | null;

	@Index()
	@Column({ type: 'uuid', name: 'account_id', nullable: true })
	accountId?: string | null;

	// source in UI: company / freelance / bonus
	@Index()
	@Column({ type: 'varchar', length: 180 })
	source!: string;

	@Column({ type: 'text', nullable: true })
	notes?: string | null;

	@Column({ type: 'decimal', precision: 12, scale: 2 })
	amount!: string;

	@Index()
	@Column({ type: 'date' })
	date!: string;

	@Column({ type: 'boolean', default: false })
	recurring!: boolean;

	@Column({
		type: 'enum',
		enum: RecurrenceType,
		default: RecurrenceType.MONTHLY,
		nullable: true,
	})
	recurrenceType?: RecurrenceType | null;

	@Column({ type: 'int', default: 1 })
	recurrenceEvery!: number;

	@Column({ type: 'boolean', default: true })
	isActive!: boolean;
}

/* =========================================================
 * Expenses
 * ======================================================= */

@Entity('expense_entries')
export class ExpenseEntry extends CoreEntity {
	@ManyToOne(() => User, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'user_id' })
	user!: User;

	@Index()
	@Column({ type: 'uuid', name: 'user_id' })
	userId!: string;

	@ManyToOne(() => WalletAccount, (account) => account.expenses, {
		nullable: true,
		onDelete: 'SET NULL',
	})
	@JoinColumn({ name: 'account_id' })
	account?: WalletAccount | null;

	@Index()
	@Column({ type: 'uuid', name: 'account_id', nullable: true })
	accountId?: string | null;

	@Index()
	@Column({ type: 'varchar', length: 180 })
	description!: string;

	@Column({ type: 'varchar', length: 120, nullable: true })
	category?: string | null;

	@Column({ type: 'text', nullable: true })
	notes?: string | null;

	@Column({ type: 'decimal', precision: 12, scale: 2 })
	amount!: string;

	@Index()
	@Column({ type: 'date' })
	date!: string;

	@Column({ type: 'boolean', default: false })
	recurring!: boolean;

	@Column({
		type: 'enum',
		enum: RecurrenceType,
		default: RecurrenceType.MONTHLY,
		nullable: true,
	})
	recurrenceType?: RecurrenceType | null;

	@Column({ type: 'int', default: 1 })
	recurrenceEvery!: number;

	@Column({ type: 'boolean', default: true })
	isActive!: boolean;
}

/* =========================================================
 * Commitments
 * ======================================================= */

@Entity('financial_commitments')
export class FinancialCommitment extends CoreEntity {
	@ManyToOne(() => User, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'user_id' })
	user!: User;

	@Index()
	@Column({ type: 'uuid', name: 'user_id' })
	userId!: string;

	@ManyToOne(() => WalletAccount, (account) => account.commitments, {
		nullable: true,
		onDelete: 'SET NULL',
	})
	@JoinColumn({ name: 'account_id' })
	account?: WalletAccount | null;

	@Index()
	@Column({ type: 'uuid', name: 'account_id', nullable: true })
	accountId?: string | null;

	@Index()
	@Column({ type: 'varchar', length: 180 })
	name!: string;

	@Index()
	@Column({ type: 'enum', enum: CommitmentType, default: CommitmentType.FIXED })
	type!: CommitmentType;

	@Column({ type: 'decimal', precision: 12, scale: 2 })
	amount!: string;

	@Index()
	@Column({ type: 'date' })
	dueDate!: string;

	@Index()
	@Column({
		type: 'enum',
		enum: CommitmentStatus,
		default: CommitmentStatus.PENDING,
	})
	status!: CommitmentStatus;

	@Column({ type: 'boolean', default: true })
	recurring!: boolean;

	@Column({
		type: 'enum',
		enum: RecurrenceType,
		default: RecurrenceType.MONTHLY,
		nullable: true,
	})
	recurrenceType?: RecurrenceType | null;

	@Column({ type: 'int', default: 1 })
	recurrenceEvery!: number;

	/* Jamia only */
	@Column({ type: 'varchar', length: 7, nullable: true })
	jamiaStart?: string | null; // YYYY-MM

	@Column({ type: 'varchar', length: 7, nullable: true })
	jamiaEnd?: string | null; // YYYY-MM

	@Column({ type: 'varchar', length: 7, nullable: true })
	jamiaMyMonth?: string | null; // YYYY-MM

	@Column({ type: 'text', nullable: true })
	notes?: string | null;
}

/* =========================================================
 * Zakat / Charity Log
 * ======================================================= */

@Entity('zakat_logs')
export class ZakatLog extends CoreEntity {
	@ManyToOne(() => User, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'user_id' })
	user!: User;

	@Index()
	@Column({ type: 'uuid', name: 'user_id' })
	userId!: string;

	@ManyToOne(() => WalletAccount, (account) => account.zakatLogs, {
		nullable: true,
		onDelete: 'SET NULL',
	})
	@JoinColumn({ name: 'account_id' })
	account?: WalletAccount | null;

	@Index()
	@Column({ type: 'uuid', name: 'account_id', nullable: true })
	accountId?: string | null;

	@Column({ type: 'varchar', length: 180 })
	description!: string;

	@Column({ type: 'decimal', precision: 12, scale: 2 })
	amount!: string;

	@Index()
	@Column({ type: 'date' })
	date!: string;

	@Column({ type: 'boolean', default: false })
	isZakat!: boolean;

	@Column({ type: 'text', nullable: true })
	notes?: string | null;
}

/* =========================================================
 * Finance Notifications
 * ======================================================= */

@Entity('finance_notifications')
export class FinanceNotification extends CoreEntity {
	@ManyToOne(() => User, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'user_id' })
	user!: User;

	@Index()
	@Column({ type: 'uuid', name: 'user_id' })
	userId!: string;

	@Index()
	@Column({
		type: 'enum',
		enum: FinanceNotificationType,
		default: FinanceNotificationType.WARN,
	})
	type!: FinanceNotificationType;

	@Column({ type: 'varchar', length: 255 })
	text!: string;

	@Column({ type: 'varchar', length: 100, nullable: true })
	timeLabel?: string | null; // e.g. "منذ ساعة"

	@Column({ type: 'boolean', default: false })
	isRead!: boolean;

	@Column({ type: 'jsonb', nullable: true })
	meta?: Record<string, any> | null;
}






/* =========================================================
 * Expected Income / Money
 * ======================================================= */

@Entity('expected_entries')
export class ExpectedEntry extends CoreEntity {
	@ManyToOne(() => User, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'user_id' })
	user!: User;

	@Index()
	@Column({ type: 'uuid', name: 'user_id' })
	userId!: string;

	@ManyToOne(() => WalletAccount, {
		nullable: true,
		onDelete: 'SET NULL',
	})
	@JoinColumn({ name: 'account_id' })
	account?: WalletAccount | null;

	@Index()
	@Column({ type: 'uuid', name: 'account_id', nullable: true })
	accountId?: string | null;

	@Index()
	@Column({ type: 'varchar', length: 180 })
	description!: string;

	@Column({ type: 'decimal', precision: 12, scale: 2 })
	amount!: string;

	@Index()
	@Column({ type: 'date' })
	expectedDate!: string;

	@Column({ type: 'text', nullable: true })
	notes?: string | null;
}