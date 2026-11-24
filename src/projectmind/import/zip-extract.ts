import * as yauzl from 'yauzl';
import { normalizeArchivePath } from '../analysis/file-filter';
import { RawFile } from '../analysis/analyzer';
import { PM_LIMITS } from '../projectmind.constants';

export class ArchiveError extends Error {
	constructor(
		public readonly code: 'ZIP_INVALID' | 'ZIP_UNSAFE_PATH' | 'ZIP_TOO_LARGE' | 'ZIP_TOO_MANY_ENTRIES' | 'ZIP_BOMB' | 'ZIP_EMPTY',
		message: string,
	) {
		super(message);
	}
}

export interface ExtractOptions {
	maxUncompressedBytes?: number;
	maxEntries?: number;
	maxEntryRatio?: number;
	maxFileBytes?: number;
	/** Strip a single common top-level folder (GitHub archives wrap everything in `repo-branch/`). */
	stripRoot?: boolean;
}

/**
 * Safely reads a ZIP held in memory.
 * Guards: entry count, declared and *actual* uncompressed bytes, per-entry compression ratio,
 * path traversal / absolute paths / drive letters (entries are skipped, never written to disk),
 * symlinks (skipped). Nothing is ever extracted to the filesystem — files stay in memory.
 */
export function extractZip(buffer: Buffer, opts: ExtractOptions = {}): Promise<RawFile[]> {
	const maxTotal = opts.maxUncompressedBytes ?? PM_LIMITS.maxUncompressedBytes;
	const maxEntries = opts.maxEntries ?? PM_LIMITS.maxEntries;
	const maxRatio = opts.maxEntryRatio ?? PM_LIMITS.maxEntryRatio;
	const maxFile = opts.maxFileBytes ?? PM_LIMITS.maxIndexedFileBytes;

	return new Promise((resolve, reject) => {
		yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true, decodeStrings: true }, (err, zip) => {
			if (err || !zip) return reject(new ArchiveError('ZIP_INVALID', 'The file is not a valid ZIP archive.'));
			if (zip.entryCount > maxEntries) {
				zip.close();
				return reject(new ArchiveError('ZIP_TOO_MANY_ENTRIES', `Archive has ${zip.entryCount} entries (limit ${maxEntries}).`));
			}
			const files: RawFile[] = [];
			let declaredTotal = 0;
			let actualTotal = 0;
			let failed = false;
			const fail = (e: ArchiveError | Error) => {
				if (failed) return;
				failed = true;
				try { zip.close(); } catch { /* already closed */ }
				if (e instanceof ArchiveError) return reject(e);
				if (/relative path|absolute path/i.test(String((e as Error)?.message))) {
					return reject(new ArchiveError('ZIP_UNSAFE_PATH', 'The archive contains unsafe file paths (path traversal) and was rejected.'));
				}
				reject(new ArchiveError('ZIP_INVALID', 'The archive is corrupt or unreadable.'));
			};

			zip.on('error', fail);
			zip.on('end', () => {
				if (failed) return;
				if (files.length === 0) return reject(new ArchiveError('ZIP_EMPTY', 'The archive contains no readable files.'));
				resolve(opts.stripRoot === false ? files : stripCommonRoot(files));
			});
			zip.on('entry', (entry: yauzl.Entry) => {
				if (failed) return;
				const name = entry.fileName;
				if (/\/$/.test(name)) return zip.readEntry(); // directory
				const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
				if ((mode & 0xf000) === 0xa000) return zip.readEntry(); // symlink — skip
				if (/^([/\\]|[A-Za-z]:)/.test(name)) return zip.readEntry(); // absolute path — skip
				const safe = normalizeArchivePath(name);
				if (!safe) return zip.readEntry(); // traversal / absolute — skip, never touched

				declaredTotal += entry.uncompressedSize;
				if (declaredTotal > maxTotal) return fail(new ArchiveError('ZIP_TOO_LARGE', 'Archive expands beyond the allowed size.'));
				if (entry.compressedSize > 0 && entry.uncompressedSize / entry.compressedSize > maxRatio && entry.uncompressedSize > 1024 * 1024) {
					return fail(new ArchiveError('ZIP_BOMB', `Entry "${safe}" has a suspicious compression ratio.`));
				}
				// Oversized files are listed (so the UI can say "too large") but their bytes are never read.
				if (entry.uncompressedSize > maxFile) {
					files.push({ path: safe, data: Buffer.alloc(0), declaredSize: entry.uncompressedSize });
					return zip.readEntry();
				}
				zip.openReadStream(entry, (e, stream) => {
					if (e || !stream) return fail(new ArchiveError('ZIP_INVALID', 'Could not read an archive entry.'));
					const parts: Buffer[] = [];
					let size = 0;
					stream.on('data', (c: Buffer) => {
						size += c.length;
						actualTotal += c.length;
						if (size > entry.uncompressedSize + 1024 || actualTotal > maxTotal) {
							stream.destroy();
							return fail(new ArchiveError('ZIP_BOMB', 'Archive entry exceeds its declared size.'));
						}
						parts.push(c);
					});
					stream.on('error', fail);
					stream.on('end', () => {
						if (failed) return;
						files.push({ path: safe, data: Buffer.concat(parts) });
						zip.readEntry();
					});
				});
			});
			zip.readEntry();
		});
	});
}

function stripCommonRoot(files: RawFile[]): RawFile[] {
	const first = files[0].path.split('/')[0];
	if (!files.every((f) => f.path.includes('/') && f.path.split('/')[0] === first)) return files;
	return files.map((f) => ({ ...f, path: f.path.slice(first.length + 1) })).filter((f) => f.path);
}
