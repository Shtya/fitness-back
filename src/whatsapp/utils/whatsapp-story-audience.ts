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
}

export const STORY_AUDIENCE_MAX_IDS = 800;

const MODE_KEY = 'story.audienceMode';
const IDS_KEY = 'story.audienceWaIds';

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
		waIds: statusAudienceJids(Array.isArray(values[IDS_KEY]) ? values[IDS_KEY] : []).slice(
			0,
			STORY_AUDIENCE_MAX_IDS,
		),
	};
}

export function mergeWhatsAppStoryAudience(
	account: Pick<WhatsAppAccount, 'providerCapabilities'>,
	settings: { mode: WhatsAppStoryAudienceMode; waIds?: unknown[] },
): Record<string, unknown> {
	return {
		...(account.providerCapabilities || {}),
		[MODE_KEY]: settings.mode,
		[IDS_KEY]: statusAudienceJids(settings.waIds || []).slice(0, STORY_AUDIENCE_MAX_IDS),
	};
}

/**
 * The recipient list for one publish. `exact` tells the provider not to add the people
 * it happens to hold in memory, which would undo an "only these" choice.
 */
export function resolveStoryAudience(
	candidates: Iterable<unknown>,
	settings: WhatsAppStoryAudienceSettings,
): { waIds: string[]; excludeWaIds: string[]; exact: boolean } {
	if (settings.mode === 'only') {
		return { waIds: statusAudienceJids(settings.waIds), excludeWaIds: [], exact: true };
	}
	const excluded = settings.mode === 'except' ? statusAudienceJids(settings.waIds) : [];
	const blocked = new Set(excluded);
	return {
		waIds: statusAudienceJids(candidates).filter(jid => !blocked.has(jid)),
		excludeWaIds: excluded,
		exact: false,
	};
}
