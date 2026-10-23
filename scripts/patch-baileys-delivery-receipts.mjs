#!/usr/bin/env node
/**
 * Lets the app hold back the "delivered" receipt (second grey tick) for incoming messages.
 *
 * Baileys sends that receipt itself the moment a message reaches this linked device, so the
 * sender sees two ticks even when the phone and the web app are offline. This adds an optional
 * `shouldSendDeliveryReceipt(msg)` socket option: when it resolves to false, the message is only
 * acknowledged to the server (so it is not re-delivered) and the app sends the receipt later.
 *
 * Idempotent, and never fails the install: if the Baileys code changed, the option is simply
 * ignored and receipts behave as before (the provider logs a warning at startup).
 */
import { readFile, writeFile } from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';

export const MARKER = '/* sofa:delivery-receipt-gate */';

const ANCHOR = `                        acked = true;
                        await sendReceipt(msg.key.remoteJid, participant, [msg.key.id], type);`;

const REPLACEMENT = `                        acked = true;
                        ${MARKER}
                        const holdDelivery = (type === undefined || type === 'inactive') &&
                            typeof config.shouldSendDeliveryReceipt === 'function' &&
                            !(await Promise.resolve()
                                .then(() => config.shouldSendDeliveryReceipt(msg))
                                .catch(() => true));
                        if (holdDelivery) {
                            await sendMessageAck(node);
                        }
                        else {
                            await sendReceipt(msg.key.remoteJid, participant, [msg.key.id], type);
                        }`;

export function patchSource(source) {
	if (source.includes(MARKER)) return { source, status: 'already' };
	const normalized = source.replace(/\r\n/g, '\n');
	if (!normalized.includes(ANCHOR)) return { source, status: 'anchor-missing' };
	return { source: normalized.replace(ANCHOR, REPLACEMENT), status: 'patched' };
}

async function main() {
	const here = path.dirname(fileURLToPath(import.meta.url));
	const file = path.join(here, '..', 'node_modules', '@whiskeysockets', 'baileys', 'lib', 'Socket', 'messages-recv.js');
	let source;
	try {
		source = await readFile(file, 'utf8');
	} catch {
		console.warn('[patch-baileys] messages-recv.js not found; skipped');
		return;
	}
	const result = patchSource(source);
	if (result.status === 'patched') {
		await writeFile(file, result.source, 'utf8');
		console.log('[patch-baileys] delivery-receipt gate added');
	} else if (result.status === 'already') {
		console.log('[patch-baileys] delivery-receipt gate already present');
	} else {
		console.warn('[patch-baileys] Baileys code changed; delivery receipts are not held (feature off)');
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch(error => console.warn(`[patch-baileys] skipped: ${error?.message || error}`));
}
