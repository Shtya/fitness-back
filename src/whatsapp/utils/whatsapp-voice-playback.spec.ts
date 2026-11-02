import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ensureWhatsAppVoiceOgg, runFfmpeg } from './whatsapp-voice-ogg';
import {
	NoAudioTrackError,
	audioTrackFileName,
	ensureAudioTrackM4a,
	ensureVoicePlaybackM4a,
	isVideoAttachment,
	needsM4aForPlayback,
	playbackFileName,
} from './whatsapp-voice-playback';

function sineWav(seconds = 1, sampleRate = 16_000): Buffer {
	const samples = sampleRate * seconds;
	const dataSize = samples * 2;
	const wav = Buffer.alloc(44 + dataSize);
	wav.write('RIFF', 0);
	wav.writeUInt32LE(36 + dataSize, 4);
	wav.write('WAVE', 8);
	wav.write('fmt ', 12);
	wav.writeUInt32LE(16, 16);
	wav.writeUInt16LE(1, 20);
	wav.writeUInt16LE(1, 22);
	wav.writeUInt32LE(sampleRate, 24);
	wav.writeUInt32LE(sampleRate * 2, 28);
	wav.writeUInt16LE(2, 32);
	wav.writeUInt16LE(16, 34);
	wav.write('data', 36);
	wav.writeUInt32LE(dataSize, 40);
	for (let i = 0; i < samples; i += 1) {
		wav.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 8000), 44 + i * 2);
	}
	return wav;
}

describe('whatsapp voice playback (m4a for iOS Safari)', () => {
	let dir: string;

	beforeEach(async () => {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wa-voice-play-'));
	});

	afterEach(async () => {
		await fs.rm(dir, { recursive: true, force: true });
	});

	it('converts Ogg/Opus and WebM by MIME, leaves MP3/AAC alone', async () => {
		const filePath = path.join(dir, 'x.bin');
		await fs.writeFile(filePath, Buffer.from('not-audio'));
		await expect(needsM4aForPlayback(filePath, 'audio/ogg; codecs=opus')).resolves.toBe(true);
		await expect(needsM4aForPlayback(filePath, 'audio/webm')).resolves.toBe(true);
		await expect(needsM4aForPlayback(filePath, 'audio/mpeg')).resolves.toBe(false);
		await expect(needsM4aForPlayback(filePath, 'audio/mp4')).resolves.toBe(false);
	});

	it('sniffs the header when the stored MIME is generic', async () => {
		const oggPath = path.join(dir, 'voice.bin');
		await fs.writeFile(oggPath, Buffer.concat([Buffer.from('OggS'), Buffer.alloc(16)]));
		await expect(needsM4aForPlayback(oggPath, 'application/octet-stream')).resolves.toBe(true);
		await expect(needsM4aForPlayback(oggPath, null)).resolves.toBe(true);

		const otherPath = path.join(dir, 'other.bin');
		await fs.writeFile(otherPath, Buffer.from('ID3-and-more-bytes'));
		await expect(needsM4aForPlayback(otherPath, 'application/octet-stream')).resolves.toBe(false);
	});

	it('names the playback copy .m4a', () => {
		expect(playbackFileName('voice-12s.ogg')).toBe('voice-12s.m4a');
		expect(playbackFileName(null)).toBe('voice.m4a');
	});

	it('builds an MP4/AAC copy once and reuses it', async () => {
		const wavPath = path.join(dir, 'voice-1s.wav');
		await fs.writeFile(wavPath, sineWav());
		const ogg = await ensureWhatsAppVoiceOgg(wavPath, { mimeType: 'audio/wav', fileName: 'voice-1s.wav' });
		const oggPath = path.join(dir, 'voice-1s.ogg');
		await fs.copyFile(ogg.filePath, oggPath);
		await ogg.cleanup?.();

		const [first, concurrent] = await Promise.all([
			ensureVoicePlaybackM4a(oggPath),
			ensureVoicePlaybackM4a(oggPath),
		]);
		expect(first).toBe(`${oggPath}.play.m4a`);
		expect(concurrent).toBe(first);

		const head = await fs.readFile(first);
		expect(head.subarray(4, 8).toString('ascii')).toBe('ftyp');

		const before = (await fs.stat(first)).mtimeMs;
		await expect(ensureVoicePlaybackM4a(oggPath)).resolves.toBe(first);
		expect((await fs.stat(first)).mtimeMs).toBe(before);
	}, 30_000);

	it('recognises videos by MIME or extension', () => {
		expect(isVideoAttachment('clip.bin', 'video/mp4')).toBe(true);
		expect(isVideoAttachment('VID-2024.MOV', 'application/octet-stream')).toBe(true);
		expect(isVideoAttachment('voice.ogg', 'audio/ogg')).toBe(false);
		expect(audioTrackFileName('VID-2024.mp4')).toBe('VID-2024.m4a');
	});

	it('pulls the audio track out of a video as a small MP4/AAC file', async () => {
		const wavPath = path.join(dir, 'tone.wav');
		await fs.writeFile(wavPath, sineWav(3));
		const videoPath = path.join(dir, 'clip.mp4');
		await runFfmpeg(
			['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:d=3', '-i', wavPath, '-shortest', '-c:v', 'libx264', '-c:a', 'aac', videoPath],
			30_000,
		);
		const audioPath = await ensureAudioTrackM4a(videoPath);
		expect(audioPath).toBe(`${videoPath}.audio.m4a`);
		const head = await fs.readFile(audioPath);
		expect(head.subarray(4, 8).toString('ascii')).toBe('ftyp');
		expect(head.length).toBeLessThan((await fs.stat(videoPath)).size);
	}, 60_000);

	it('says so when a video has no sound', async () => {
		const videoPath = path.join(dir, 'silent.mp4');
		await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'color=c=red:s=320x240:d=2', '-c:v', 'libx264', videoPath], 30_000);
		await expect(ensureAudioTrackM4a(videoPath)).rejects.toBeInstanceOf(NoAudioTrackError);
	}, 60_000);
});
