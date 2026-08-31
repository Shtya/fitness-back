import {
	dataUrlMime,
	ensureWhatsAppVoiceOgg,
	fallbackVoiceWaveform,
	guessVoiceSeconds,
	looksLikeOutgoingVoiceUpload,
	WHATSAPP_VOICE_MIME,
} from './whatsapp-voice-ogg';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('whatsapp voice ogg helper', () => {
	it('parses duration from the recorded file name', () => {
		expect(guessVoiceSeconds('/tmp/x', 'voice-12s.webm')).toBe(12);
		expect(guessVoiceSeconds('/tmp/abc-voice-5s.webm')).toBe(5);
		expect(guessVoiceSeconds('/tmp/photo.jpg')).toBeUndefined();
	});

	it('builds a 64-sample fallback waveform WhatsApp can render', () => {
		const waveform = fallbackVoiceWaveform(Buffer.from('voice-note-bytes'));
		expect(waveform).toBeInstanceOf(Uint8Array);
		expect(waveform.length).toBe(64);
		expect([...waveform].every((value) => value >= 1 && value <= 100)).toBe(true);
		expect(fallbackVoiceWaveform(Buffer.from('voice-note-bytes'))).toEqual(waveform);
	});

	it('detects outgoing voice uploads by filename or mime', () => {
		expect(looksLikeOutgoingVoiceUpload('voice-8s.webm', 'audio/webm')).toBe(true);
		expect(looksLikeOutgoingVoiceUpload('voice.mp3', 'audio/mpeg')).toBe(true);
		expect(looksLikeOutgoingVoiceUpload('clip.mp3', 'application/octet-stream')).toBe(false);
	});

	// Copy of wa-js `valid-data-url`; a mime it rejects makes sendFileMessage
	// throw `invalid_data_url` instead of sending the note.
	const WA_JS_DATA_URL =
		/^data:([a-z]+\/[a-z0-9-+.]+(;[a-z0-9-.!#$%*+.{}|~`]+=[a-z0-9-.!#$%*+.{}()_|~`]+)*)?(;base64)?,([a-z0-9!$&',()*+;=\-._~:@/?%\s<>]*?)$/i;

	it('strips whitespace so the voice mime is a legal data URL for wa-js', () => {
		const payload = Buffer.from('voice-data').toString('base64');
		expect(WA_JS_DATA_URL.test(`data:${WHATSAPP_VOICE_MIME};base64,${payload}`)).toBe(false);
		expect(
			WA_JS_DATA_URL.test(`data:${dataUrlMime(WHATSAPP_VOICE_MIME)};base64,${payload}`),
		).toBe(true);
		expect(dataUrlMime(WHATSAPP_VOICE_MIME)).toBe('audio/ogg;codecs=opus');
		expect(dataUrlMime(null)).toBe('application/octet-stream');
		expect(dataUrlMime('  ')).toBe('application/octet-stream');
	});

	it('rejects empty voice files', async () => {
		const filePath = path.join(os.tmpdir(), `wa-empty-${Date.now()}.webm`);
		await fs.writeFile(filePath, Buffer.alloc(0));
		await expect(
			ensureWhatsAppVoiceOgg(filePath, { mimeType: 'audio/webm', fileName: 'voice-1s.webm' }),
		).rejects.toThrow(/empty/i);
		await fs.rm(filePath, { force: true });
	});
});