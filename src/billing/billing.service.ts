import {
	BadRequestException,
	Injectable,
	NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, In, Not, Repository, SelectQueryBuilder } from 'typeorm';
import {
	BillingInvoice,
	BillingPlan,
	BillingPlanStatus,
	ClientCommunication,
	ClientNote,
	ClientNoteType,
	CommunicationType,
	InvoiceStatus,
	PaymentMethodType,
	PaymentStatus,
	PaymentTransaction,
	SubscriptionStatus,
	UserSubscription,
} from 'entities/billing.entity';
import { User, UserRole } from 'entities/global.entity';
import { parsePagination } from 'common/pagination';
import {
	BillingActor,
	addDays,
	canManageClient,
	clientScopeSql,
	daysBetween,
	isYmd,
	money,
	planOwnerFor,
	resolvePeriod,
	todayYmd,
} from './billing-rules';
import { CreatePlanDto, RecordPaymentDto, UpdatePlanDto } from './dto/billing.dto';

/** Fields a generic PATCH must never move (ownership / identity). */
const LOCKED_FIELDS = ['id', 'userId', 'adminId', 'created_at', 'updated_at', 'deleted_at'];
const PAID_DAY = 'COALESCE(payment.paidAt, CAST(payment.created_at AS date))';

function safePatch(dto: any) {
	const out = { ...(dto || {}) };
	for (const key of LOCKED_FIELDS) delete out[key];
	return out;
}

