import { ensureWhatsAppVoiceOgg, guessVoiceSeconds } from './whatsapp-voice-ogg';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('whatsapp voice ogg helper', () => {
	it('parses duration from the recorded file name', () => {
		expect(guessVoiceSeconds('/tmp/x', 'voice-12s.webm')).toBe(12);
		expect(guessVoiceSeconds('/tmp/abc-voice-5s.webm')).toBe(5);
		expect(guessVoiceSeconds('/tmp/photo.jpg')).toBeUndefined();
	});

	it('leaves an already-OGG recording untouched', async () => {
		const filePath = path.join(os.tmpdir(), `wa-ogg-${Date.now()}.ogg`);
		const ogg = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(80, 1)]);
		await fs.writeFile(filePath, ogg);
		try {
			const result = await ensureWhatsAppVoiceOgg(filePath, {
				mimeType: 'audio/ogg; codecs=opus',
				fileName: 'voice-3s.ogg',
			});
			expect(result.filePath).toBe(filePath);
			expect(result.cleanup).toBeUndefined();
			expect(result.mimeType).toContain('ogg');
		} finally {
			await fs.rm(filePath, { force: true });
		}
	});
});
