import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan, LessThan, Between } from 'typeorm';
import {
	Wallet,
	Transaction,
	AdminSubscription,
	WithdrawalRequest,
	ClientPayment,
	TransactionType,
	TransactionStatus,
	SubscriptionTier,
	WithdrawalStatus,
} from 'entities/billing.entity';

import {
	CreateTransactionDto,
	CreateSubscriptionDto,
	CreateWithdrawalDto,
	UpdateWithdrawalStatusDto,
	CreateClientPaymentDto,
	AdminAnalyticsDto,
	AdminBillingOverviewDto,
	SystemBillingReportDto,
	TransactionFilterDto,
} from './dto/billing.dto';

@Injectable()
export class BillingService {
	constructor(
		@InjectRepository(Wallet) private walletRepo: Repository<Wallet>,
		@InjectRepository(Transaction) private transactionRepo: Repository<Transaction>,
		@InjectRepository(AdminSubscription) private subscriptionRepo: Repository<AdminSubscription>,
		@InjectRepository(WithdrawalRequest) private withdrawalRepo: Repository<WithdrawalRequest>,
		@InjectRepository(ClientPayment) private clientPaymentRepo: Repository<ClientPayment>,
	) { }

	// ============= WALLET OPERATIONS =============

	async getOrCreateWallet(adminId: string): Promise<Wallet> {
		let wallet = await this.walletRepo.findOne({ where: { adminId } });
		if (!wallet) {
			wallet = this.walletRepo.create({
				adminId,
				balance: 0,
				totalEarned: 0,
				totalWithdrawn: 0,
				currency: 'USD',
			});
			await this.walletRepo.save(wallet);
		}
		return wallet;
	}

	async getWalletBalance(adminId: string): Promise<Wallet> {
		const wallet = await this.walletRepo.findOne({ where: { adminId } });
		if (!wallet) {
			throw new NotFoundException('Wallet not found');
		}
		return wallet;
	}

	async addFundsToWallet(adminId: string, amount: number, type: TransactionType): Promise<Wallet> {
		if (amount <= 0) {
			throw new BadRequestException('Amount must be greater than 0');
		}

		const wallet = await this.getOrCreateWallet(adminId);
		wallet.balance += amount;
		wallet.totalEarned += amount;

		return this.walletRepo.save(wallet);
	}

	async deductFromWallet(adminId: string, amount: number, type: TransactionType): Promise<Wallet> {
		if (amount <= 0) {
			throw new BadRequestException('Amount must be greater than 0');
		}

		const wallet = await this.getOrCreateWallet(adminId);
		if (wallet.balance < amount) {
			throw new BadRequestException('Insufficient wallet balance');
		}

		wallet.balance -= amount;
		wallet.totalWithdrawn += amount;

		return this.walletRepo.save(wallet);
	}

	// ============= TRANSACTION OPERATIONS =============

	async createTransaction(dto: CreateTransactionDto): Promise<Transaction> {
		const transaction = this.transactionRepo.create({
			...dto,
			status: TransactionStatus.COMPLETED,
		});

		const saved = await this.transactionRepo.save(transaction);

		// Update wallet balance based on transaction type
		if (dto.type === TransactionType.DEPOSIT) {
			await this.addFundsToWallet(dto.adminId, dto.amount, dto.type);
		} else if (dto.type === TransactionType.WITHDRAWAL || dto.type === TransactionType.CLIENT_PAYMENT) {
			await this.deductFromWallet(dto.adminId, dto.amount, dto.type);
		}

		return saved;
	}

	async getTransactions(adminId: string, filter?: TransactionFilterDto) {
		const { page = 1, limit = 20, type, status, startDate, endDate } = filter || {};
		const skip = (page - 1) * limit;

		const qb = this.transactionRepo
			.createQueryBuilder('t')
			.where('t.adminId = :adminId', { adminId })
			.orderBy('t.createdAt', 'DESC')
			.skip(skip)
			.take(limit);

		if (type) {
			qb.andWhere('t.type = :type', { type });
		}
		if (status) {
			qb.andWhere('t.status = :status', { status });
		}
		if (startDate && endDate) {
			qb.andWhere('t.createdAt BETWEEN :start AND :end', {
				start: new Date(startDate),
				end: new Date(endDate),
			});
		}

		const [transactions, total] = await qb.getManyAndCount();

		return {
			data: transactions,
			total,
			page,
			limit,
			pages: Math.ceil(total / limit),
		};
	}

