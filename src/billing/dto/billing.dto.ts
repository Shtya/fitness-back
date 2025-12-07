import { IsEnum, IsDecimal, IsString, IsOptional, IsUUID, IsEmail, IsDateString } from 'class-validator';
import { SubscriptionTier, TransactionType, TransactionStatus, WithdrawalStatus } from '../../../entities/billing.entity';

// Wallet DTOs
export class WalletDto {
  id: string;
  adminId: string;
  balance: number;
  totalEarned: number;
  totalWithdrawn: number;
  currency: string;
  createdAt: Date;
  updatedAt: Date;

	@IsOptional()
	lang?: string;
}

// Transaction DTOs
export class CreateTransactionDto {
  @IsUUID()
  adminId: string;

  @IsOptional()
  @IsUUID()
  clientId?: string;

  @IsEnum(TransactionType)
  type: TransactionType;

  @IsDecimal()
  amount: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  referenceId?: string;

  @IsOptional()
  metadata?: Record<string, any>;

	@IsOptional()
	lang?: string;
}

export class TransactionDto {
  id: string;
  adminId: string;
  clientId?: string;
  type: TransactionType;
  status: TransactionStatus;
  amount: number;
  description?: string;
  referenceId?: string;
  createdAt: Date;
  updatedAt: Date;@IsOptional()
	lang?: string;
}

export class TransactionFilterDto {
  @IsOptional()
  @IsEnum(TransactionType)
  type?: TransactionType;

	@IsOptional()
	lang?: string;

  @IsOptional()
  @IsEnum(TransactionStatus)
  status?: TransactionStatus;

  @IsOptional()
  page?: number;

  @IsOptional()
  limit?: number;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}

// Subscription DTOs
export class CreateSubscriptionDto {
  @IsUUID()
  adminId: string;

  @IsEnum(SubscriptionTier)
  tier: SubscriptionTier;

	@IsOptional()
	lang?: string;

  @IsOptional()
  @IsDecimal()
  monthlyPrice?: number;

  @IsDateString()
  expiresAt: Date;

  @IsOptional()
  autoRenew?: boolean;
}

export class SubscriptionDto {
  id: string;
  adminId: string;
  tier: SubscriptionTier;
  monthlyPrice?: number;
  expiresAt: Date;
  autoRenew: boolean;
  isActive: boolean;
  features?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;

	@IsOptional()
	lang?: string;
}

// Withdrawal DTOs
export class CreateWithdrawalDto {
  @IsUUID()
  adminId: string;

  @IsDecimal()
  amount: number;

  @IsString()
  bankAccountNumber: string;

  @IsString()
  bankName: string;

  @IsString()
  accountHolderName: string;

  @IsOptional()
  metadata?: Record<string, any>;
	@IsOptional()
	lang?: string;
}

export class WithdrawalDto {
  id: string;
  adminId: string;
  amount: number;
  status: WithdrawalStatus;
  bankAccountNumber: string;
  bankName: string;
  accountHolderName: string;
  rejectionReason?: string;
  createdAt: Date;
  processedAt?: Date;
  processedBy?: string;
}

export class UpdateWithdrawalStatusDto {
  @IsEnum(WithdrawalStatus)
  status: WithdrawalStatus;

  @IsOptional()
  @IsString()
  rejectionReason?: string;

  @IsOptional()
  metadata?: Record<string, any>;
	
	@IsOptional()
	lang?: string;
}

// Client Payment DTOs
export class CreateClientPaymentDto {
  @IsUUID()
  adminId: string;

  @IsUUID()
  clientId: string;

  @IsDecimal()
  amount: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  invoiceId?: string;
	
}

export class ClientPaymentDto {
  id: string;
  adminId: string;
  clientId: string;
  amount: number;
  description?: string;
  invoiceId?: string;
  status: TransactionStatus;
  createdAt: Date;
  paidAt?: Date;
}

// Admin Analytics DTOs
export class AdminAnalyticsDto {
  totalBalance: number;
  totalEarned: number;
  totalWithdrawn: number;
  totalSubscribers: number;
  activeSubscriptions: number;
  expiredSubscriptions: number;
  pendingWithdrawals: number;
  transactionCount: number;
  averageTransactionAmount: number;
}

export class AdminBillingOverviewDto {
  walletBalance: number;
  monthlyRevenue: number;
  pendingPayments: number;
  subscriptionStatus: {
    tier: SubscriptionTier;
    expiresAt: Date;
    isActive: boolean;
  };
  recentTransactions: TransactionDto[];
  withdrawalRequests: WithdrawalDto[];
}

// Super Admin Reports
export class SystemBillingReportDto {
  totalAdmins: number;
  totalBalance: number;
  totalTransactions: number;
  totalRevenue: number;
  activeSubscriptions: number;
  pendingWithdrawals: number;
  averageWalletBalance: number;
}
