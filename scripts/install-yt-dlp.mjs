#!/usr/bin/env node
/**
 * Provisions the yt-dlp binary used to download social-media videos.
 *
 * Why this exists instead of the `youtube-dl-exec` package: that package resolves the
 * latest release through `api.github.com`, which is blocked on some networks (and it
 * refuses to install without Python, a leftover from the original youtube-dl even
 * though the yt-dlp binary is self-contained). The `releases/latest/download/...` URL
 * used here is a plain redirect to the release CDN and needs neither.
 *
 * Deliberately never fails the install: a missing binary degrades to one clear error
 * message in the UI, whereas a failing `postinstall` blocks the whole project.
 */
import { createWriteStream } from 'fs';
import { chmod, mkdir, rm, stat } from 'fs/promises';
import { spawnSync } from 'child_process';
import { pipeline } from 'stream/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const toolsDir = path.join(here, '..', 'tools');

const ASSET_BY_PLATFORM = {
	win32: 'yt-dlp.exe',
	darwin: 'yt-dlp_macos',
	linux: 'yt-dlp',
};

const asset = ASSET_BY_PLATFORM[process.platform];
const targetName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
const targetPath = path.join(toolsDir, targetName);
const downloadUrl = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`;

function warn(message) {
	console.warn(`[yt-dlp] ${message}`);
	console.warn(
		'[yt-dlp] Social video download stays disabled until a binary is available. ' +
			'Install yt-dlp manually and point YTDLP_PATH at it, or re-run: npm run yt-dlp:install',
	);
}

/** A binary that reports a version is a binary we can trust. */
function reportsVersion(binaryPath) {
	const result = spawnSync(binaryPath, ['--version'], { windowsHide: true, timeout: 30_000 });
	return result.status === 0 ? String(result.stdout || '').trim() : '';
}

async function main() {
	if (!asset) {
		warn(`No prebuilt yt-dlp for platform "${process.platform}".`);
		return;
	}

	const existing = await stat(targetPath).catch(() => null);
	if (existing?.isFile()) {
		const version = reportsVersion(targetPath);
		if (version) {
			console.log(`[yt-dlp] Already installed (${version}) at ${targetPath}`);
			return;
		}
		// Present but unusable, most likely a truncated earlier download.
		await rm(targetPath, { force: true }).catch(() => undefined);
	}

	console.log(`[yt-dlp] Downloading ${asset}…`);
	const partialPath = `${targetPath}.part`;
	try {
		await mkdir(toolsDir, { recursive: true });
		const response = await fetch(downloadUrl, { redirect: 'follow' });
		if (!response.ok || !response.body) {
			throw new Error(`HTTP ${response.status} from ${downloadUrl}`);
		}
		// Streamed to a temp name so an interrupted download never leaves a file that
		// looks installed.
		await pipeline(response.body, createWriteStream(partialPath));
		const { size } = await stat(partialPath);
		if (size < 1_000_000) throw new Error(`Download too small (${size} bytes)`);

		const { rename } = await import('fs/promises');
		await rename(partialPath, targetPath);
		if (process.platform !== 'win32') await chmod(targetPath, 0o755);

		const version = reportsVersion(targetPath);
		if (!version) throw new Error('Downloaded binary did not report a version');
		console.log(`[yt-dlp] Installed ${version} at ${targetPath}`);
	} catch (error) {
		await rm(partialPath, { force: true }).catch(() => undefined);
		warn(`Could not download yt-dlp: ${error?.message || error}`);
	}
}

await main();