	async getSystemTransactions(filter?: TransactionFilterDto) {
		const { page = 1, limit = 20, type, status, startDate, endDate } = filter || {};
		const skip = (page - 1) * limit;

		const qb = this.transactionRepo
			.createQueryBuilder('t')
			.orderBy('t.createdAt', 'DESC')
			.skip(skip)
			.take(limit);

		if (type) {
			qb.andWhere('t.type = :type', { type });
		}
		if (status) {
			qb.andWhere('t.status = :status', { status });
		}
		if (startDate && endDate) {
			qb.andWhere('t.createdAt BETWEEN :start AND :end', {
				start: new Date(startDate),
				end: new Date(endDate),
			});
		}

		const [transactions, total] = await qb.getManyAndCount();

		return {
			data: transactions,
			total,
			page,
			limit,
			pages: Math.ceil(total / limit),
		};
	}

	// ============= SUBSCRIPTION OPERATIONS =============

	async createSubscription(dto: CreateSubscriptionDto): Promise<AdminSubscription> {
		// Deactivate existing active subscription
		await this.subscriptionRepo.update({ adminId: dto.adminId, isActive: true }, { isActive: false });

		const subscription = this.subscriptionRepo.create(dto);
		return this.subscriptionRepo.save(subscription);
	}

	async getSubscription(adminId: string): Promise<AdminSubscription> {
		const subscription = await this.subscriptionRepo.findOne({
			where: { adminId },
			order: { createdAt: 'DESC' },
		});

		if (!subscription) {
			// Create free tier by default
			return this.createSubscription({
				adminId,
				tier: SubscriptionTier.FREE,
				expiresAt: new Date('2099-12-31'),
			});
		}

		return subscription;
	}

	async renewSubscription(adminId: string): Promise<AdminSubscription> {
		const current = await this.getSubscription(adminId);

		if (current.tier === SubscriptionTier.FREE) {
			throw new BadRequestException('Cannot renew free subscription');
		}

		const expiresAt = new Date();
		expiresAt.setMonth(expiresAt.getMonth() + 1);

		const renewed = this.subscriptionRepo.create({
			adminId,
			tier: current.tier,
			monthlyPrice: current.monthlyPrice,
			expiresAt,
			autoRenew: current.autoRenew,
		});

		return this.subscriptionRepo.save(renewed);
	}

	async getActiveSubscriptions(adminId: string): Promise<AdminSubscription[]> {
		return this.subscriptionRepo.find({
			where: { adminId, isActive: true },
		});
	}

	// ============= WITHDRAWAL OPERATIONS =============

	async requestWithdrawal(dto: CreateWithdrawalDto): Promise<WithdrawalRequest> {
		const wallet = await this.getWalletBalance(dto.adminId);

		if (wallet.balance < dto.amount) {
			throw new BadRequestException('Insufficient balance for withdrawal');
		}

		const withdrawal = this.withdrawalRepo.create(dto);
		return this.withdrawalRepo.save(withdrawal);
	}

	async getWithdrawalRequests(adminId?: string, status?: WithdrawalStatus, page = 1, limit = 20) {
		const skip = (page - 1) * limit;
		const qb = this.withdrawalRepo
			.createQueryBuilder('w')
			.orderBy('w.createdAt', 'DESC')
			.skip(skip)
			.take(limit);

		if (adminId) {
			qb.where('w.adminId = :adminId', { adminId });
		}
		if (status) {
			qb.andWhere('w.status = :status', { status });
		}

		const [withdrawals, total] = await qb.getManyAndCount();

		return {
			data: withdrawals,
			total,
			page,
			limit,
			pages: Math.ceil(total / limit),
		};
	}