type PaymentMeta = {
	source?: string;
	planId?: string | null;
	planName?: string | null;
	periodFrom?: string | null;
	periodTo?: string | null;
	subscriptionId?: string | null;
	supersededSubscriptionIds?: string[];
	previous?: { subscriptionStart?: string | null; subscriptionEnd?: string | null; membership?: string | null };
};

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

		private readonly dataSource: DataSource,
	) { }

	private paginate(page: unknown = 1, limit: unknown = 20) {
		return parsePagination(page, limit);
	}

	private buildInvoiceNumber() {
		return `INV-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
	}

	private applyScope(qb: SelectQueryBuilder<any>, actor: BillingActor, userAlias: string) {
		const scope = clientScopeSql(actor, userAlias);
		if (scope) qb.andWhere(scope.sql, scope.params);
		return qb;
	}

	/* =========================================================
	 * Ownership lookups — everything below goes through these
	 * ======================================================= */

	private async findClientForActor(clientId: string, actor: BillingActor) {
		// `where: { id: undefined }` matches any row in TypeORM, so reject missing ids up front.
		if (!clientId || typeof clientId !== 'string') throw new NotFoundException('Client not found');
		const client = await this.userRepo.findOne({ where: { id: clientId, role: UserRole.CLIENT } });
		if (!client || !canManageClient(actor, client)) throw new NotFoundException('Client not found');
		return client;
	}

	private async findPlanForActor(id: string, actor: BillingActor) {
		if (!id || typeof id !== 'string') throw new NotFoundException('Package not found');
		const plan = await this.planRepo.findOne({ where: { id } });
		const owner = planOwnerFor(actor);
		if (!plan || (owner !== undefined && plan.adminId !== owner)) throw new NotFoundException('Package not found');
		return plan;
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
			invoice.paidAt = todayYmd();
		}

		return this.invoiceRepo.save(invoice);
	}

	/* =========================================================
	 * Plans (packages)
	 * ======================================================= */

	private planView(plan: BillingPlan, activeClients = 0) {
		return {
			id: plan.id,
			name: plan.name,
			description: plan.description ?? null,
			price: money(plan.price),
			currency: plan.currency,
			interval: plan.interval,
			intervalCount: plan.intervalCount ?? 1,
			durationDays: plan.durationDays ?? null,
			features: plan.features ?? [],
			status: plan.status,
			activeClients,
			created_at: plan.created_at,
		};
	}

	private planFields(dto: Partial<CreatePlanDto>) {
		const out: Partial<BillingPlan> = {};
		if (dto.name !== undefined) out.name = dto.name.trim();
		if (dto.price !== undefined) out.price = money(dto.price).toFixed(2);
		if (dto.interval !== undefined) out.interval = dto.interval as BillingPlan['interval'];
		if (dto.intervalCount !== undefined) out.intervalCount = dto.intervalCount;
		if (dto.durationDays !== undefined) out.durationDays = dto.durationDays ?? null;
		if (dto.description !== undefined) out.description = dto.description?.trim() || null;
		if (dto.features !== undefined) out.features = (dto.features || []).map((f) => f.trim()).filter(Boolean);
		return out;
	}

	/** Month-based packages use interval × count; day-based ones are `one_time` + durationDays. */
	private normalizePlanLength(plan: Partial<BillingPlan>) {
		if (plan.interval === 'one_time') {
			if (!(Number(plan.durationDays) > 0)) throw new BadRequestException('A one-time package needs a duration in days');
			plan.intervalCount = 1;
		} else {
			plan.durationDays = null;
			plan.intervalCount = Math.max(1, Number(plan.intervalCount || 1));
		}
	}

	private async savePlan(plan: BillingPlan) {
		try {
			return await this.planRepo.save(plan);
		} catch (e: any) {
			if (e?.code === '23505') throw new BadRequestException('A package with this name already exists');
			throw e;
		}
	}

	async createPlan(dto: CreatePlanDto, actor: BillingActor) {
		const owner = planOwnerFor(actor) ?? null;
		const fields = this.planFields(dto);
		if (!fields.name) throw new BadRequestException('Package name is required');
		this.normalizePlanLength(fields);

		const sameName = await this.planRepo
			.createQueryBuilder('plan')
			.where('LOWER(plan.name) = LOWER(:name)', { name: fields.name })
			.andWhere(owner ? 'plan.adminId = :owner' : 'plan.adminId IS NULL', { owner })
			.getOne();
		if (sameName && sameName.status !== BillingPlanStatus.ARCHIVED) {
			throw new BadRequestException('A package with this name already exists');
		}

		// Re-adding an archived name revives it so the old subscriptions keep pointing at it.
		const plan = sameName ?? this.planRepo.create({ adminId: owner, currency: 'EGP', isPopular: false });
		Object.assign(plan, {
			intervalCount: 1,
			durationDays: null,
			description: null,
			features: [],
			...fields,
			status: BillingPlanStatus.ACTIVE,
		});
		const saved = await this.savePlan(plan);
		return this.planView(saved);
	}

	async updatePlan(id: string, dto: UpdatePlanDto, actor: BillingActor) {
		const plan = await this.findPlanForActor(id, actor);
		const fields = this.planFields(dto);
		if (fields.name === '') throw new BadRequestException('Package name is required');
		Object.assign(plan, fields);
		if (plan.status === BillingPlanStatus.ARCHIVED) throw new NotFoundException('Package not found');
		this.normalizePlanLength(plan);
		const saved = await this.savePlan(plan);
		return this.planView(saved);
	}

	async removePlan(id: string, actor: BillingActor) {
		const plan = await this.findPlanForActor(id, actor);
		plan.status = BillingPlanStatus.ARCHIVED;
		await this.planRepo.save(plan);
		return { ok: true };
	}

	async findPlanById(id: string, actor: BillingActor) {
		return this.planView(await this.findPlanForActor(id, actor));
	}

	async getPlans(query: any, actor: BillingActor) {
		const { take, skip, page, limit } = this.paginate(query.page, query.limit ?? 100);
		const owner = planOwnerFor(actor);
		if (owner === null) return { items: [], meta: { total: 0, page, limit, totalPages: 0 } };

		const qb = this.planRepo.createQueryBuilder('plan')
			.orderBy('plan.price', 'ASC')
			.addOrderBy('plan.created_at', 'DESC')
			.take(take)
			.skip(skip);

		if (owner !== undefined) qb.andWhere('plan.adminId = :owner', { owner });
		if (query.status) qb.andWhere('plan.status = :status', { status: query.status });
		else qb.andWhere('plan.status != :archived', { archived: BillingPlanStatus.ARCHIVED });

		if (query.q) {
			qb.andWhere(
				new Brackets((sq) => {
					sq.where('LOWER(plan.name) LIKE LOWER(:q)', { q: `%${query.q}%` })
						.orWhere('LOWER(plan.description) LIKE LOWER(:q)', { q: `%${query.q}%` });
				}),
			);
		}

		const [plans, total] = await qb.getManyAndCount();
		const counts = new Map<string, number>();
		if (plans.length) {
			const today = todayYmd();
			const rows = await this.subscriptionRepo
				.createQueryBuilder('sub')
				.select('sub.planId', 'planId')
				.addSelect('COUNT(DISTINCT sub.userId)', 'n')
				.where('sub.planId IN (:...ids)', { ids: plans.map((p) => p.id) })
				.andWhere('sub.status = :active', { active: SubscriptionStatus.ACTIVE })
				.andWhere('(sub.endDate IS NULL OR sub.endDate >= :today)', { today })
				.groupBy('sub.planId')
				.getRawMany();
			for (const r of rows) counts.set(r.planId, Number(r.n));
		}

		return {
			items: plans.map((p) => this.planView(p, counts.get(p.id) ?? 0)),
			meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
		};
	}

	/* =========================================================
	 * Payments — record / delete keep the client's subscription in sync
	 * ======================================================= */

	private paymentView(p: PaymentTransaction) {
		const meta = (p.metadata || {}) as PaymentMeta;
		const created = p.created_at ? new Date(p.created_at).toISOString() : null;
		return {
			id: p.id,
			amount: money(p.amount),
			currency: p.currency,
			method: p.paymentMethod,
			status: p.status,
			paidAt: p.paidAt || (created ? created.slice(0, 10) : null),
			createdAt: created,
			notes: p.notes ?? null,
			client: p.user ? { id: p.user.id, name: p.user.name, phone: p.user.phone ?? null, email: p.user.email } : null,
			planName: meta.planName ?? null,
			periodFrom: meta.periodFrom ?? null,
			periodTo: meta.periodTo ?? null,
			description: p.invoice?.description ?? null,
			invoiceNumber: p.invoice?.invoiceNumber ?? null,
			extendsSubscription: Boolean(meta.subscriptionId),
		};
	}

	private async findPaymentForActor(id: string, actor: BillingActor) {
		const payment = await this.paymentRepo.findOne({ where: { id }, relations: ['user', 'invoice'] });
		if (!payment || !payment.user || !canManageClient(actor, payment.user)) throw new NotFoundException('Payment not found');
		return payment;
	}

	async recordPayment(dto: RecordPaymentDto, actor: BillingActor) {
		const client = await this.findClientForActor(dto.userId, actor);
		const plan = dto.planId ? await this.findPlanForActor(dto.planId, actor) : null;
		if (plan && plan.status === BillingPlanStatus.ARCHIVED) throw new BadRequestException('This package was deleted');

		const today = todayYmd();
		const paidAt = dto.paidAt || today;
		if (!isYmd(paidAt)) throw new BadRequestException('Invalid payment date');
		const period = resolvePeriod({
			periodFrom: dto.periodFrom,
			periodTo: dto.periodTo,
			plan,
			currentEnd: client.subscriptionEnd,
			today,
		});

		const amount = money(dto.amount).toFixed(2);
		const currency = plan?.currency || 'EGP';
		const notes = dto.notes?.trim() || null;
		const description = plan?.name || notes || 'Payment';
		const previous = {
			subscriptionStart: client.subscriptionStart ?? null,
			subscriptionEnd: client.subscriptionEnd ?? null,
			membership: client.membership ?? null,
		};

		const paymentId = await this.dataSource.transaction(async (m) => {
			let subscriptionId: string | null = null;
			let superseded: string[] = [];

			if (period) {
				const running = await m.find(UserSubscription, { where: { userId: client.id, status: SubscriptionStatus.ACTIVE } });
				superseded = running.map((s) => s.id);
				if (superseded.length) await m.update(UserSubscription, { id: In(superseded) }, { status: SubscriptionStatus.EXPIRED });

				const sub = await m.save(m.create(UserSubscription, {
					userId: client.id,
					planId: plan?.id ?? null,
					status: SubscriptionStatus.ACTIVE,
					startDate: period.start,
					endDate: period.end,
					autoRenew: false,
					currency,
					priceAtPurchase: amount,
					provider: 'manual',
					notes,
				}));
				subscriptionId = sub.id;

				await m.update(User, client.id, {
					subscriptionStart: period.start,
					subscriptionEnd: period.end,
					...(plan ? { membership: plan.name.slice(0, 64) } : {}),
				});
			}

			const invoice = await m.save(m.create(BillingInvoice, {
				userId: client.id,
				planId: plan?.id ?? null,
				subscriptionId,
				invoiceNumber: this.buildInvoiceNumber(),
				status: InvoiceStatus.PAID,
				subtotal: amount,
				total: amount,
				amountPaid: amount,
				amountDue: '0',
				currency,
				issueDate: paidAt,
				dueDate: paidAt,
				paidAt,
				description,
				notes,
				items: [{ title: description, qty: 1, unitPrice: Number(amount), total: Number(amount) }],
			}));

			const meta: PaymentMeta = {
				source: 'manual',
				planId: plan?.id ?? null,
				planName: plan?.name ?? null,
				periodFrom: period?.start ?? null,
				periodTo: period?.end ?? null,
				subscriptionId,
				supersededSubscriptionIds: superseded,
				previous,
			};
			const payment = await m.save(m.create(PaymentTransaction, {
				userId: client.id,
				invoiceId: invoice.id,
				paymentMethod: (dto.method || PaymentMethodType.CASH) as PaymentMethodType,
				status: PaymentStatus.SUCCEEDED,
				amount,
				currency,
				provider: 'manual',
				paidAt,
				notes,
				metadata: { ...meta, recordedBy: actor.id },
			}));
			return payment.id;
		});

		return this.paymentView(await this.findPaymentForActor(paymentId, actor));
	}

	async deletePayment(id: string, actor: BillingActor) {
		const payment = await this.findPaymentForActor(id, actor);
		const meta = (payment.metadata || {}) as PaymentMeta;
		let subscriptionReverted = false;
		let invoiceStillUsed = false;

		await this.dataSource.transaction(async (m) => {
			if (meta.subscriptionId) {
				const sub = await m.findOne(UserSubscription, { where: { id: meta.subscriptionId } });
				if (sub) {
					const user = await m.findOne(User, { where: { id: payment.userId } });
					// Only roll the client back when no later payment/edit replaced these dates.
					const stillCurrent = !!user && user.subscriptionStart === sub.startDate && user.subscriptionEnd === sub.endDate;
					if (stillCurrent) {
						const prev = meta.previous || {};
						await m.update(User, payment.userId, {
							subscriptionStart: prev.subscriptionStart ?? null,
							subscriptionEnd: prev.subscriptionEnd ?? null,
							membership: prev.membership ?? null,
						});
						const ids = (meta.supersededSubscriptionIds || []).filter((x) => typeof x === 'string');
						if (ids.length) {
							await m.update(
								UserSubscription,
								{ id: In(ids), status: SubscriptionStatus.EXPIRED },
								{ status: SubscriptionStatus.ACTIVE },
							);
						}
						subscriptionReverted = true;
					}
					await m.softDelete(UserSubscription, sub.id);
				}
			}

			if (payment.invoiceId) {
				const others = await m.count(PaymentTransaction, { where: { invoiceId: payment.invoiceId, id: Not(payment.id) } });
				invoiceStillUsed = others > 0;
				if (!invoiceStillUsed) await m.softDelete(BillingInvoice, payment.invoiceId);
			}

			await m.softDelete(PaymentTransaction, payment.id);
		});

		if (invoiceStillUsed && payment.invoiceId) await this.recalculateInvoice(payment.invoiceId);
		return { ok: true, subscriptionReverted };
	}

	private filteredPayments(query: any, actor: BillingActor) {
		const qb = this.paymentRepo.createQueryBuilder('payment')
			.innerJoin('payment.user', 'user')
			.leftJoin('payment.invoice', 'invoice');
		this.applyScope(qb, actor, 'user');

		if (query.userId) qb.andWhere('payment.userId = :userId', { userId: query.userId });
		if (query.status) qb.andWhere('payment.status = :status', { status: query.status });
		if (query.method) qb.andWhere('payment.paymentMethod = :method', { method: query.method });
		if (isYmd(query.dateFrom)) qb.andWhere(`${PAID_DAY} >= :dateFrom`, { dateFrom: query.dateFrom });
		if (isYmd(query.dateTo)) qb.andWhere(`${PAID_DAY} <= :dateTo`, { dateTo: query.dateTo });

		const q = String(query.q || '').trim();
		if (q) {
			qb.andWhere(
				new Brackets((sq) => {
					sq.where('user.name ILIKE :q', { q: `%${q}%` })
						.orWhere('user.phone ILIKE :q', { q: `%${q}%` })
						.orWhere('payment.notes ILIKE :q', { q: `%${q}%` })
						.orWhere('invoice.description ILIKE :q', { q: `%${q}%` });
				}),
			);
		}
		return qb;
	}

	async getPayments(query: any, actor: BillingActor) {
		const { take, skip, page, limit } = this.paginate(query.page, query.limit);

		const listQb = this.filteredPayments(query, actor)
			.addSelect(['user.id', 'user.name', 'user.phone', 'user.email'])
			.addSelect(['invoice.id', 'invoice.invoiceNumber', 'invoice.description'])
			.orderBy('payment.paidAt', 'DESC', 'NULLS LAST')
			.addOrderBy('payment.created_at', 'DESC')
			.limit(take)
			.offset(skip);

		const sumQb = this.filteredPayments(query, actor)
			.select('COALESCE(SUM(payment.amount), 0)', 'sum')
			.andWhere('payment.status = :succeeded', { succeeded: PaymentStatus.SUCCEEDED });

		const [[items, total], sumRow] = await Promise.all([listQb.getManyAndCount(), sumQb.getRawOne()]);

		return {
			items: items.map((p) => this.paymentView(p)),
			meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
			summary: { collected: money(sumRow?.sum) },
		};
	}

	async findPaymentById(id: string, actor: BillingActor) {
		return this.paymentView(await this.findPaymentForActor(id, actor));
	}

	async createPayment(dto: any, actor: BillingActor) {
		await this.findClientForActor(dto?.userId, actor);
		if (dto.invoiceId) await this.findInvoiceById(dto.invoiceId, actor);

		const payment = this.paymentRepo.create({
			...dto,
			status: dto.status ?? PaymentStatus.PENDING,
			currency: dto.currency ?? 'EGP',
		});

		const saved: any = await this.paymentRepo.save(payment);

		if (saved.invoiceId && saved.status === PaymentStatus.SUCCEEDED) {
			await this.recalculateInvoice(saved.invoiceId);
		}

		return this.findPaymentById(saved.id, actor);
	}

	async updatePayment(id: string, dto: any, actor: BillingActor) {
		const payment = await this.findPaymentForActor(id, actor);
		const patch = safePatch(dto);
		delete patch.invoiceId;
		delete patch.metadata;
		Object.assign(payment, patch);
		const saved = await this.paymentRepo.save(payment);

		if (saved.invoiceId) {
			await this.recalculateInvoice(saved.invoiceId);
		}

		return this.findPaymentById(saved.id, actor);
	}

	/* =========================================================
	 * Subscriptions (history; payments keep them current)
	 * ======================================================= */

	private async findSubscriptionForActor(id: string, actor: BillingActor) {
		const sub = await this.subscriptionRepo.findOne({ where: { id }, relations: ['user'] });
		if (!sub || !sub.user || !canManageClient(actor, sub.user)) throw new NotFoundException('Subscription not found');
		return sub;
	}

	async createSubscription(dto: any, actor: BillingActor) {
		const user = await this.findClientForActor(dto?.userId, actor);
		const plan = await this.findPlanForActor(dto?.planId, actor);

		const currentActive = await this.subscriptionRepo.findOne({
			where: {
				userId: user.id,
				status: SubscriptionStatus.ACTIVE,
			},
			order: { created_at: 'DESC' },
		});

		if (currentActive) {
			currentActive.status = SubscriptionStatus.CANCELED;
			currentActive.canceledAt = todayYmd();
			currentActive.cancelReason = 'Replaced by new subscription';
			await this.subscriptionRepo.save(currentActive);
		}

		const start = dto.startDate ?? todayYmd();

		const sub = this.subscriptionRepo.create({
			...safePatch(dto),
			userId: user.id,
			planId: plan.id,
			startDate: start,
			autoRenew: dto.autoRenew ?? true,
			currency: plan.currency,
			priceAtPurchase: plan.price,
			status: dto.status ?? SubscriptionStatus.ACTIVE,
			provider: dto.provider ?? null,
		});

		const saved: any = await this.subscriptionRepo.save(sub);

		await this.userRepo.update(user.id, {
			membership: plan.name.slice(0, 64),
			subscriptionStart: saved.startDate,
			subscriptionEnd: saved.endDate ?? null,
		});

		return saved;
	}

	async updateSubscription(id: string, dto: any, actor: BillingActor) {
		const sub = await this.findSubscriptionForActor(id, actor);
		if (dto?.action) {
			const action = String(dto.action).toLowerCase();
			if (action === 'pause' || action === 'freeze') sub.status = SubscriptionStatus.PAST_DUE;
			if (action === 'resume') sub.status = SubscriptionStatus.ACTIVE;
			if (action === 'cancel') sub.status = SubscriptionStatus.CANCELED;
			if (action === 'extend_days' && Number(dto.days || 0) > 0) {
				sub.endDate = addDays(sub.endDate && isYmd(sub.endDate) ? sub.endDate : todayYmd(), Number(dto.days));
			}
			if (action === 'change_package' && dto.planId) {
				sub.planId = (await this.findPlanForActor(dto.planId, actor)).id;
			}
		}
		const patch = safePatch(dto);
		delete patch.action;
		delete patch.days;
		delete patch.planId;
		Object.assign(sub, patch);
		const saved = await this.subscriptionRepo.save(sub);

		if (saved.status === SubscriptionStatus.ACTIVE) {
			await this.userRepo.update(saved.userId, {
				subscriptionStart: saved.startDate,
				subscriptionEnd: saved.endDate,
				...(saved.plan ? { membership: saved.plan.name.slice(0, 64) } : {}),
			});
		}

		return saved;
	}

	async cancelSubscription(id: string, reason: string | undefined, actor: BillingActor) {
		const sub = await this.findSubscriptionForActor(id, actor);
		sub.status = SubscriptionStatus.CANCELED;
		sub.canceledAt = todayYmd();
		sub.cancelReason = reason ?? null;

		const saved = await this.subscriptionRepo.save(sub);
		await this.userRepo.update(sub.userId, { subscriptionEnd: sub.canceledAt });
		return saved;
	}

	async findSubscriptionById(id: string, actor: BillingActor) {
		return this.findSubscriptionForActor(id, actor);
	}

	async getSubscriptions(query: any, actor: BillingActor) {
		const { take, skip, page, limit } = this.paginate(query.page, query.limit);

		const qb = this.subscriptionRepo.createQueryBuilder('sub')
			.innerJoin('sub.user', 'user')
			.addSelect(['user.id', 'user.name', 'user.email', 'user.phone'])
			.leftJoinAndSelect('sub.plan', 'plan')
			.orderBy('sub.created_at', 'DESC')
			.take(take)
			.skip(skip);
		this.applyScope(qb, actor, 'user');

		if (query.userId) qb.andWhere('sub.userId = :userId', { userId: query.userId });
		if (query.planId) qb.andWhere('sub.planId = :planId', { planId: query.planId });
		if (query.status) qb.andWhere('sub.status = :status', { status: query.status });
		if (isYmd(query.dateFrom)) qb.andWhere('sub.startDate >= :dateFrom', { dateFrom: query.dateFrom });
		if (isYmd(query.dateTo)) qb.andWhere('sub.startDate <= :dateTo', { dateTo: query.dateTo });

		const [items, total] = await qb.getManyAndCount();

		return {
			items,
			meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
		};
	}

	async getCurrentSubscription(userId: string, actor: BillingActor) {
		await this.findClientForActor(userId, actor);
		return this.subscriptionRepo.findOne({
			where: { userId, status: SubscriptionStatus.ACTIVE },
			order: { created_at: 'DESC' },
		});
	}

	/* =========================================================
	 * Invoices (created with each recorded payment)
	 * ======================================================= */

	async createInvoice(dto: any, actor: BillingActor) {
		await this.findClientForActor(dto?.userId, actor);
		if (dto.planId) await this.findPlanForActor(dto.planId, actor);

		const invoice = this.invoiceRepo.create({
			...dto,
			invoiceNumber: dto.invoiceNumber ?? this.buildInvoiceNumber(),
			status: dto.status ?? InvoiceStatus.OPEN,
			discount: dto.discount ?? '0',
			tax: dto.tax ?? '0',
			amountPaid: dto.amountPaid ?? '0',
			amountDue: dto.amountDue ?? dto.total,
			currency: dto.currency ?? 'EGP',
			issueDate: dto.issueDate ?? todayYmd(),
		});

		return this.invoiceRepo.save(invoice);
	}

	async updateInvoice(id: string, dto: any, actor: BillingActor) {
		const invoice = await this.findInvoiceById(id, actor);
		Object.assign(invoice, safePatch(dto));
		const saved = await this.invoiceRepo.save(invoice);
		await this.recalculateInvoice(saved.id);
		return this.findInvoiceById(saved.id, actor);
	}

	async markInvoicePaid(id: string, actor: BillingActor) {
		const invoice = await this.findInvoiceById(id, actor);
		invoice.status = InvoiceStatus.PAID;
		invoice.amountPaid = invoice.total;
		invoice.amountDue = '0';
		invoice.paidAt = todayYmd();
		return this.invoiceRepo.save(invoice);
	}

	async findInvoiceById(id: string, actor: BillingActor) {
		const invoice = await this.invoiceRepo.findOne({
			where: { id },
			relations: ['payments', 'subscription', 'user'],
		});
		if (!invoice || !invoice.user || !canManageClient(actor, invoice.user)) throw new NotFoundException('Invoice not found');
		return invoice;
	}

	async getInvoices(query: any, actor: BillingActor) {
		const { take, skip, page, limit } = this.paginate(query.page, query.limit);

		const qb = this.invoiceRepo.createQueryBuilder('invoice')
			.innerJoin('invoice.user', 'user')
			.addSelect(['user.id', 'user.name', 'user.email', 'user.phone'])
			.leftJoinAndSelect('invoice.plan', 'plan')
			.leftJoinAndSelect('invoice.subscription', 'subscription')
			.orderBy('invoice.created_at', 'DESC')
			.take(take)
			.skip(skip);
		this.applyScope(qb, actor, 'user');

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

		if (isYmd(query.dateFrom)) qb.andWhere('invoice.issueDate >= :dateFrom', { dateFrom: query.dateFrom });
		if (isYmd(query.dateTo)) qb.andWhere('invoice.issueDate <= :dateTo', { dateTo: query.dateTo });

		const [items, total] = await qb.getManyAndCount();

		return {
			items,
			meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
		};
	}

	/* =========================================================
	 * Clients & renewals
	 * ======================================================= */

	private subscriptionState(end: string | null | undefined, today: string) {
		if (!end) return { status: 'none', daysLeft: null as number | null };
		const daysLeft = daysBetween(today, end);
		if (daysLeft < 0) return { status: 'expired', daysLeft };
		if (daysLeft <= 7) return { status: 'expiring', daysLeft };
		return { status: 'active', daysLeft };
	}

	async getClients(query: any, actor: BillingActor) {
		const { take, skip, page, limit } = this.paginate(query.page, query.limit);
		const today = todayYmd();

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
				'u.updated_at',
				'u.coachId',
				'coach.id',
				'coach.name',
			])
			.where('u.role = :role', { role: UserRole.CLIENT })
			.orderBy('u.created_at', 'DESC')
			.take(take)
			.skip(skip);
		this.applyScope(qb, actor, 'u');

		const q = String(query.q || '').trim();
		if (q) {
			qb.andWhere(
				new Brackets((sq) => {
					sq.where('u.name ILIKE :q', { q: `%${q}%` })
						.orWhere('u.email ILIKE :q', { q: `%${q}%` })
						.orWhere('u.phone ILIKE :q', { q: `%${q}%` });
				}),
			);
		}
		if (query.coachId) qb.andWhere('u.coachId = :coachId', { coachId: query.coachId });

		const [users, total] = await qb.getManyAndCount();

		const lastPaid = new Map<string, { lastPaymentAt: string | null; totalPaid: number }>();
		if (users.length) {
			const rows = await this.paymentRepo
				.createQueryBuilder('payment')
				.select('payment.userId', 'userId')
				.addSelect(`to_char(MAX(${PAID_DAY}), 'YYYY-MM-DD')`, 'lastPaymentAt')
				.addSelect('COALESCE(SUM(payment.amount), 0)', 'totalPaid')
				.where('payment.userId IN (:...ids)', { ids: users.map((u) => u.id) })
				.andWhere('payment.status = :succeeded', { succeeded: PaymentStatus.SUCCEEDED })
				.groupBy('payment.userId')
				.getRawMany();
			for (const r of rows) lastPaid.set(r.userId, { lastPaymentAt: r.lastPaymentAt ?? null, totalPaid: money(r.totalPaid) });
		}

		return {
			items: users.map((u) => {
				const membership = u.membership && u.membership !== '-' ? u.membership : null;
				const state = this.subscriptionState(u.subscriptionEnd, today);
				const paid = lastPaid.get(u.id);
				return {
					id: u.id,
					name: u.name,
					email: u.email,
					phone: u.phone ?? null,
					gender: u.gender ?? null,
					status: u.status,
					coachId: u.coachId ?? null,
					coach: u.coach ? { id: u.coach.id, name: u.coach.name } : null,
					membership,
					subscriptionStart: u.subscriptionStart ?? null,
					subscriptionEnd: u.subscriptionEnd ?? null,
					currentPackage: membership,
					renewalDate: u.subscriptionEnd ?? null,
					subscriptionStatus: state.status,
					daysLeft: state.daysLeft,
					lastPaymentAt: paid?.lastPaymentAt ?? null,
					totalPaid: paid?.totalPaid ?? 0,
					lastActivity: paid?.lastPaymentAt ?? u.updated_at ?? u.created_at,
					created_at: u.created_at,
				};
			}),
			meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
		};
	}

	async getClientById(id: string, actor: BillingActor) {
		const user = await this.findClientForActor(id, actor);
		const coach = user.coachId ? await this.userRepo.findOne({ where: { id: user.coachId } }) : null;
		const currentSubscription = await this.subscriptionRepo.findOne({
			where: { userId: id, status: SubscriptionStatus.ACTIVE },
			order: { created_at: 'DESC' },
		});
		const paymentsSummary = await this.paymentRepo
			.createQueryBuilder('p')
			.select('COALESCE(SUM(p.amount),0)', 'sum')
			.where('p.userId = :id', { id })
			.andWhere('p.status = :status', { status: PaymentStatus.SUCCEEDED })
			.getRawOne();
		return {
			profile: { ...user, coach: coach ? { id: coach.id, name: coach.name } : null },
			currentSubscription,
			paymentsSummary: Number(paymentsSummary?.sum || 0),
		};
	}

	async getClientTimeline(clientId: string, query: any = {}, actor: BillingActor) {
		const user = await this.findClientForActor(clientId, actor);
		const events: any[] = [];

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

	async getClientProgress(clientId: string, actor: BillingActor) {
		await this.findClientForActor(clientId, actor);
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

		return {
			monthlyPayments: monthlyPayments.map((x) => ({ month: x.month, total: Number(x.total), count: Number(x.count) })),
			monthlySubscriptions: monthlySubscriptions.map((x) => ({ month: x.month, count: Number(x.count) })),
			monthlyCheckins: [],
			monthlyAdherence: [],
			monthlyMeasurements: [],
		};
	}

	async getClientCheckins(clientId: string, actor: BillingActor) {
		await this.findClientForActor(clientId, actor);
		return [];
	}

	async getClientNotes(clientId: string, actor: BillingActor) {
		await this.findClientForActor(clientId, actor);
		return this.noteRepo.find({ where: { clientId }, order: { isPinned: 'DESC', created_at: 'DESC' } as any });
	}

	async createClientNote(clientId: string, dto: any, actor: BillingActor) {
		await this.findClientForActor(clientId, actor);
		const text = String(dto?.text || '').trim();
		if (!text) throw new BadRequestException('Note text is required');
		const note = this.noteRepo.create({
			clientId,
			authorId: actor.id,
			type: dto.type ?? ClientNoteType.GENERAL,
			text,
			isPinned: !!dto.isPinned,
		});
		return this.noteRepo.save(note);
	}

	async updateClientNote(clientId: string, noteId: string, dto: any, actor: BillingActor) {
		await this.findClientForActor(clientId, actor);
		const note = await this.noteRepo.findOne({ where: { id: noteId, clientId } });
		if (!note) throw new NotFoundException('Note not found');
		const patch = safePatch(dto);
		delete patch.clientId;
		delete patch.authorId;
		Object.assign(note, patch);
		return this.noteRepo.save(note);
	}

	async deleteClientNote(clientId: string, noteId: string, actor: BillingActor) {
		await this.findClientForActor(clientId, actor);
		const note = await this.noteRepo.findOne({ where: { id: noteId, clientId } });
		if (!note) throw new NotFoundException('Note not found');
		await this.noteRepo.remove(note);
		return { ok: true };
	}

	async getClientPlansHistory(clientId: string, actor: BillingActor) {
		await this.findClientForActor(clientId, actor);
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
			replacedBy: null,
			notes: s.notes || null,
		}));
	}

	async getClientCommunications(clientId: string, actor: BillingActor) {
		await this.findClientForActor(clientId, actor);
		return this.commRepo.find({ where: { clientId }, order: { created_at: 'DESC' } });
	}

	async sendClientCommunication(clientId: string, dto: any, actor: BillingActor) {
		await this.findClientForActor(clientId, actor);
		const log = this.commRepo.create({
			clientId,
			coachId: actor.id,
			type: dto.type ?? CommunicationType.OTHER,
			template: dto.template ?? null,
			message: dto.message ?? null,
			status: 'sent',
			metadata: dto.metadata ?? null,
		});
		return this.commRepo.save(log);
	}

	/* =========================================================
	 * Overview numbers (all scoped to the actor's clients)
	 * ======================================================= */

	async getStats(actor: BillingActor) {
		const today = todayYmd();
		const monthStart = `${today.slice(0, 8)}01`;
		const prevMonthStart = (() => {
			const [y, m] = today.split('-').map(Number);
			const d = new Date(Date.UTC(y, m - 2, 1));
			return d.toISOString().slice(0, 10);
		})();
		const in7 = addDays(today, 7);

		const clientsQb = this.userRepo.createQueryBuilder('u')
			.select('COUNT(*)', 'total')
			.addSelect('COUNT(*) FILTER (WHERE u.subscriptionEnd >= :today)', 'active')
			.addSelect('COUNT(*) FILTER (WHERE u.subscriptionEnd >= :today AND u.subscriptionEnd <= :in7)', 'expiringSoon')
			.addSelect('COUNT(*) FILTER (WHERE u.subscriptionEnd < :today)', 'expired')
			.addSelect('COUNT(*) FILTER (WHERE u.subscriptionEnd IS NULL)', 'noSubscription')
			.where('u.role = :role', { role: UserRole.CLIENT })
			.setParameters({ today, in7 });
		this.applyScope(clientsQb, actor, 'u');

		const paymentsQb = this.paymentRepo.createQueryBuilder('payment')
			.innerJoin('payment.user', 'user')
			.select(`COALESCE(SUM(payment.amount) FILTER (WHERE ${PAID_DAY} >= :monthStart), 0)`, 'thisMonth')
			.addSelect(`COUNT(*) FILTER (WHERE ${PAID_DAY} >= :monthStart)`, 'thisMonthCount')
			.addSelect(`COALESCE(SUM(payment.amount) FILTER (WHERE ${PAID_DAY} >= :prevMonthStart AND ${PAID_DAY} < :monthStart), 0)`, 'lastMonth')
			.addSelect('COALESCE(SUM(payment.amount), 0)', 'allTime')
			.addSelect('COUNT(*)', 'allTimeCount')
			.where('payment.status = :succeeded', { succeeded: PaymentStatus.SUCCEEDED })
			.setParameters({ monthStart, prevMonthStart });
		this.applyScope(paymentsQb, actor, 'user');

		const [clients, payments] = await Promise.all([clientsQb.getRawOne(), paymentsQb.getRawOne()]);

		return {
			today,
			clients: {
				total: Number(clients?.total || 0),
				active: Number(clients?.active || 0),
				expiringSoon: Number(clients?.expiringSoon || 0),
				expired: Number(clients?.expired || 0),
				noSubscription: Number(clients?.noSubscription || 0),
			},
			revenue: {
				thisMonth: money(payments?.thisMonth),
				thisMonthCount: Number(payments?.thisMonthCount || 0),
				lastMonth: money(payments?.lastMonth),
				allTime: money(payments?.allTime),
				allTimeCount: Number(payments?.allTimeCount || 0),
			},
		};
	}
}
