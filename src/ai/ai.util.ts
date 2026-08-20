import { AiModelPricing } from './ai.constants';

export function toNumber(value: string | number | null | undefined, fallback = 0): number {
	const n = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(n) ? n : fallback;
}

export function roundCost(value: number): number {
	if (!Number.isFinite(value) || value <= 0) return 0;
	return Math.round(value * 1e8) / 1e8;
}

export function estimatePromptTokens(prompt: string, system?: string): number {
	const chars = `${system || ''}${prompt || ''}`.length;
	return Math.max(1, Math.ceil(chars / 4));
}

export function estimateUsageCost(params: {
	pricing: AiModelPricing;
	promptTokens?: number;
	completionTokens?: number;
	imageCount?: number;
}): number {
	const pricing = params.pricing || ({} as AiModelPricing);
	const promptTokens = Math.max(0, Number(params.promptTokens || 0));
	const completionTokens = Math.max(0, Number(params.completionTokens || 0));
	const imageCount = Math.max(0, Number(params.imageCount || 0));
	const tokenCost =
		(promptTokens / 1_000_000) * toNumber(pricing.inputPerMillion) +
		(completionTokens / 1_000_000) * toNumber(pricing.outputPerMillion);
	const imageCost = imageCount * toNumber(pricing.imagePerUnit);
	return roundCost(tokenCost + imageCost);
}

export function currentPeriodKey(timeZone = 'Africa/Cairo'): string {
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
	}).formatToParts(new Date());
	const year = parts.find((p) => p.type === 'year')?.value || '1970';
	const month = parts.find((p) => p.type === 'month')?.value || '01';
	return `${year}-${month}`;
}

export function effectiveLimit(limit: number, safetyBufferPercent: number): number {
	const buffer = Math.min(50, Math.max(0, safetyBufferPercent || 0));
	return roundCost(limit * (1 - buffer / 100));
}

export function usagePercent(used: number, limit: number): number {
	if (!limit || limit <= 0) return 0;
	return Math.min(999, Math.round((used / limit) * 1000) / 10);
}

export function warningLevel(percent: number, enabled: boolean): 80 | 90 | 100 | null {
	if (!enabled) return null;
	if (percent >= 100) return 100;
	if (percent >= 90) return 90;
	if (percent >= 80) return 80;
	return null;
}

export function resolveWorkspaceId(user: {
	id?: string;
	tenantId?: string | null;
	adminId?: string | null;
	tokenTenantId?: string | null;
}) {
	return user?.tenantId || user?.tokenTenantId || user?.adminId || user?.id || null;
}
