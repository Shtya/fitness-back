import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
	MetaWaMessageDirection,
	MetaWaMessageStatus,
	MetaWhatsAppConversation,
	MetaWhatsAppMessage,
} from '../entities/meta-whatsapp.entity';
import { MetaWhatsAppConfigService } from './meta-whatsapp-config.service';
import { MetaWhatsAppCloudApiService } from './meta-whatsapp-cloud-api.service';
import {
	BILLING_DISCLAIMER,
	countryCodeFromMarket,
	marketFromWaId,
	MetaPricingCategory,
	rateFor,
	RATE_CARD_USD,
} from '../constants/meta-pricing-rates';

function startOfMonth(d = new Date()) {
	return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
}

function endOfMonth(d = new Date()) {
	return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59, 999));
}

function prevMonthRange(d = new Date()) {
	const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1, 0, 0, 0, 0));
	const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0, 23, 59, 59, 999));
	return { start, end };
}

function dayKey(d: Date) {
	return d.toISOString().slice(0, 10);
}

function emptyCategoryBucket() {
	return {
		MARKETING: 0,
		UTILITY: 0,
		AUTHENTICATION: 0,
		SERVICE: 0,
		UNKNOWN: 0,
	};
}

@Injectable()
export class MetaWhatsAppUsageBillingService {
	private readonly logger = new Logger(MetaWhatsAppUsageBillingService.name);

	constructor(
		@InjectRepository(MetaWhatsAppMessage)
		private readonly messageRepo: Repository<MetaWhatsAppMessage>,
		@InjectRepository(MetaWhatsAppConversation)
		private readonly conversationRepo: Repository<MetaWhatsAppConversation>,
		private readonly configService: MetaWhatsAppConfigService,
		private readonly cloudApi: MetaWhatsAppCloudApiService,
	) {}

	async getDashboard(userId?: string) {
		const now = new Date();
		const thisStart = startOfMonth(now);
		const thisEnd = endOfMonth(now);
		const prev = prevMonthRange(now);

		const [localThis, localPrev, metaBundle] = await Promise.all([
			this.buildLocalPeriod(thisStart, thisEnd),
			this.buildLocalPeriod(prev.start, prev.end),
			this.fetchMetaAnalyticsSafe(thisStart, thisEnd),
		]);

		await this.activitySafe(userId);

		const estimatedThis = localThis.estimatedCostUsd;
		const estimatedPrev = localPrev.estimatedCostUsd;
		const usdToEgp = this.resolveUsdToEgp();
		const deltaPct =
			estimatedPrev > 0
				? ((estimatedThis - estimatedPrev) / estimatedPrev) * 100
				: estimatedThis > 0
					? 100
					: 0;

		return {
			title: 'WhatsApp Usage & Billing',
			currency: 'USD',
			period: {
				current: { start: thisStart.toISOString(), end: thisEnd.toISOString() },
				previous: { start: prev.start.toISOString(), end: prev.end.toISOString() },
			},
			disclaimer: BILLING_DISCLAIMER,
			invoiceNote:
				'WhatsApp Manager → Billing is the financial source of truth for the final amount due.',
			pricingModelNote:
				'Since 1 July 2025 Meta bills per eligible delivered message (not per conversation). Service messages inside the customer-care window are free under current Meta rules.',
			sources: {
				localDb: true,
				metaMessagingAnalytics: Boolean(metaBundle.messaging),
				metaPricingAnalytics: Boolean(metaBundle.pricing),
				metaTemplateAnalytics: Boolean(metaBundle.templates),
				metaErrors: metaBundle.errors,
			},
			summary: {
				sent: localThis.sent,
				delivered: localThis.delivered,
				read: localThis.read,
				failed: localThis.failed,
				inbound: localThis.inbound,
				billableDelivered: localThis.billableDelivered,
				byCategory: localThis.byCategory,
				estimatedCostUsd: Number(estimatedThis.toFixed(4)),
				estimatedCostEgp: Number((estimatedThis * usdToEgp).toFixed(2)),
				previousEstimatedCostUsd: Number(estimatedPrev.toFixed(4)),
				previousEstimatedCostEgp: Number((estimatedPrev * usdToEgp).toFixed(2)),
				vsPreviousMonthPct: Number(deltaPct.toFixed(1)),
				metaPricingCostUsd: metaBundle.pricingCostTotal,
				metaPricingCostEgp:
					metaBundle.pricingCostTotal != null
						? Number((metaBundle.pricingCostTotal * usdToEgp).toFixed(2))
						: null,
			},
			fx: {
				usdToEgp,
				note: 'Approximate market rate for display only — not a bank settlement rate.',
			},
			byCountry: localThis.byCountry.map((c: any) => ({
				...c,
				estimatedCostEgp: Number((Number(c.estimatedCostUsd || 0) * usdToEgp).toFixed(2)),
			})),
			byCategoryCost: localThis.byCategoryCost,
			byCategoryCostEgp: Object.fromEntries(
				Object.entries(localThis.byCategoryCost || {}).map(([k, v]) => [
					k,
					Number((Number(v) * usdToEgp).toFixed(2)),
				]),
			),
			daily: localThis.daily.map((d: any) => ({
				...d,
				estimatedCostEgp: Number((Number(d.estimatedCostUsd || 0) * usdToEgp).toFixed(2)),
			})),
			templates: localThis.templates.map((t: any) => ({
				...t,
				estimatedCostEgp: Number((Number(t.estimatedCostUsd || 0) * usdToEgp).toFixed(2)),
			})),
			meta: {
				messaging: metaBundle.messaging,
				pricing: metaBundle.pricing,
				templates: metaBundle.templates,
			},
			rateCardSample: Object.values(RATE_CARD_USD).map(r => ({
				market: r.country,
				label: r.label,
				marketing: r.marketing,
				utility: r.utility,
				authentication: r.authentication,
				service: r.service,
			})),
			generatedAt: new Date().toISOString(),
		};
	}

