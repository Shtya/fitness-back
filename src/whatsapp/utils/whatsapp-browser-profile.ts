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

async function profileDirExists(userDataDir: string) {
	try {
		const stats = await fs.stat(userDataDir);
		return stats.isDirectory();
	} catch {
		return false;
	}
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

	if (process.platform === 'win32') {
		// Windows has no SingletonLock symlink and no pkill, so the profile stays
		// locked and every later rm/rmdir fails silently. Match on the command line.
		try {
			await execFileAsync('powershell', [
				'-NoProfile',
				'-NonInteractive',
				'-Command',
				`Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='chromium.exe' OR Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*${userDataDir.replace(/'/g, "''")}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
			]);
		} catch {
			/* nothing matched or PowerShell unavailable */
		}
		return;
	}

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
	// Baileys deployments never create this profile, and the win32 branch below
	// costs a full Win32_Process CIM scan. Skipping keeps reconnect/relink fast.
	if (!(await profileDirExists(userDataDir))) return;
	await tryKillChromeForProfile(userDataDir);
	await sleep(400);
	await clearChromiumProfileLocks(userDataDir);
	await sleep(200);
}

/**
 * Delete the whole Chromium profile, dropping the WhatsApp linked-device keys with
 * it. Only for a session WhatsApp already invalidated — a stale profile otherwise
 * keeps failing authentication and loops the QR forever.
 */
export async function purgeWppBrowserProfile(accountId: string) {
	const userDataDir = resolveWppUserDataDir(accountId);
	if (!(await profileDirExists(userDataDir))) return;
	await tryKillChromeForProfile(userDataDir);

	// Chromium releases its file handles a moment after exiting, and a half-deleted
	// profile still authenticates with the same dead keys — so verify it is gone.
	let lastError: unknown;
	for (let attempt = 0; attempt < 4; attempt += 1) {
		await sleep(500 * (attempt + 1));
		try {
			await fs.rm(userDataDir, { recursive: true, force: true, maxRetries: 3 });
		} catch (error) {
			lastError = error;
		}
		try {
			await fs.stat(userDataDir);
		} catch {
			return;
		}
	}
	throw new Error(
		`Chromium profile ${userDataDir} could not be deleted${
			lastError instanceof Error ? `: ${lastError.message}` : ''
		}`,
	);
}
