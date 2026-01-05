// --- File: src/billing/billing.service.ts ---
import {
	Injectable,
	NotFoundException,
	BadRequestException,
	ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
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
	CreateClientPaymentDto,
	AdminAnalyticsDto,
	SystemBillingReportDto,
	TransactionFilterDto,
	ClientPaymentFilterDto,
} from './dto/billing.dto';

@Injectable()
export class BillingService {
	constructor(
		@InjectRepository(Wallet) private walletRepo: Repository<Wallet>,
		@InjectRepository(Transaction)
		private transactionRepo: Repository<Transaction>,
		@InjectRepository(AdminSubscription)
		private subscriptionRepo: Repository<AdminSubscription>,
		@InjectRepository(WithdrawalRequest)
		private withdrawalRepo: Repository<WithdrawalRequest>,
		@InjectRepository(ClientPayment)
		private clientPaymentRepo: Repository<ClientPayment>,
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
		if (!wallet) throw new NotFoundException('Wallet not found');
		return wallet;
	}

	async addFundsToWallet(
		adminId: string,
		amount: number,
		type: TransactionType,
	): Promise<Wallet> {
		if (amount <= 0) throw new BadRequestException('Amount must be greater than 0');

		const wallet = await this.getOrCreateWallet(adminId);
		wallet.balance += amount;
		wallet.totalEarned += amount;

		return this.walletRepo.save(wallet);
	}

