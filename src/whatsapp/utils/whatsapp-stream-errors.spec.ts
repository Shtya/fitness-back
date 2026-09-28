import { Logger } from '@nestjs/common';
import { PassThrough, Readable, Writable } from 'stream';
import { isClientAbortError, pipeFileToResponse, quietStreamableFile } from './whatsapp-stream-errors';

describe('media stream error handling (audit B5)', () => {
	let warn: jest.SpyInstance;
	beforeEach(() => {
		warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
	});
	afterEach(() => warn.mockRestore());

	it('classifies client aborts', () => {
		expect(isClientAbortError(Object.assign(new Error('Premature close'), { code: 'ERR_STREAM_PREMATURE_CLOSE' }))).toBe(true);
		expect(isClientAbortError(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }))).toBe(true);
		expect(isClientAbortError(new Error('Premature close'))).toBe(true);
		expect(isClientAbortError(Object.assign(new Error('missing'), { code: 'ENOENT' }))).toBe(false);
		expect(isClientAbortError(null)).toBe(false);
	});

	it('StreamableFile logger stays quiet on aborts and warns on real failures', () => {
		const file = quietStreamableFile(Readable.from(['x']));
		file.errorLogger(Object.assign(new Error('Premature close'), { code: 'ERR_STREAM_PREMATURE_CLOSE' }));
		expect(warn).not.toHaveBeenCalled();
		file.errorLogger(Object.assign(new Error('EIO: i/o error'), { code: 'EIO' }));
		expect(warn).toHaveBeenCalledTimes(1);
	});

	it('pipeFileToResponse handles a read error without an unhandled error event', async () => {
		const source = new PassThrough();
		const chunks: Buffer[] = [];
		const res = new Writable({ write(chunk, _enc, cb) { chunks.push(chunk); cb(); } }) as any;
		pipeFileToResponse(source, res);
		source.write('partial');
		source.destroy(Object.assign(new Error('ENOENT: gone'), { code: 'ENOENT' }));
		await new Promise(resolve => setImmediate(resolve));
		expect(warn).toHaveBeenCalledTimes(1);
		expect(res.destroyed).toBe(true);
	});

	it('pipeFileToResponse streams the whole file on success', async () => {
		const chunks: string[] = [];
		const res = new Writable({ write(chunk, _enc, cb) { chunks.push(String(chunk)); cb(); } }) as any;
		const done = new Promise(resolve => res.on('finish', resolve));
		pipeFileToResponse(Readable.from(['a', 'b', 'c']), res);
		await done;
		expect(chunks.join('')).toBe('abc');
		expect(warn).not.toHaveBeenCalled();
	});
});