	async approveWithdrawal(withdrawalId: string, processedBy: string): Promise<WithdrawalRequest> {
		const withdrawal = await this.withdrawalRepo.findOne({ where: { id: withdrawalId } });
		if (!withdrawal) {
			throw new NotFoundException('Withdrawal request not found');
		}

		withdrawal.status = WithdrawalStatus.APPROVED;
		withdrawal.processedBy = processedBy;
		withdrawal.processedAt = new Date();

		return this.withdrawalRepo.save(withdrawal);
	}

	async rejectWithdrawal(withdrawalId: string, reason: string, processedBy: string): Promise<WithdrawalRequest> {
		const withdrawal = await this.withdrawalRepo.findOne({ where: { id: withdrawalId } });
		if (!withdrawal) {
			throw new NotFoundException('Withdrawal request not found');
		}

		// Restore balance if previously deducted
		if (withdrawal.status === WithdrawalStatus.PROCESSING) {
			const wallet = await this.getOrCreateWallet(withdrawal.adminId);
			wallet.balance += withdrawal.amount;
			wallet.totalWithdrawn -= withdrawal.amount;
			await this.walletRepo.save(wallet);
		}

		withdrawal.status = WithdrawalStatus.REJECTED;
		withdrawal.rejectionReason = reason;
		withdrawal.processedBy = processedBy;
		withdrawal.processedAt = new Date();

		return this.withdrawalRepo.save(withdrawal);
	}

	async completeWithdrawal(withdrawalId: string, processedBy: string): Promise<WithdrawalRequest> {
		const withdrawal = await this.withdrawalRepo.findOne({ where: { id: withdrawalId } });
		if (!withdrawal) {
			throw new NotFoundException('Withdrawal request not found');
		}

		withdrawal.status = WithdrawalStatus.COMPLETED;
		withdrawal.processedBy = processedBy;
		withdrawal.processedAt = new Date();

		return this.withdrawalRepo.save(withdrawal);
	}

	// ============= CLIENT PAYMENT OPERATIONS =============

	async recordClientPayment(dto: CreateClientPaymentDto): Promise<ClientPayment> {
		const payment = this.clientPaymentRepo.create(dto);
		const saved = await this.clientPaymentRepo.save(payment);

		// Deduct from wallet
		await this.deductFromWallet(dto.adminId, dto.amount, TransactionType.CLIENT_PAYMENT);

		return saved;
	}

	async getClientPayments(adminId: string, page = 1, limit = 20) {
		const skip = (page - 1) * limit;

		const [payments, total] = await this.clientPaymentRepo
			.createQueryBuilder('cp')
			.where('cp.adminId = :adminId', { adminId })
			.orderBy('cp.createdAt', 'DESC')
			.skip(skip)
			.take(limit)
			.getManyAndCount();

		return {
			data: payments,
			total,
			page,
			limit,
			pages: Math.ceil(total / limit),
		};
	}

	async markPaymentAsPaid(paymentId: string): Promise<ClientPayment> {
		const payment = await this.clientPaymentRepo.findOne({ where: { id: paymentId } });
		if (!payment) {
			throw new NotFoundException('Payment not found');
		}

		payment.status = TransactionStatus.COMPLETED;
		payment.paidAt = new Date();

		return this.clientPaymentRepo.save(payment);
	}

	// ============= ADMIN ANALYTICS =============

