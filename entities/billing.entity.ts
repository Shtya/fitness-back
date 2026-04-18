// src/entities/billing.entity.ts
import {
  Entity,
  Column,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  Unique,
} from 'typeorm';
import { CoreEntity } from './core.entity';
import { User } from './global.entity';

export enum BillingInterval {
  MONTHLY = 'monthly',
  QUARTERLY = 'quarterly',
  YEARLY = 'yearly',
  ONE_TIME = 'one_time',
}

export enum BillingPlanStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  ARCHIVED = 'archived',
}

export enum SubscriptionStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  PAST_DUE = 'past_due',
  CANCELED = 'canceled',
  EXPIRED = 'expired',
  TRIALING = 'trialing',
}

export enum InvoiceStatus {
  DRAFT = 'draft',
  OPEN = 'open',
  PAID = 'paid',
  VOID = 'void',
  UNCOLLECTIBLE = 'uncollectible',
  REFUNDED = 'refunded',
}

export enum PaymentStatus {
  PENDING = 'pending',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
  CANCELED = 'canceled',
  REFUNDED = 'refunded',
}

export enum PaymentMethodType {
  CASH = 'cash',
  CARD = 'card',
  WALLET = 'wallet',
  BANK_TRANSFER = 'bank_transfer',
  FAWRY = 'fawry',
  PAYMOB = 'paymob',
  STRIPE = 'stripe',
  PAYPAL = 'paypal',
  OTHER = 'other',
}

export enum ClientNoteType {
  GENERAL = 'general',
  WARNING = 'warning',
  NUTRITION = 'nutrition',
  WORKOUT = 'workout',
  FOLLOW_UP = 'follow_up',
}

export enum CommunicationType {
  REMINDER = 'reminder',
  WHATSAPP = 'whatsapp',
  PLAN_OFFER = 'plan_offer',
  RENEWAL = 'renewal',
  FOLLOW_UP = 'follow_up',
  OTHER = 'other',
}

@Entity('billing_plans')
@Unique(['name'])
export class BillingPlan extends CoreEntity {
  @Index()
  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  @Column({ type: 'enum', enum: BillingInterval, default: BillingInterval.MONTHLY })
  interval!: BillingInterval;

  @Column({ type: 'int', default: 1 })
  intervalCount!: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  price!: string;

  @Column({ type: 'varchar', length: 10, default: 'EGP' })
  currency!: string;

  @Column({ type: 'int', nullable: true })
  durationDays?: number | null;

  @Column({ type: 'int', nullable: true })
  trialDays?: number | null;

  @Column({ type: 'boolean', default: false })
  isPopular!: boolean;

  @Column({ type: 'enum', enum: BillingPlanStatus, default: BillingPlanStatus.ACTIVE })
  status!: BillingPlanStatus;

  @Column('text', { array: true, default: '{}' })
  features!: string[];

  @Index()
  @Column({ type: 'uuid', nullable: true })
  adminId?: string | null;

  @OneToMany(() => UserSubscription, (sub) => sub.plan)
  subscriptions!: UserSubscription[];

  @OneToMany(() => BillingInvoice, (invoice) => invoice.plan)
  invoices!: BillingInvoice[];
}

@Entity('user_subscriptions')
@Index(['userId', 'status'])
export class UserSubscription extends CoreEntity {
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Index()
  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => BillingPlan, { nullable: true, onDelete: 'SET NULL', eager: true })
  @JoinColumn({ name: 'planId' })
  plan!: BillingPlan | null;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  planId!: string | null;

  @Column({ type: 'enum', enum: SubscriptionStatus, default: SubscriptionStatus.PENDING })
  status!: SubscriptionStatus;

  @Column({ type: 'date', nullable: true })
  startDate!: string | null;

  @Column({ type: 'date', nullable: true })
  endDate!: string | null;

  @Column({ type: 'date', nullable: true })
  renewAt!: string | null;

  @Column({ type: 'boolean', default: true })
  autoRenew!: boolean;

  @Column({ type: 'date', nullable: true })
  canceledAt!: string | null;

  @Column({ type: 'text', nullable: true })
  cancelReason?: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  externalSubscriptionId?: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  provider?: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  priceAtPurchase?: string | null;

  @Column({ type: 'varchar', length: 10, default: 'EGP' })
  currency!: string;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;

  @OneToMany(() => BillingInvoice, (invoice) => invoice.subscription)
  invoices!: BillingInvoice[];
}

