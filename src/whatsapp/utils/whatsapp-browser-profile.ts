import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

function sleep(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

/** Chromium profile dir used by wppconnect (`./tokens/<session>` by default). */
export function resolveWppUserDataDir(accountId: string) {
	const folder =
		process.env.WHATSAPP_TOKEN_FOLDER ||
		process.env.WPPCONNECT_TOKEN_FOLDER ||
		'./tokens';
	const safe = String(accountId || '').replace(/[^a-zA-Z0-9._-]/g, '_');
	return path.resolve(process.cwd(), folder, safe);
}

export function isBrowserAlreadyRunningError(error: unknown) {
	const message = error instanceof Error ? error.message : String(error || '');
	return /browser is already running|Failed to create a ProcessSingleton|SingletonLock/i.test(
		message,
	);
}

export async function clearChromiumProfileLocks(userDataDir: string) {
	const names = [
		'SingletonLock',
		'SingletonCookie',
		'SingletonSocket',
		'lockfile',
		'DevToolsActivePort',
	];
	await Promise.all(
		names.map(name =>
			fs.rm(path.join(userDataDir, name), { force: true }).catch(() => undefined),
		),
	);
}

async function tryKillChromeForProfile(userDataDir: string) {
	try {
		const lockPath = path.join(userDataDir, 'SingletonLock');
		let target = '';
		try {
			target = await fs.readlink(lockPath);
		} catch {
			target = await fs.readFile(lockPath, 'utf8').catch(() => '');
		}
		const match = String(target || '').match(/(\d+)\s*$/);
		if (match) {
			try {
				process.kill(Number(match[1]), 'SIGTERM');
			} catch {
				/* process already gone */
			}
		}
	} catch {
		/* no lock / not a symlink */
	}

	if (process.platform === 'win32') return;

	try {
		await execFileAsync('pkill', ['-f', `user-data-dir=${userDataDir}`]);
	} catch {
		/* pkill exits 1 when nothing matched */
	}
}

/**
 * Stop a zombie Chromium holding the wppconnect profile and clear singleton locks
 * so the next `wppconnect.create()` can start cleanly. Does not delete session tokens.
 */
export async function forceReleaseWppBrowserProfile(accountId: string) {
	const userDataDir = resolveWppUserDataDir(accountId);
	await tryKillChromeForProfile(userDataDir);
	await sleep(400);
	await clearChromiumProfileLocks(userDataDir);
	await sleep(200);
}
