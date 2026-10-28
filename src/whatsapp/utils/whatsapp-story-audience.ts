import type { WhatsAppAccount } from '../entities/whatsapp.entity';
import { statusAudienceJids } from './whatsapp-contact';

/**
 * Who this account's stories reach — the same three choices WhatsApp offers:
 * every contact, every contact except some, or only a chosen few.
 */
export type WhatsAppStoryAudienceMode = 'contacts' | 'except' | 'only';

export interface WhatsAppStoryAudienceSettings {
	mode: WhatsAppStoryAudienceMode;
	/** Phone JIDs (`digits@s.whatsapp.net`): the excluded people, or the only recipients. */
	waIds: string[];
	/** Numbers added by hand: counted as contacts even with no chat or contact row. */
	extraWaIds: string[];
}

export const STORY_AUDIENCE_MAX_IDS = 800;

const MODE_KEY = 'story.audienceMode';
const IDS_KEY = 'story.audienceWaIds';
const EXTRA_KEY = 'story.audienceExtraWaIds';

function storedJids(value: unknown): string[] {
	return statusAudienceJids(Array.isArray(value) ? value : []).slice(0, STORY_AUDIENCE_MAX_IDS);
}

export function isStoryAudienceMode(value: unknown): value is WhatsAppStoryAudienceMode {
	return value === 'contacts' || value === 'except' || value === 'only';
}

export function getWhatsAppStoryAudience(
	account: Pick<WhatsAppAccount, 'providerCapabilities'>,
): WhatsAppStoryAudienceSettings {
	const values = account?.providerCapabilities || {};
	const mode = values[MODE_KEY];
	return {
		mode: isStoryAudienceMode(mode) ? mode : 'contacts',
		waIds: storedJids(values[IDS_KEY]),
		extraWaIds: storedJids(values[EXTRA_KEY]),
	};
}

export function mergeWhatsAppStoryAudience(
	account: Pick<WhatsAppAccount, 'providerCapabilities'>,
	settings: { mode: WhatsAppStoryAudienceMode; waIds?: unknown[]; extraWaIds?: unknown[] },
): Record<string, unknown> {
	const current = account.providerCapabilities || {};
	return {
		...current,
		[MODE_KEY]: settings.mode,
		[IDS_KEY]: storedJids(settings.waIds || []),
		// Left out of the request means "unchanged", so an older client cannot wipe the list.
		[EXTRA_KEY]: storedJids(settings.extraWaIds ?? current[EXTRA_KEY]),
	};
}

/**
 * The recipient list for one publish. `exact` tells the provider not to add the people
 * it happens to hold in memory, which would undo an "only these" choice.
 */
export function resolveStoryAudience(
	candidates: Iterable<unknown>,
	settings: Omit<WhatsAppStoryAudienceSettings, 'extraWaIds'> & { extraWaIds?: string[] },
): { waIds: string[]; excludeWaIds: string[]; exact: boolean } {
	if (settings.mode === 'only') {
		return { waIds: statusAudienceJids(settings.waIds), excludeWaIds: [], exact: true };
	}
	const excluded = settings.mode === 'except' ? statusAudienceJids(settings.waIds) : [];
	const blocked = new Set(excluded);
	return {
		// Hand-added numbers first: they would otherwise fall past the publish cap.
		waIds: statusAudienceJids([...(settings.extraWaIds || []), ...candidates]).filter(
			jid => !blocked.has(jid),
		),
		excludeWaIds: excluded,
		exact: false,
	};
}
