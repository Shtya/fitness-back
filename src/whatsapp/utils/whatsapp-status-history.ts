import { inflateSync } from 'zlib';

/**
 * Stories inside a history sync.
 *
 * When a device is linked, the phone sends the stories that are live right now as an
 * INITIAL_STATUS_V3 history sync, in its `statusV3Messages` list. Baileys (7.0.0-rc14) reads
 * conversations from history syncs but never reads `statusV3Messages`, and has no case at all
 * for this sync type, so those stories were thrown away and only stories posted after linking
 * ever showed up. These helpers read them ourselves.
 */

type HistoryNotification = {
	syncType?: number | null;
	fileSha256?: Uint8Array | null;
	directPath?: string | null;
	chunkOrder?: number | null;
	initialHistBootstrapInlinePayload?: Uint8Array | null;
};

/** Stable id for one history notification, so the same one is not read twice. */
export function historyNotificationKey(note: HistoryNotification | null | undefined) {
	if (!note) return '';
	if (note.fileSha256?.length) return `sha:${Buffer.from(note.fileSha256).toString('base64')}`;
	if (note.directPath) return `path:${note.directPath}`;
	if (note.initialHistBootstrapInlinePayload?.length) {
		return `inline:${note.syncType ?? ''}:${note.chunkOrder ?? ''}:${note.initialHistBootstrapInlinePayload.length}`;
	}
	return '';
}

/**
 * The story messages (WebMessageInfo) in a decoded HistorySync: its `statusV3Messages`, plus
 * any `status@broadcast` conversation in it (each conversation message wraps the real one).
 */
export function statusMessagesOfHistory(
	sync: { statusV3Messages?: any[] | null; conversations?: any[] | null } | null | undefined,
	isStatusJid: (jid: string) => boolean,
) {
	const out: any[] = [];
	const seen = new Set<string>();
	const add = (raw: any) => {
		const id = String(raw?.key?.id || '');
		if (!raw?.key || !isStatusJid(String(raw.key.remoteJid || ''))) return;
		const dedupe = `${id}|${raw.key.participant || ''}`;
		if (id && seen.has(dedupe)) return;
		if (id) seen.add(dedupe);
		out.push(raw);
	};
	for (const raw of sync?.statusV3Messages || []) add(raw);
	for (const conversation of sync?.conversations || []) {
		if (!isStatusJid(String(conversation?.id || ''))) continue;
		for (const item of conversation?.messages || []) add(item?.message);
	}
	return out;
}

/** Decode a history notification: inline payload when the phone put one in, else download it. */
export async function readHistorySync(
	note: HistoryNotification,
	deps: { proto: any; downloadHistory: (note: any, options: any) => Promise<any> },
) {
	if (note.initialHistBootstrapInlinePayload?.length) {
		return deps.proto.HistorySync.decode(inflateSync(Buffer.from(note.initialHistBootstrapInlinePayload)));
	}
	return deps.downloadHistory(note, {});
}
