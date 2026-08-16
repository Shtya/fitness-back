import { atempoChain, ffmpegPitchFilter, resolveFfmpegPreset } from './whatsapp-voice-changer';

describe('ffmpegPitchFilter', () => {
	it('keeps duration with complementary atempo', () => {
		const filter = ffmpegPitchFilter(-6);
		expect(filter).toContain('asetrate=48000*');
		expect(filter).toContain('aresample=48000');
		expect(filter).toContain('atempo=');
	});

	it('chains atempo when the ratio is extreme', () => {
		expect(atempoChain(4)).toEqual(['atempo=2.0', 'atempo=2.00000']);
		expect(atempoChain(0.25)[0]).toBe('atempo=0.5');
	});
});

describe('resolveFfmpegPreset', () => {
	it('uses preset pitch unless custom', () => {
		expect(resolveFfmpegPreset('deeper').pitchSemitones).toBe(-6);
		expect(resolveFfmpegPreset('custom', 3).pitchSemitones).toBe(3);
		expect(resolveFfmpegPreset('custom', 30).pitchSemitones).toBe(12);
	});
});