	async deductFromWallet(
		adminId: string,
		amount: number,
		type: TransactionType,
	): Promise<Wallet> {
		if (amount <= 0) throw new BadRequestException('Amount must be greater than 0');

		const wallet = await this.getOrCreateWallet(adminId);
		if (wallet.balance < amount) throw new BadRequestException('Insufficient wallet balance');

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

		if (dto.type === TransactionType.DEPOSIT) {
			await this.addFundsToWallet(dto.adminId, dto.amount, dto.type);
		} else if (
			dto.type === TransactionType.WITHDRAWAL ||
			dto.type === TransactionType.CLIENT_PAYMENT
		) {
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

		if (type) qb.andWhere('t.type = :type', { type });
		if (status) qb.andWhere('t.status = :status', { status });

		if (startDate && endDate) {
			qb.andWhere('t.createdAt BETWEEN :start AND :end', {
				start: new Date(startDate),
				end: new Date(endDate),
			});
		}

		const [transactions, total] = await qb.getManyAndCount();

		const pages = Math.ceil(total / limit);

		return {
			data: transactions,
			total,
			page,
			limit,
			pages,
			hasNext: page < pages,
			hasPrev: page > 1,
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

		if (type) qb.andWhere('t.type = :type', { type });
		if (status) qb.andWhere('t.status = :status', { status });

		if (startDate && endDate) {
			qb.andWhere('t.createdAt BETWEEN :start AND :end', {
				start: new Date(startDate),
				end: new Date(endDate),
			});
		}

		const [transactions, total] = await qb.getManyAndCount();
		const pages = Math.ceil(total / limit);

		return {
			data: transactions,
			total,
			page,
			limit,
			pages,
			hasNext: page < pages,
			hasPrev: page > 1,
		};
	}

	// ============= SUBSCRIPTION OPERATIONS =============

	async createSubscription(dto: CreateSubscriptionDto): Promise<AdminSubscription> {
		await this.subscriptionRepo.update(
			{ adminId: dto.adminId, isActive: true },
			{ isActive: false },
		);

		const subscription = this.subscriptionRepo.create(dto);
		return this.subscriptionRepo.save(subscription);
	}

	async getSubscription(adminId: string): Promise<AdminSubscription> {
		const subscription = await this.subscriptionRepo.findOne({
			where: { adminId },
			order: { createdAt: 'DESC' },
		});

		if (!subscription) {
			return this.createSubscription({
				adminId,
				tier: SubscriptionTier.FREE,
				expiresAt: new Date('2099-12-31'),
			} as any);
		}

		return subscription;
	}

	// ✅ FIX: renew by subscription id (matches controller route /subscriptions/:id/renew)
	async renewSubscription(subscriptionId: string): Promise<AdminSubscription> {
		const current = await this.subscriptionRepo.findOne({
			where: { id: subscriptionId },
		});

		if (!current) throw new NotFoundException('Subscription not found');

		if (current.tier === SubscriptionTier.FREE) {
			throw new BadRequestException('Cannot renew free subscription');
		}

		// deactivate current
		await this.subscriptionRepo.update(
			{ adminId: current.adminId, isActive: true },
			{ isActive: false },
		);

		const expiresAt = new Date();
		expiresAt.setMonth(expiresAt.getMonth() + 1);

		const renewed = this.subscriptionRepo.create({
			adminId: current.adminId,
			tier: current.tier,
			monthlyPrice: current.monthlyPrice,
			expiresAt,
			autoRenew: current.autoRenew,
			isActive: true,
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

	async getWithdrawalRequests(
		adminId?: string,
		status?: WithdrawalStatus,
		page = 1,
		limit = 20,
	) {
		const skip = (page - 1) * limit;

		const qb = this.withdrawalRepo
			.createQueryBuilder('w')
			.orderBy('w.createdAt', 'DESC')
			.skip(skip)
			.take(limit);

		if (adminId) qb.where('w.adminId = :adminId', { adminId });
		if (status) qb.andWhere('w.status = :status', { status });

		const [withdrawals, total] = await qb.getManyAndCount();
		const pages = Math.ceil(total / limit);

		return {
			data: withdrawals,
			total,
			page,
			limit,
			pages,
			hasNext: page < pages,
			hasPrev: page > 1,
		};
	}

	async approveWithdrawal(withdrawalId: string, processedBy: string): Promise<WithdrawalRequest> {
		const withdrawal = await this.withdrawalRepo.findOne({ where: { id: withdrawalId } });
		if (!withdrawal) throw new NotFoundException('Withdrawal request not found');

		withdrawal.status = WithdrawalStatus.APPROVED;
		withdrawal.processedBy = processedBy;
		withdrawal.processedAt = new Date();

		return this.withdrawalRepo.save(withdrawal);
	}

	async rejectWithdrawal(
		withdrawalId: string,
		reason: string,
		processedBy: string,
	): Promise<WithdrawalRequest> {
		const withdrawal = await this.withdrawalRepo.findOne({ where: { id: withdrawalId } });
		if (!withdrawal) throw new NotFoundException('Withdrawal request not found');

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
		if (!withdrawal) throw new NotFoundException('Withdrawal request not found');

		withdrawal.status = WithdrawalStatus.COMPLETED;
		withdrawal.processedBy = processedBy;
		withdrawal.processedAt = new Date();

		return this.withdrawalRepo.save(withdrawal);
	}

	// ============= CLIENT PAYMENT OPERATIONS =============

	async recordClientPayment(dto: CreateClientPaymentDto): Promise<ClientPayment> {
		const payment = this.clientPaymentRepo.create({
			adminId: dto.adminId,
			clientId: dto.clientId,
			amount: dto.amount,
			description: dto.description,
			invoiceId: dto.invoiceId,
			periodStart: dto.periodStart ? new Date(dto.periodStart) : undefined,
			periodEnd: dto.periodEnd ? new Date(dto.periodEnd) : undefined,
			status: TransactionStatus.PENDING as any,
		});

		const saved = await this.clientPaymentRepo.save(payment);

		// ✅ return with relations
		const full = await this.clientPaymentRepo.findOne({
			where: { id: saved.id },
			relations: { client: true, admin: true } as any,
		});

		return full ?? saved;
	}

	// ✅ UPDATED: relation + paid filter + null dates + hasNext/hasPrev
	async getClientPayments(adminId: string, filter: ClientPaymentFilterDto = {}) {
		const {
			page = 1,
			limit = 20,
			clientId,
			startDate,
			endDate,
			sort = 'newest',
			paid = 'all', // ✅ NEW: all | paid | unpaid
		} = filter as any;

		const skip = (page - 1) * limit;

		const qb = this.clientPaymentRepo
			.createQueryBuilder('cp')
			.leftJoinAndSelect('cp.client', 'client')
			.where('cp.adminId = :adminId', { adminId });

		if (clientId) qb.andWhere('cp.clientId = :clientId', { clientId });

		// ✅ paid filter
		if (paid === 'paid') {
			qb.andWhere('cp.status IN (:...st)', { st: [TransactionStatus.COMPLETED, 'paid'] });
		} else if (paid === 'unpaid') {
			qb.andWhere('cp.status = :st', { st: TransactionStatus.PENDING });
		}

		// ✅ ignore date filter unless both exist (null by default)
		if (startDate && endDate) {
			const start = new Date(startDate);
			const end = new Date(endDate);
			qb.andWhere(
				'(cp.periodStart BETWEEN :start AND :end OR cp.createdAt BETWEEN :start AND :end)',
				{ start, end },
			);
		}

		switch (sort) {
			case 'oldest':
				qb.orderBy('cp.createdAt', 'ASC');
				break;
			case 'amount_high':
				qb.orderBy('cp.amount', 'DESC');
				break;
			case 'amount_low':
				qb.orderBy('cp.amount', 'ASC');
				break;
			case 'newest':
			default:
				qb.orderBy('cp.createdAt', 'DESC');
				break;
		}

		const [payments, total] = await qb.skip(skip).take(limit).getManyAndCount();
		const pages = Math.ceil(total / limit);

		return {
			data: payments,
			total,
			page,
			limit,
			pages,
			hasNext: page < pages,
			hasPrev: page > 1,
		};
	}

	// ✅ UPDATED: guard + return with relations
	async markPaymentAsPaid(paymentId: string, adminId: string): Promise<ClientPayment> {
		const payment = await this.clientPaymentRepo.findOne({ where: { id: paymentId } });
		if (!payment) throw new NotFoundException('Payment not found');
		if (payment.adminId !== adminId) throw new ForbiddenException('Not allowed');

		payment.status = TransactionStatus.COMPLETED as any;
		payment.paidAt = new Date();

		await this.clientPaymentRepo.save(payment);

		const full = await this.clientPaymentRepo.findOne({
			where: { id: paymentId },
			relations: { client: true, admin: true } as any,
		});

		return full ?? payment;
	}

	// ✅ NEW: delete payment
	async deleteClientPayment(paymentId: string, adminId: string) {
		const payment = await this.clientPaymentRepo.findOne({ where: { id: paymentId } });
		if (!payment) throw new NotFoundException('Payment not found');
		if (payment.adminId !== adminId) throw new ForbiddenException('Not allowed');

		await this.clientPaymentRepo.delete(paymentId);
		return { ok: true };
	}

	// ============= ADMIN ANALYTICS =============

	async getAdminAnalytics(adminId: string): Promise<AdminAnalyticsDto> {
		const wallet = await this.getOrCreateWallet(adminId);
		const subscriptions = await this.getActiveSubscriptions(adminId);
		const [, transactionCount] = await this.transactionRepo.findAndCount({
			where: { adminId },
		});

		const transactions = await this.transactionRepo.find({ where: { adminId } });

		const avgTransaction =
			transactions?.length > 0
				? transactions.reduce((sum, t) => sum + Number(t.amount), 0) / transactions.length
				: 0;

		return {
			totalBalance: Number(wallet.balance),
			totalEarned: Number(wallet.totalEarned),
			totalWithdrawn: Number(wallet.totalWithdrawn),
			totalSubscribers: subscriptions.length,
			activeSubscriptions: subscriptions.filter((s) => s.isActive).length,
			expiredSubscriptions: subscriptions.filter(
				(s) => !s.isActive || new Date(s.expiresAt) < new Date(),
			).length,
			pendingWithdrawals: await this.withdrawalRepo.count({
				where: { adminId, status: WithdrawalStatus.REQUESTED },
			}),
			transactionCount,
			averageTransactionAmount: avgTransaction,
		} as any;
	}

	async getAdminBillingOverview(adminId: string) {
		const wallet = await this.getWalletBalance(adminId);
		const subscription = await this.getSubscription(adminId);

		const recentTransactions = await this.transactionRepo.find({
			where: { adminId },
			order: { createdAt: 'DESC' },
			take: 10,
		});

		const withdrawalRequests = await this.withdrawalRepo.find({
			where: { adminId },
			order: { createdAt: 'DESC' },
			take: 5,
		});

		const monthStart = new Date();
		monthStart.setDate(1);
		monthStart.setHours(0, 0, 0, 0);

		const monthTransactions = await this.transactionRepo.find({
			where: { adminId, createdAt: MoreThan(monthStart) },
		});

		const moneyInThisMonth = monthTransactions.reduce((sum, t) => {
			if (t.type === TransactionType.DEPOSIT || t.type === TransactionType.CLIENT_PAYMENT) {
				return sum + Number(t.amount);
			}
			return sum;
		}, 0);

		const moneyOutThisMonth = monthTransactions.reduce((sum, t) => {
			if (t.type === TransactionType.WITHDRAWAL) {
				return sum + Number(t.amount);
			}
			return sum;
		}, 0);

		const pendingPaymentsCount = await this.clientPaymentRepo.count({
			where: { adminId, status: TransactionStatus.PENDING as any },
		});

		const paidPaymentsThisMonth = await this.clientPaymentRepo
			.createQueryBuilder('cp')
			.where('cp.adminId = :adminId', { adminId })
			.andWhere('cp.status = :st', { st: TransactionStatus.COMPLETED })
			.andWhere('cp.paidAt >= :monthStart', { monthStart })
			.getCount();

		return {
			wallet: {
				balance: Number(wallet.balance),
				totalEarned: Number(wallet.totalEarned),
				totalWithdrawn: Number(wallet.totalWithdrawn),
				currency: wallet.currency,
			},
			month: {
				start: monthStart,
				moneyIn: moneyInThisMonth,
				moneyOut: moneyOutThisMonth,
				net: moneyInThisMonth - moneyOutThisMonth,
				paidPayments: paidPaymentsThisMonth,
			},
			pendingPayments: pendingPaymentsCount,
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
		const allWallets = await this.walletRepo.find();
		const allTransactions = await this.transactionRepo.find();
		const allSubscriptions = await this.subscriptionRepo.find({ where: { isActive: true } });
		const allWithdrawals = await this.withdrawalRepo.find({
			where: { status: WithdrawalStatus.REQUESTED },
		});

		const totalAdmins = (
			await this.walletRepo.query('SELECT COUNT(DISTINCT "adminId") FROM wallets')
		)[0].count;

		const totalBalance = allWallets?.reduce((sum, w) => sum + Number(w.balance), 0) || 0;

		const totalRevenue =
			allTransactions?.reduce((sum, t) => {
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
		} as any;
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

		const pages = Math.ceil(total / limit);

		return {
			data: wallets,
			total,
			page,
			limit,
			pages,
			hasNext: page < pages,
			hasPrev: page > 1,
		};
	}
}
