import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { User } from 'entities/global.entity';

export enum SubscriptionTier {
  FREE = 'free',
  BASIC = 'basic',
  PROFESSIONAL = 'professional',
  ENTERPRISE = 'enterprise',
}

export enum TransactionType {
  DEPOSIT = 'deposit',
  WITHDRAWAL = 'withdrawal',
  CLIENT_PAYMENT = 'client_payment',
  SUBSCRIPTION_CHARGE = 'subscription_charge',
  REFUND = 'refund',
  COMMISSION = 'commission',
}

export enum TransactionStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export enum WithdrawalStatus {
  REQUESTED = 'requested',
  APPROVED = 'approved',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  REJECTED = 'rejected',
}

@Entity('wallets')
@Index(['adminId'])
export class Wallet {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  admin: User;

  @Column('uuid')
  adminId: string;

  @Column('decimal', { precision: 12, scale: 2, default: 0 })
  balance: number;

  @Column('decimal', { precision: 12, scale: 2, default: 0 })
  totalEarned: number;

  @Column('decimal', { precision: 12, scale: 2, default: 0 })
  totalWithdrawn: number;

  @Column({ default: 'USD' })
  currency: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

@Entity('transactions')
@Index(['adminId'])
@Index(['type'])
@Index(['status'])
@Index(['createdAt'])
export class Transaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  admin: User;

  @Column('uuid')
  adminId: string;

  @Column('uuid', { nullable: true })
  clientId?: string;

  @Column({
    type: 'enum',
    enum: TransactionType,
  })
  type: TransactionType;

  @Column({
    type: 'enum',
    enum: TransactionStatus,
    default: TransactionStatus.PENDING,
  })
  status: TransactionStatus;

  @Column('decimal', { precision: 12, scale: 2 })
  amount: number;

  @Column({ nullable: true })
  description?: string;

  @Column({ nullable: true })
  referenceId?: string;

  @Column('json', { nullable: true })
  metadata?: Record<string, any>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

@Entity('admin_subscriptions')
@Index(['adminId'])
export class AdminSubscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  admin: User;

  @Column('uuid')
  adminId: string;

  @Column({
    type: 'enum',
    enum: SubscriptionTier,
    default: SubscriptionTier.FREE,
  })
  tier: SubscriptionTier;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  monthlyPrice?: number;

  @Column()
  expiresAt: Date;

  @Column({ default: false })
  autoRenew: boolean;

  @Column({ default: true })
  isActive: boolean;

  @Column('json', { nullable: true })
  features?: Record<string, any>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

@Entity('withdrawal_requests')
@Index(['adminId'])
@Index(['status'])
export class WithdrawalRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  admin: User;

  @Column('uuid')
  adminId: string;

  @Column('decimal', { precision: 12, scale: 2 })
  amount: number;

  @Column({
    type: 'enum',
    enum: WithdrawalStatus,
    default: WithdrawalStatus.REQUESTED,
  })
  status: WithdrawalStatus;

  @Column({ nullable: true })
  bankAccountNumber?: string;

  @Column({ nullable: true })
  bankName?: string;

  @Column({ nullable: true })
  accountHolderName?: string;

  @Column({ nullable: true })
  rejectionReason?: string;

  @Column('json', { nullable: true })
  metadata?: Record<string, any>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ nullable: true })
  processedAt?: Date;

  @Column('uuid', { nullable: true })
  processedBy?: string;
}

@Entity('client_payments')
@Index(['adminId'])
@Index(['clientId'])
export class ClientPayment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  admin: User;

  @Column('uuid')
  adminId: string;

  @Column('uuid')
  clientId: string;

  @Column('decimal', { precision: 12, scale: 2 })
  amount: number;

  @Column('text', { nullable: true })
  description?: string;

  @Column({ nullable: true })
  invoiceId?: string;

  @Column({
    type: 'enum',
    enum: TransactionStatus,
    default: TransactionStatus.PENDING,
  })
  status: TransactionStatus;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ nullable: true })
  paidAt?: Date;
}