@Entity('billing_invoices')
@Unique(['invoiceNumber'])
@Index(['userId', 'status'])
export class BillingInvoice extends CoreEntity {
  @ManyToOne(() => User, { onDelete: 'CASCADE', eager: true })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Index()
  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => BillingPlan, { nullable: true, onDelete: 'SET NULL', eager: true })
  @JoinColumn({ name: 'planId' })
  plan!: BillingPlan | null;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  planId!: string | null;

  @ManyToOne(() => UserSubscription, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'subscriptionId' })
  subscription!: UserSubscription | null;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  subscriptionId!: string | null;

  @Index()
  @Column({ type: 'varchar', length: 50 })
  invoiceNumber!: string;

  @Column({ type: 'enum', enum: InvoiceStatus, default: InvoiceStatus.OPEN })
  status!: InvoiceStatus;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  subtotal!: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  discount!: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  tax!: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  total!: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  amountPaid!: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  amountDue!: string;

  @Column({ type: 'varchar', length: 10, default: 'EGP' })
  currency!: string;

  @Column({ type: 'date', nullable: true })
  issueDate!: string | null;

  @Column({ type: 'date', nullable: true })
  dueDate!: string | null;

  @Column({ type: 'date', nullable: true })
  paidAt!: string | null;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  @Column({ type: 'jsonb', nullable: true })
  items?: Array<{
    title: string;
    description?: string;
    qty: number;
    unitPrice: number;
    total: number;
  }> | null;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;

  @OneToMany(() => PaymentTransaction, (payment) => payment.invoice)
  payments!: PaymentTransaction[];
}

@Entity('payment_transactions')
@Index(['userId', 'status'])
export class PaymentTransaction extends CoreEntity {
  @ManyToOne(() => User, { onDelete: 'CASCADE', eager: true })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Index()
  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => BillingInvoice, (invoice) => invoice.payments, {
    nullable: true,
    onDelete: 'SET NULL',
    eager: true,
  })
  @JoinColumn({ name: 'invoiceId' })
  invoice!: BillingInvoice | null;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  invoiceId!: string | null;

  @Column({ type: 'enum', enum: PaymentMethodType, default: PaymentMethodType.CARD })
  paymentMethod!: PaymentMethodType;

  @Column({ type: 'enum', enum: PaymentStatus, default: PaymentStatus.PENDING })
  status!: PaymentStatus;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount!: string;

  @Column({ type: 'varchar', length: 10, default: 'EGP' })
  currency!: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  provider?: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  transactionId?: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  referenceNumber?: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  externalPaymentIntentId?: string | null;

  @Column({ type: 'date', nullable: true })
  paidAt!: string | null;

  @Column({ type: 'text', nullable: true })
  failureReason?: string | null;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any> | null;
}

@Entity('client_notes')
@Index(['clientId', 'isPinned'])
export class ClientNote extends CoreEntity {
  @ManyToOne(() => User, { onDelete: 'CASCADE', eager: true })
  @JoinColumn({ name: 'clientId' })
  client!: User;

  @Column({ type: 'uuid' })
  clientId!: string;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true, eager: true })
  @JoinColumn({ name: 'authorId' })
  author!: User | null;

  @Column({ type: 'uuid', nullable: true })
  authorId!: string | null;

  @Column({ type: 'enum', enum: ClientNoteType, default: ClientNoteType.GENERAL })
  type!: ClientNoteType;

  @Column({ type: 'text' })
  text!: string;

  @Column({ type: 'boolean', default: false })
  isPinned!: boolean;
}

@Entity('client_communications')
@Index(['clientId', 'type'])
export class ClientCommunication extends CoreEntity {
  @ManyToOne(() => User, { onDelete: 'CASCADE', eager: true })
  @JoinColumn({ name: 'clientId' })
  client!: User;

  @Column({ type: 'uuid' })
  clientId!: string;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true, eager: true })
  @JoinColumn({ name: 'coachId' })
  coach!: User | null;

  @Column({ type: 'uuid', nullable: true })
  coachId!: string | null;

  @Column({ type: 'enum', enum: CommunicationType, default: CommunicationType.OTHER })
  type!: CommunicationType;

  @Column({ type: 'text', nullable: true })
  template!: string | null;

  @Column({ type: 'text', nullable: true })
  message!: string | null;

  @Column({ type: 'varchar', length: 16, default: 'sent' })
  status!: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any> | null;
}