	private resolveUsdToEgp() {
		const fromEnv = Number(process.env.META_USD_TO_EGP || process.env.USD_TO_EGP || '');
		if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
		// Approx mid-market reference (update via META_USD_TO_EGP when needed)
		return 50.7;
	}

	private async activitySafe(userId?: string) {
		try {
			// optional — avoid circular import issues by not injecting activity if unused
			void userId;
		} catch {
			/* ignore */
		}
	}

	private async buildLocalPeriod(start: Date, end: Date) {
		const rows = await this.messageRepo
			.createQueryBuilder('m')
			.leftJoin(MetaWhatsAppConversation, 'c', 'c.id = m.conversation_id')
			.select([
				'm.id AS id',
				'm.direction AS direction',
				'm.message_type AS "messageType"',
				'm.status AS status',
				'm.template_name AS "templateName"',
				'm.pricing_category AS "pricingCategory"',
				'm.pricing_type AS "pricingType"',
				'm.billable AS billable',
				'm.recipient_country AS "recipientCountry"',
				'm.estimated_cost_usd AS "estimatedCostUsd"',
				'm.created_at AS "createdAt"',
				'c.wa_id AS "waId"',
			])
			.where('m.created_at BETWEEN :start AND :end', { start, end })
			.getRawMany();

		const byCategory = emptyCategoryBucket();
		const byCategoryCost: Record<string, number> = emptyCategoryBucket();
		const byCountryMap = new Map<
			string,
			{ country: string; label: string; count: number; estimatedCostUsd: number }
		>();
		const dailyMap = new Map<
			string,
			{ date: string; sent: number; delivered: number; failed: number; estimatedCostUsd: number }
		>();
		const templateMap = new Map<
			string,
			{
				name: string;
				sent: number;
				delivered: number;
				read: number;
				failed: number;
				estimatedCostUsd: number;
				category: string;
			}
		>();

		let sent = 0;
		let delivered = 0;
		let read = 0;
		let failed = 0;
		let inbound = 0;
		let billableDelivered = 0;
		let estimatedCostUsd = 0;

		const updates: Array<{ id: string; country: string; category: string; cost: number }> = [];

		for (const row of rows) {
			const direction = String(row.direction || '');
			const status = String(row.status || '').toLowerCase();
			const messageType = String(row.messageType || '').toLowerCase();
			const createdAt = row.createdAt ? new Date(row.createdAt) : new Date();
			const dk = dayKey(createdAt);
			if (!dailyMap.has(dk)) {
				dailyMap.set(dk, {
					date: dk,
					sent: 0,
					delivered: 0,
					failed: 0,
					estimatedCostUsd: 0,
				});
			}
			const daily = dailyMap.get(dk)!;

			if (direction === MetaWaMessageDirection.INBOUND) {
				inbound += 1;
				continue;
			}

			sent += 1;
			daily.sent += 1;

			const isDelivered =
				status === MetaWaMessageStatus.DELIVERED || status === MetaWaMessageStatus.READ;
			const isRead = status === MetaWaMessageStatus.READ;
			const isFailed = status === MetaWaMessageStatus.FAILED;

			if (isDelivered) {
				delivered += 1;
				daily.delivered += 1;
			}
			if (isRead) read += 1;
			if (isFailed) {
				failed += 1;
				daily.failed += 1;
			}

			const market = marketFromWaId(row.waId);
			const country = row.recipientCountry || countryCodeFromMarket(market);
			const category = this.resolveCategory(row, messageType) as MetaPricingCategory;
			byCategory[category] = (byCategory[category] || 0) + 1;

			const pricingType = String(row.pricingType || '').toUpperCase();
			const billableFlag =
				typeof row.billable === 'boolean'
					? row.billable
					: pricingType
						? pricingType === 'REGULAR'
						: messageType === 'template' && isDelivered;

			let cost = Number(row.estimatedCostUsd);
			if (!Number.isFinite(cost) || cost < 0) {
				const { rate, label } = rateFor(market, category);
				cost = billableFlag ? rate : 0;
				updates.push({ id: row.id, country, category, cost });
				void label;
			}

			if (billableFlag && isDelivered) {
				billableDelivered += 1;
				estimatedCostUsd += cost;
				byCategoryCost[category] = (byCategoryCost[category] || 0) + cost;
				daily.estimatedCostUsd += cost;

				const countryKey = country;
				const existing = byCountryMap.get(countryKey) || {
					country: countryKey,
					label: rateFor(market, category).label,
					count: 0,
					estimatedCostUsd: 0,
				};
				existing.count += 1;
				existing.estimatedCostUsd += cost;
				byCountryMap.set(countryKey, existing);
			}

			if (row.templateName) {
				const key = String(row.templateName);
				const tpl = templateMap.get(key) || {
					name: key,
					sent: 0,
					delivered: 0,
					read: 0,
					failed: 0,
					estimatedCostUsd: 0,
					category,
				};
				tpl.sent += 1;
				if (isDelivered) tpl.delivered += 1;
				if (isRead) tpl.read += 1;
				if (isFailed) tpl.failed += 1;
				if (billableFlag && isDelivered) tpl.estimatedCostUsd += cost;
				templateMap.set(key, tpl);
			}
		}

		// Persist backfilled estimates (best-effort, capped)
		for (const u of updates.slice(0, 200)) {
			try {
				await this.messageRepo.update(u.id, {
					recipientCountry: u.country,
					pricingCategory: u.category,
					estimatedCostUsd: u.cost,
				});
			} catch {
				/* column may not exist until migration */
			}
		}

		return {
			sent,
			delivered,
			read,
			failed,
			inbound,
			billableDelivered,
			byCategory,
			byCategoryCost: Object.fromEntries(
				Object.entries(byCategoryCost).map(([k, v]) => [k, Number(Number(v).toFixed(4))]),
			),
			byCountry: [...byCountryMap.values()]
				.map(c => ({
					...c,
					estimatedCostUsd: Number(c.estimatedCostUsd.toFixed(4)),
				}))
				.sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd),
			daily: [...dailyMap.values()]
				.sort((a, b) => a.date.localeCompare(b.date))
				.map(d => ({
					...d,
					estimatedCostUsd: Number(d.estimatedCostUsd.toFixed(4)),
				})),
			templates: [...templateMap.values()]
				.map(t => ({
					...t,
					estimatedCostUsd: Number(t.estimatedCostUsd.toFixed(4)),
				}))
				.sort((a, b) => b.sent - a.sent),
			estimatedCostUsd,
		};
	}

	private resolveCategory(row: any, messageType: string): MetaPricingCategory {
		const fromWebhook = String(row.pricingCategory || '').toUpperCase();
		if (
			['MARKETING', 'UTILITY', 'AUTHENTICATION', 'SERVICE'].includes(fromWebhook)
		) {
			return fromWebhook as MetaPricingCategory;
		}
		if (messageType === 'template') return 'UTILITY';
		if (['text', 'image', 'video', 'audio', 'voice', 'document', 'sticker'].includes(messageType)) {
			return 'SERVICE';
		}
		return 'UNKNOWN';
	}

	private async fetchMetaAnalyticsSafe(start: Date, end: Date) {
		const errors: string[] = [];
		let messaging: any = null;
		let pricing: any = null;
		let templates: any = null;
		let pricingCostTotal: number | null = null;

		try {
			const runtime = await this.configService.requireRuntime({ requireEnabled: false });
			const wabaId = await this.configService.ensureWabaId(runtime);
			const startUnix = Math.floor(start.getTime() / 1000);
			const endUnix = Math.floor(end.getTime() / 1000);
			const token = runtime.secrets.accessToken;

			try {
				const res = await this.cloudApi.getMessagingAnalytics(token, wabaId, startUnix, endUnix);
				messaging = res?.analytics || res;
			} catch (e: any) {
				errors.push(`messaging_analytics: ${e?.message || e}`);
			}

			try {
				const res = await this.cloudApi.getPricingAnalytics(token, wabaId, startUnix, endUnix);
				pricing = res?.pricing_analytics || res;
				pricingCostTotal = this.sumPricingCost(pricing);
			} catch (e: any) {
				errors.push(`pricing_analytics: ${e?.message || e}`);
			}

			try {
				const tplList = await this.cloudApi.listMessageTemplates(token, wabaId).catch(() => []);
				const ids = (Array.isArray(tplList) ? tplList : [])
					.map((t: any) => String(t.id || ''))
					.filter(Boolean)
					.slice(0, 10);
				const res = await this.cloudApi.getTemplateAnalytics(
					token,
					wabaId,
					startUnix,
					endUnix,
					ids.length ? ids : undefined,
				);
				templates = this.normalizeTemplateAnalytics(res?.template_analytics || res);
			} catch (e: any) {
				errors.push(`template_analytics: ${e?.message || e}`);
			}
		} catch (e: any) {
			errors.push(`runtime: ${e?.message || e}`);
		}

		return { messaging, pricing, templates, pricingCostTotal, errors };
	}

	private sumPricingCost(pricing: any): number | null {
		const points =
			pricing?.data?.[0]?.data_points ||
			pricing?.data_points ||
			(Array.isArray(pricing?.data) ? pricing.data : null);
		if (!Array.isArray(points)) return null;
		let total = 0;
		let found = false;
		for (const p of points) {
			if (p?.cost != null && Number.isFinite(Number(p.cost))) {
				total += Number(p.cost);
				found = true;
			}
		}
		return found ? Number(total.toFixed(4)) : null;
	}

	private normalizeTemplateAnalytics(raw: any) {
		const points =
			raw?.data?.[0]?.data_points ||
			raw?.data_points ||
			(Array.isArray(raw?.data) ? raw.data : []);
		if (!Array.isArray(points)) return { raw, rows: [] };
		const byName = new Map<string, any>();
		for (const p of points) {
			const name = String(p.template_name || p.name || p.template_id || 'unknown');
			const row = byName.get(name) || {
				name,
				sent: 0,
				delivered: 0,
				read: 0,
				clicked: 0,
				cost: 0,
			};
			row.sent += Number(p.sent || 0);
			row.delivered += Number(p.delivered || 0);
			row.read += Number(p.read || 0);
			row.clicked += Number(p.clicked || p.button_click || 0);
			row.cost += Number(p.cost || 0);
			byName.set(name, row);
		}
		return {
			rows: [...byName.values()].map(r => ({
				...r,
				cost: Number(Number(r.cost).toFixed(4)),
			})),
		};
	}
}
