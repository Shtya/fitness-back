// src/modules/billing/billing.service.ts
import {
	BadRequestException,
	Injectable,
	NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import {
	BillingInvoice,
	BillingPlan,
	BillingPlanStatus,
	ClientCommunication,
	ClientNote,
	ClientNoteType,
	CommunicationType,
	InvoiceStatus,
	PaymentStatus,
	PaymentTransaction,
	SubscriptionStatus,
	UserSubscription,
} from 'entities/billing.entity';
import { User, UserRole } from 'entities/global.entity';
@Injectable()
export class BillingService {
	constructor(
		@InjectRepository(BillingPlan)
		private readonly planRepo: Repository<BillingPlan>,

		@InjectRepository(UserSubscription)
		private readonly subscriptionRepo: Repository<UserSubscription>,

		@InjectRepository(BillingInvoice)
		private readonly invoiceRepo: Repository<BillingInvoice>,

		@InjectRepository(PaymentTransaction)
		private readonly paymentRepo: Repository<PaymentTransaction>,

		@InjectRepository(ClientNote)
		private readonly noteRepo: Repository<ClientNote>,

		@InjectRepository(ClientCommunication)
		private readonly commRepo: Repository<ClientCommunication>,

		@InjectRepository(User)
		private readonly userRepo: Repository<User>,
	) { }

	private paginate(page = 1, limit = 20) {
		const take = Math.min(limit || 20, 100);
		const skip = (page - 1) * take;
		return { take, skip, page, limit: take };
	}

	private buildInvoiceNumber() {
		return `INV-${Date.now()}`;
	}

	private async recalculateInvoice(invoiceId: string) {
		const invoice = await this.invoiceRepo.findOne({ where: { id: invoiceId } });
		if (!invoice) return null;

		const payments = await this.paymentRepo.find({
			where: { invoiceId, status: PaymentStatus.SUCCEEDED },
		});

		const paid = payments.reduce((sum, p) => sum + Number(p.amount), 0);
		const total = Number(invoice.total || 0);
		const due = Math.max(total - paid, 0);

		invoice.amountPaid = paid.toFixed(2);
		invoice.amountDue = due.toFixed(2);
		invoice.status = due <= 0 ? InvoiceStatus.PAID : invoice.status;
		if (due <= 0 && !invoice.paidAt) {
			invoice.paidAt = new Date().toISOString().slice(0, 10);
		}

		return this.invoiceRepo.save(invoice);
	}

	private applyDateRange(qb: any, alias: string, dateFrom?: string, dateTo?: string, column = 'created_at') {
		if (dateFrom) qb.andWhere(`${alias}.${column} >= :dateFrom`, { dateFrom });
		if (dateTo) qb.andWhere(`${alias}.${column} <= :dateTo`, { dateTo });
	}

	async createPlan(dto: any) {
		const exists = await this.planRepo.findOne({ where: { name: dto.name } });
		if (exists) throw new BadRequestException('Billing plan name already exists');

		const plan = this.planRepo.create({
			...dto,
			intervalCount: dto.intervalCount ?? 1,
			currency: dto.currency ?? 'EGP',
			isPopular: dto.isPopular ?? false,
			status: dto.status ?? BillingPlanStatus.ACTIVE,
			features: dto.features ?? [],
		});

		return this.planRepo.save(plan);
	}

	async updatePlan(id: string, dto: any) {
		const plan = await this.findPlanById(id);
		Object.assign(plan, dto);
		return this.planRepo.save(plan);
	}

	async removePlan(id: string) {
		const plan = await this.findPlanById(id);
		plan.status = BillingPlanStatus.ARCHIVED;
		return this.planRepo.save(plan);
	}

	async findPlanById(id: string) {
		const plan = await this.planRepo.findOne({ where: { id } });
		if (!plan) throw new NotFoundException('Billing plan not found');
		return plan;
	}

	async getPlans(query: any) {
		const { take, skip, page, limit } = this.paginate(query.page, query.limit);

		const qb = this.planRepo.createQueryBuilder('plan')
			.orderBy('plan.created_at', 'DESC')
			.take(take)
			.skip(skip);

		if (query.q) {
			qb.andWhere(
				new Brackets((sq) => {
					sq.where('LOWER(plan.name) LIKE LOWER(:q)', { q: `%${query.q}%` })
						.orWhere('LOWER(plan.description) LIKE LOWER(:q)', { q: `%${query.q}%` });
				}),
			);
		}

		if (query.status) qb.andWhere('plan.status = :status', { status: query.status });
		if (query.currency) qb.andWhere('plan.currency = :currency', { currency: query.currency });

		const [items, total] = await qb.getManyAndCount();

		return {
			items,
			meta: {
				total,
				page,
				limit,
				totalPages: Math.ceil(total / limit),
			},
		};
	}

	async createSubscription(dto: any) {
		const user = await this.userRepo.findOne({ where: { id: dto.userId } });
		if (!user) throw new NotFoundException('User not found');

		const plan = await this.planRepo.findOne({ where: { id: dto.planId } });
		if (!plan) throw new NotFoundException('Plan not found');

		const currentActive = await this.subscriptionRepo.findOne({
			where: {
				userId: dto.userId,
				status: SubscriptionStatus.ACTIVE,
			},
			order: { created_at: 'DESC' },
		});

		if (currentActive) {
			currentActive.status = SubscriptionStatus.CANCELED;
			currentActive.canceledAt = new Date().toISOString().slice(0, 10);
			currentActive.cancelReason = 'Replaced by new subscription';
			await this.subscriptionRepo.save(currentActive);
		}

		const start = dto.startDate ?? new Date().toISOString().slice(0, 10);

		const sub = this.subscriptionRepo.create({
			...dto,
			startDate: start,
			autoRenew: dto.autoRenew ?? true,
			currency: plan.currency,
			priceAtPurchase: plan.price,
			status: dto.status ?? SubscriptionStatus.ACTIVE,
			provider: dto.provider ?? null,
		});

		const saved:any = await this.subscriptionRepo.save(sub);

		user.membership = plan.name;
		user.subscriptionStart = saved.startDate;
		user.subscriptionEnd = saved.endDate ?? null;
		await this.userRepo.save(user);

		return saved;
	}

	async updateSubscription(id: string, dto: any) {
		const sub = await this.findSubscriptionById(id);
		if (dto?.action) {
			const action = String(dto.action).toLowerCase();
			if (action === 'pause' || action === 'freeze') sub.status = SubscriptionStatus.PAST_DUE;
			if (action === 'resume') sub.status = SubscriptionStatus.ACTIVE;
			if (action === 'cancel') sub.status = SubscriptionStatus.CANCELED;
			if (action === 'extend_days' && Number(dto.days || 0) > 0) {
				const base = sub.endDate ? new Date(sub.endDate) : new Date();
				base.setDate(base.getDate() + Number(dto.days));
				sub.endDate = base.toISOString().slice(0, 10);
			}
			if (action === 'change_package' && dto.planId) {
				sub.planId = dto.planId;
			}
		}
		Object.assign(sub, dto);
		const saved = await this.subscriptionRepo.save(sub);

		if (saved.userId) {
			const user = await this.userRepo.findOne({ where: { id: saved.userId } });
			if (user && saved.status === SubscriptionStatus.ACTIVE) {
				user.subscriptionStart = saved.startDate;
				user.subscriptionEnd = saved.endDate;
				if (saved.plan) user.membership = saved.plan.name;
				await this.userRepo.save(user);
			}
		}

		return saved;
	}

	async cancelSubscription(id: string, reason?: string) {
		const sub = await this.findSubscriptionById(id);
		sub.status = SubscriptionStatus.CANCELED;
		sub.canceledAt = new Date().toISOString().slice(0, 10);
		sub.cancelReason = reason ?? null;

		const saved = await this.subscriptionRepo.save(sub);

		const user = await this.userRepo.findOne({ where: { id: sub.userId } });
		if (user) {
			user.subscriptionEnd = sub.canceledAt;
			await this.userRepo.save(user);
		}

		return saved;
	}

	async findSubscriptionById(id: string) {
		const sub = await this.subscriptionRepo.findOne({
			where: { id },
			relations: ['user'],
		});
		if (!sub) throw new NotFoundException('Subscription not found');
		return sub;
	}

	async getSubscriptions(query: any) {
		const { take, skip, page, limit } = this.paginate(query.page, query.limit);

		const qb = this.subscriptionRepo.createQueryBuilder('sub')
			.leftJoinAndSelect('sub.user', 'user')
			.leftJoinAndSelect('sub.plan', 'plan')
			.orderBy('sub.created_at', 'DESC')
			.take(take)
			.skip(skip);

		if (query.userId) qb.andWhere('sub.userId = :userId', { userId: query.userId });
		if (query.planId) qb.andWhere('sub.planId = :planId', { planId: query.planId });
		if (query.status) qb.andWhere('sub.status = :status', { status: query.status });
		if (query.dateFrom) qb.andWhere('sub.startDate >= :dateFrom', { dateFrom: query.dateFrom });
		if (query.dateTo) qb.andWhere('sub.startDate <= :dateTo', { dateTo: query.dateTo });

		const [items, total] = await qb.getManyAndCount();

		return {
			items,
			meta: {
				total,
				page,
				limit,
				totalPages: Math.ceil(total / limit),
			},
		};
	}

	async getCurrentSubscription(userId: string) {
		return this.subscriptionRepo.findOne({
			where: { userId, status: SubscriptionStatus.ACTIVE },
			order: { created_at: 'DESC' },
		});
	}

	async createInvoice(dto: any) {
		const user = await this.userRepo.findOne({ where: { id: dto.userId } });
		if (!user) throw new NotFoundException('User not found');

		if (dto.planId) {
			const plan = await this.planRepo.findOne({ where: { id: dto.planId } });
			if (!plan) throw new NotFoundException('Plan not found');
		}

		const invoice = this.invoiceRepo.create({
			...dto,
			invoiceNumber: dto.invoiceNumber ?? this.buildInvoiceNumber(),
			status: dto.status ?? InvoiceStatus.OPEN,
			discount: dto.discount ?? '0',
			tax: dto.tax ?? '0',
			amountPaid: dto.amountPaid ?? '0',
			amountDue: dto.amountDue ?? dto.total,
			currency: dto.currency ?? 'EGP',
			issueDate: dto.issueDate ?? new Date().toISOString().slice(0, 10),
		});

		return this.invoiceRepo.save(invoice);
	}

	async updateInvoice(id: string, dto: any) {
		const invoice = await this.findInvoiceById(id);
		Object.assign(invoice, dto);
		const saved = await this.invoiceRepo.save(invoice);
		await this.recalculateInvoice(saved.id);
		return this.findInvoiceById(saved.id);
	}

	async markInvoicePaid(id: string) {
		const invoice = await this.findInvoiceById(id);
		invoice.status = InvoiceStatus.PAID;
		invoice.amountPaid = invoice.total;
		invoice.amountDue = '0';
		invoice.paidAt = new Date().toISOString().slice(0, 10);
		return this.invoiceRepo.save(invoice);
	}

	async findInvoiceById(id: string) {
		const invoice = await this.invoiceRepo.findOne({
			where: { id },
			relations: ['payments', 'subscription'],
		});
		if (!invoice) throw new NotFoundException('Invoice not found');
		return invoice;
	}

	async getInvoices(query: any) {
		const { take, skip, page, limit } = this.paginate(query.page, query.limit);

		const qb = this.invoiceRepo.createQueryBuilder('invoice')
			.leftJoinAndSelect('invoice.user', 'user')
			.leftJoinAndSelect('invoice.plan', 'plan')
			.leftJoinAndSelect('invoice.subscription', 'subscription')
			.orderBy('invoice.created_at', 'DESC')
			.take(take)
			.skip(skip);

		if (query.userId) qb.andWhere('invoice.userId = :userId', { userId: query.userId });
		if (query.planId) qb.andWhere('invoice.planId = :planId', { planId: query.planId });
		if (query.subscriptionId) qb.andWhere('invoice.subscriptionId = :subscriptionId', { subscriptionId: query.subscriptionId });
		if (query.status) qb.andWhere('invoice.status = :status', { status: query.status });

		if (query.q) {
			qb.andWhere(
				new Brackets((sq) => {
					sq.where('LOWER(invoice.invoiceNumber) LIKE LOWER(:q)', { q: `%${query.q}%` })
						.orWhere('LOWER(invoice.description) LIKE LOWER(:q)', { q: `%${query.q}%` })
						.orWhere('LOWER(user.name) LIKE LOWER(:q)', { q: `%${query.q}%` })
						.orWhere('LOWER(user.email) LIKE LOWER(:q)', { q: `%${query.q}%` });
				}),
			);
		}

		if (query.dateFrom) qb.andWhere('invoice.issueDate >= :dateFrom', { dateFrom: query.dateFrom });
		if (query.dateTo) qb.andWhere('invoice.issueDate <= :dateTo', { dateTo: query.dateTo });

		const [items, total] = await qb.getManyAndCount();

		return {
			items,
			meta: {
				total,
				page,
				limit,
				totalPages: Math.ceil(total / limit),
			},
		};
	}

	async createPayment(dto: any) {
		const user = await this.userRepo.findOne({ where: { id: dto.userId } });
		if (!user) throw new NotFoundException('User not found');

		if (dto.invoiceId) {
			const invoice = await this.invoiceRepo.findOne({ where: { id: dto.invoiceId } });
			if (!invoice) throw new NotFoundException('Invoice not found');
		}

		const payment = this.paymentRepo.create({
			...dto,
			status: dto.status ?? PaymentStatus.PENDING,
			currency: dto.currency ?? 'EGP',
		});

		const saved: any = await this.paymentRepo.save(payment);

		if (saved.invoiceId && saved.status === PaymentStatus.SUCCEEDED) {
			await this.recalculateInvoice(saved.invoiceId);
		}

		return this.findPaymentById(saved.id);
	}

	async updatePayment(id: string, dto: any) {
		const payment = await this.findPaymentById(id);
		Object.assign(payment, dto);
		const saved = await this.paymentRepo.save(payment);

		if (saved.invoiceId) {
			await this.recalculateInvoice(saved.invoiceId);
		}

		return this.findPaymentById(saved.id);
	}

	async findPaymentById(id: string) {
		const payment = await this.paymentRepo.findOne({
			where: { id },
			relations: ['invoice'],
		});
		if (!payment) throw new NotFoundException('Payment not found');
		return payment;
	}

	async getPayments(query: any) {
		const { take, skip, page, limit } = this.paginate(query.page, query.limit);

		const qb = this.paymentRepo.createQueryBuilder('payment')
			.leftJoinAndSelect('payment.user', 'user')
			.leftJoinAndSelect('payment.invoice', 'invoice')
			.orderBy('payment.created_at', 'DESC')
			.take(take)
			.skip(skip);

		if (query.userId) qb.andWhere('payment.userId = :userId', { userId: query.userId });
		if (query.invoiceId) qb.andWhere('payment.invoiceId = :invoiceId', { invoiceId: query.invoiceId });
		if (query.status) qb.andWhere('payment.status = :status', { status: query.status });
		if (query.provider) qb.andWhere('LOWER(payment.provider) = LOWER(:provider)', { provider: query.provider });

		this.applyDateRange(qb, 'payment', query.dateFrom, query.dateTo);

		const [items, total] = await qb.getManyAndCount();

		return {
			items,
			meta: {
				total,
				page,
				limit,
				totalPages: Math.ceil(total / limit),
			},
		};
	}

	async getClients(query: any) {
		const { take, skip, page, limit } = this.paginate(query.page, query.limit);
		const qb = this.userRepo.createQueryBuilder('u')
			.leftJoin('u.coach', 'coach')
			.select([
				'u.id',
				'u.name',
				'u.email',
				'u.phone',
				'u.gender',
				'u.membership',
				'u.subscriptionStart',
				'u.subscriptionEnd',
				'u.status',
				'u.created_at',
				'u.coachId',
				'coach.id',
				'coach.name',
			])
			.where('u.role = :role', { role: UserRole.CLIENT })
			.orderBy('u.created_at', 'DESC')
			.take(take)
			.skip(skip);

		if (query.q) {
			qb.andWhere(
				new Brackets((sq) => {
					sq.where('LOWER(u.name) LIKE LOWER(:q)', { q: `%${query.q}%` })
						.orWhere('LOWER(u.email) LIKE LOWER(:q)', { q: `%${query.q}%` })
						.orWhere('u.phone LIKE :q', { q: `%${query.q}%` });
				}),
			);
		}
		if (query.coachId) qb.andWhere('u.coachId = :coachId', { coachId: query.coachId });

		const [items, total] = await qb.getManyAndCount();
		return {
			items: await Promise.all(items.map(async (u) => {
				const activeSub = await this.subscriptionRepo.findOne({
					where: { userId: u.id, status: SubscriptionStatus.ACTIVE },
					order: { created_at: 'DESC' },
					relations: ['plan'],
				});
				const lastPayment = await this.paymentRepo.findOne({
					where: { userId: u.id },
					order: { created_at: 'DESC' },
				});
				return {
					...u,
					currentPackage: activeSub?.plan?.name ?? u.membership ?? null,
					subscriptionStatus: activeSub?.status ?? (u.subscriptionEnd ? SubscriptionStatus.EXPIRED : SubscriptionStatus.PENDING),
					renewalDate: activeSub?.endDate ?? u.subscriptionEnd ?? null,
					lastActivity: lastPayment?.created_at ?? u.updated_at ?? u.created_at,
				};
			})),
			meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
		};
	}

	async getClientById(id: string) {
		const user = await this.userRepo.findOne({ where: { id }, relations: ['coach'] });
		if (!user || user.role !== UserRole.CLIENT) throw new NotFoundException('Client not found');
		const currentSubscription = await this.getCurrentSubscription(id);
		const paymentsSummary = await this.paymentRepo
			.createQueryBuilder('p')
			.select('COALESCE(SUM(p.amount),0)', 'sum')
			.where('p.userId = :id', { id })
			.andWhere('p.status = :status', { status: PaymentStatus.SUCCEEDED })
			.getRawOne();
		return {
			profile: user,
			currentSubscription,
			paymentsSummary: Number(paymentsSummary?.sum || 0),
		};
	}

	async getClientTimeline(clientId: string, query: any = {}) {
		const events: any[] = [];
		const user = await this.userRepo.findOne({ where: { id: clientId } });
		if (!user) throw new NotFoundException('Client not found');

		events.push({
			type: 'account_created',
			title: 'Account created',
			description: `${user.name} profile created`,
			at: user.created_at,
		});

		const subs = await this.subscriptionRepo.find({ where: { userId: clientId }, relations: ['plan'], order: { created_at: 'DESC' } });
		for (const s of subs) {
			events.push({
				type: 'subscription_changed',
				title: `Subscription ${s.status}`,
				description: `${s.plan?.name || 'Plan'} (${s.startDate || '-'} → ${s.endDate || '-'})`,
				at: s.created_at,
			});
		}

		const payments = await this.paymentRepo.find({ where: { userId: clientId }, order: { created_at: 'DESC' } });
		for (const p of payments) {
			events.push({
				type: 'payment',
				title: `Payment ${p.status}`,
				description: `${p.amount} ${p.currency} via ${p.paymentMethod}`,
				at: p.created_at,
			});
		}

		const notes = await this.noteRepo.find({ where: { clientId }, order: { created_at: 'DESC' } });
		for (const n of notes) {
			events.push({
				type: 'coach_note',
				title: `Note (${n.type})`,
				description: n.text,
				at: n.created_at,
			});
		}

		const comms = await this.commRepo.find({ where: { clientId }, order: { created_at: 'DESC' } });
		for (const c of comms) {
			events.push({
				type: 'communication',
				title: `Communication ${c.type}`,
				description: c.message || c.template || '-',
				at: c.created_at,
			});
		}

		let filtered = events.sort((a, b) => +new Date(b.at) - +new Date(a.at));
		if (query.type) filtered = filtered.filter((e) => e.type === query.type);
		return filtered;
	}

	async getClientProgress(clientId: string) {
		const monthlyPayments = await this.paymentRepo
			.createQueryBuilder('p')
			.select("to_char(p.created_at, 'YYYY-MM')", 'month')
			.addSelect('COALESCE(SUM(p.amount),0)', 'total')
			.addSelect('COUNT(*)', 'count')
			.where('p.userId = :clientId', { clientId })
			.groupBy("to_char(p.created_at, 'YYYY-MM')")
			.orderBy('month', 'DESC')
			.getRawMany();

		const monthlySubscriptions = await this.subscriptionRepo
			.createQueryBuilder('s')
			.select("to_char(s.created_at, 'YYYY-MM')", 'month')
			.addSelect('COUNT(*)', 'count')
			.where('s.userId = :clientId', { clientId })
			.groupBy("to_char(s.created_at, 'YYYY-MM')")
			.orderBy('month', 'DESC')
			.getRawMany();

		// TODO: hook workout/nutrition adherence and body measurements when related APIs are finalized
		return {
			monthlyPayments: monthlyPayments.map((x) => ({ month: x.month, total: Number(x.total), count: Number(x.count) })),
			monthlySubscriptions: monthlySubscriptions.map((x) => ({ month: x.month, count: Number(x.count) })),
			monthlyCheckins: [],
			monthlyAdherence: [],
			monthlyMeasurements: [],
		};
	}

	async getClientCheckins(clientId: string) {
		// TODO: integrate with weekly-report module records for this client
		return [];
	}

	async getClientNotes(clientId: string) {
		return this.noteRepo.find({ where: { clientId }, order: { isPinned: 'DESC', created_at: 'DESC' } as any });
	}

	async createClientNote(clientId: string, dto: any) {
		const client = await this.userRepo.findOne({ where: { id: clientId } });
		if (!client) throw new NotFoundException('Client not found');
		const note = this.noteRepo.create({
			clientId,
			authorId: dto.authorId ?? null,
			type: dto.type ?? ClientNoteType.GENERAL,
			text: dto.text,
			isPinned: !!dto.isPinned,
		});
		return this.noteRepo.save(note);
	}

	async updateClientNote(clientId: string, noteId: string, dto: any) {
		const note = await this.noteRepo.findOne({ where: { id: noteId, clientId } });
		if (!note) throw new NotFoundException('Note not found');
		Object.assign(note, dto);
		return this.noteRepo.save(note);
	}

	async deleteClientNote(clientId: string, noteId: string) {
		const note = await this.noteRepo.findOne({ where: { id: noteId, clientId } });
		if (!note) throw new NotFoundException('Note not found');
		await this.noteRepo.remove(note);
		return { ok: true };
	}

	async getClientPlansHistory(clientId: string) {
		const subscriptions = await this.subscriptionRepo.find({
			where: { userId: clientId },
			relations: ['plan'],
			order: { created_at: 'DESC' },
		});
		return subscriptions.map((s) => ({
			id: s.id,
			planId: s.planId,
			planName: s.plan?.name || null,
			startDate: s.startDate,
			endDate: s.endDate,
			status: s.status,
			replacedBy: null, // TODO: support explicit link when replace relation is available
			notes: s.notes || null,
		}));
	}

	async getClientCommunications(clientId: string) {
		return this.commRepo.find({ where: { clientId }, order: { created_at: 'DESC' } });
	}

	async sendClientCommunication(clientId: string, dto: any) {
		const client = await this.userRepo.findOne({ where: { id: clientId } });
		if (!client) throw new NotFoundException('Client not found');
		// TODO: integrate real whatsapp/push providers here
		const log = this.commRepo.create({
			clientId,
			coachId: dto.coachId ?? null,
			type: dto.type ?? CommunicationType.OTHER,
			template: dto.template ?? null,
			message: dto.message ?? null,
			status: 'sent',
			metadata: dto.metadata ?? null,
		});
		return this.commRepo.save(log);
	}

	async getStats(query: any) {
		const invoiceQb = this.invoiceRepo.createQueryBuilder('invoice');
		const paymentQb = this.paymentRepo.createQueryBuilder('payment');
		const subscriptionQb = this.subscriptionRepo.createQueryBuilder('sub');

		if (query.dateFrom) {
			invoiceQb.andWhere('invoice.created_at >= :dateFrom', { dateFrom: query.dateFrom });
			paymentQb.andWhere('payment.created_at >= :dateFrom', { dateFrom: query.dateFrom });
			subscriptionQb.andWhere('sub.created_at >= :dateFrom', { dateFrom: query.dateFrom });
		}

		if (query.dateTo) {
			invoiceQb.andWhere('invoice.created_at <= :dateTo', { dateTo: query.dateTo });
			paymentQb.andWhere('payment.created_at <= :dateTo', { dateTo: query.dateTo });
			subscriptionQb.andWhere('sub.created_at <= :dateTo', { dateTo: query.dateTo });
		}

		const [
			totalPlans,
			activePlans,
			totalSubscriptions,
			activeSubscriptions,
			canceledSubscriptions,
			totalInvoices,
			paidInvoices,
			openInvoices,
			totalPayments,
			succeededPayments,
			failedPayments,
			paidRevenueRaw,
			dueRaw,
		] = await Promise.all([
			this.planRepo.count(),
			this.planRepo.count({ where: { status: BillingPlanStatus.ACTIVE } }),
			subscriptionQb.getCount(),
			this.subscriptionRepo.count({ where: { status: SubscriptionStatus.ACTIVE } }),
			this.subscriptionRepo.count({ where: { status: SubscriptionStatus.CANCELED } }),
			invoiceQb.getCount(),
			this.invoiceRepo.count({ where: { status: InvoiceStatus.PAID } }),
			this.invoiceRepo.count({ where: { status: InvoiceStatus.OPEN } }),
			paymentQb.getCount(),
			this.paymentRepo.count({ where: { status: PaymentStatus.SUCCEEDED } }),
			this.paymentRepo.count({ where: { status: PaymentStatus.FAILED } }),
			this.paymentRepo
				.createQueryBuilder('payment')
				.select('COALESCE(SUM(payment.amount), 0)', 'sum')
				.where('payment.status = :status', { status: PaymentStatus.SUCCEEDED })
				.getRawOne(),
			this.invoiceRepo
				.createQueryBuilder('invoice')
				.select('COALESCE(SUM(invoice.amountDue), 0)', 'sum')
				.where('invoice.status != :status', { status: InvoiceStatus.PAID })
				.getRawOne(),
		]);

		const planDistribution = await this.subscriptionRepo
			.createQueryBuilder('sub')
			.leftJoin('sub.plan', 'plan')
			.select('plan.id', 'planId')
			.addSelect('plan.name', 'planName')
			.addSelect('COUNT(sub.id)', 'count')
			.groupBy('plan.id')
			.addGroupBy('plan.name')
			.getRawMany();

		return {
			cards: {
				totalPlans,
				activePlans,
				totalSubscriptions,
				activeSubscriptions,
				canceledSubscriptions,
				totalInvoices,
				paidInvoices,
				openInvoices,
				totalPayments,
				succeededPayments,
				failedPayments,
				revenueCollected: Number(paidRevenueRaw?.sum || 0),
				outstandingAmount: Number(dueRaw?.sum || 0),
			},
			planDistribution: planDistribution.map((i) => ({
				planId: i.planId,
				planName: i.planName,
				count: Number(i.count),
			})),
		};
	}
}