	async getAdminAnalytics(adminId: string): Promise<AdminAnalyticsDto> {
		const wallet = await this.getOrCreateWallet(adminId);
		const subscriptions = await this.getActiveSubscriptions(adminId);
		const [, transactionCount] = await this.transactionRepo.findAndCount({
			where: { adminId },
		});

		const [transactions]: any = await this.transactionRepo.find({
			where: { adminId },
		});
		console.log(transactions);

		const avgTransaction = transactions?.length > 0 ? transactions?.reduce((sum, t) => sum + Number(t.amount), 0) / transactions?.length : 0;

		return {
			totalBalance: Number(wallet.balance),
			totalEarned: Number(wallet.totalEarned),
			totalWithdrawn: Number(wallet.totalWithdrawn),
			totalSubscribers: subscriptions.length,
			activeSubscriptions: subscriptions.filter((s) => s.isActive).length,
			expiredSubscriptions: subscriptions.filter((s) => !s.isActive || new Date(s.expiresAt) < new Date()).length,
			pendingWithdrawals: (await this.withdrawalRepo.count({ where: { adminId, status: WithdrawalStatus.REQUESTED } })),
			transactionCount,
			averageTransactionAmount: avgTransaction,
		};
	}

	async getAdminBillingOverview(adminId: string) {
		const wallet = await this.getWalletBalance(adminId);
		const subscription = await this.getSubscription(adminId);
		const [recentTransactions] = await this.transactionRepo.find({
			where: { adminId },
			order: { createdAt: 'DESC' },
			take: 10,
		});
		const [withdrawalRequests] = await this.withdrawalRepo.find({
			where: { adminId },
			order: { createdAt: 'DESC' },
			take: 5,
		});

		const monthStart = new Date();
		monthStart.setDate(1);
		const [monthTransactions]: any = await this.transactionRepo.find({
			where: {
				adminId,
				createdAt: MoreThan(monthStart),
			},
		});

		const monthlyRevenue: any = monthTransactions.reduce((sum, t) => {
			if (t.type === TransactionType.DEPOSIT) {
				return sum + Number(t.amount);
			}
			return sum;
		}, 0);

		const [pendingPayments]: any = await this.clientPaymentRepo.find({
			where: {
				adminId,
				status: TransactionStatus.PENDING,
			},
		});

		return {
			walletBalance: Number(wallet.balance),
			monthlyRevenue,
			pendingPayments: pendingPayments.length,
			subscriptionStatus: {
				tier: subscription.tier,
				expiresAt: subscription.expiresAt,
				isActive: subscription.isActive,
			},
			recentTransactions: recentTransactions || [],
			withdrawalRequests: withdrawalRequests || [],
		};
	}

	// ============= SUPER ADMIN REPORTS =============

	async getSystemBillingReport(): Promise<SystemBillingReportDto> {
		const [allWallets]: any = await this.walletRepo.find();
		const [allTransactions]: any = await this.transactionRepo.find();
		const [allSubscriptions]: any = await this.subscriptionRepo.find({ where: { isActive: true } });
		const [allWithdrawals]: any = await this.withdrawalRepo.find({ where: { status: WithdrawalStatus.REQUESTED } });

		const totalAdmins = (await this.walletRepo.query('SELECT COUNT(DISTINCT "adminId") FROM wallets'))[0].count;

		const totalBalance = allWallets?.reduce((sum, w) => sum + Number(w.balance), 0) || 0;
		const totalRevenue = allTransactions?.reduce((sum, t) => {
			if (t.type === TransactionType.DEPOSIT || t.type === TransactionType.CLIENT_PAYMENT) {
				return sum + Number(t.amount);
			}
			return sum;
		}, 0) || 0;

		const avgWalletBalance = totalAdmins > 0 ? totalBalance / totalAdmins : 0;

		return {
			totalAdmins,
			totalBalance,
			totalTransactions: allTransactions?.length || 0,
			totalRevenue,
			activeSubscriptions: allSubscriptions?.length || 0,
			pendingWithdrawals: allWithdrawals?.length || 0,
			averageWalletBalance: avgWalletBalance,
		};
	}

	async getAllAdminWallets(page = 1, limit = 20) {
		const skip = (page - 1) * limit;

		const [wallets, total] = await this.walletRepo
			.createQueryBuilder('w')
			.leftJoinAndSelect('w.admin', 'admin')
			.orderBy('w.balance', 'DESC')
			.skip(skip)
			.take(limit)
			.getManyAndCount();

		return {
			data: wallets,
			total,
			page,
			limit,
			pages: Math.ceil(total / limit),
		};
	}
}
