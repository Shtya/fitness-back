import { atempoChain, ffmpegPitchFilter, resolveFfmpegPreset, resolveGroqSpeech } from './whatsapp-voice-changer';

describe('resolveGroqSpeech', () => {
	it('keeps Arabic text on an Arabic Orpheus voice and model', () => {
		expect(resolveGroqSpeech('troy', 'مرحبا أحمد')).toEqual({
			model: 'canopylabs/orpheus-arabic-saudi',
			voice: 'abdullah',
			responseFormat: 'wav',
		});
		expect(resolveGroqSpeech('aisha', 'أهلا')).toEqual({
			model: 'canopylabs/orpheus-arabic-saudi',
			voice: 'aisha',
			responseFormat: 'wav',
		});
		expect(resolveGroqSpeech('Amira-PlayAI', 'أهلا')).toEqual({
			model: 'canopylabs/orpheus-arabic-saudi',
			voice: 'aisha',
			responseFormat: 'wav',
		});
	});

	it('keeps English text on an English Orpheus voice and model', () => {
		expect(resolveGroqSpeech('abdullah', 'hello there')).toEqual({
			model: 'canopylabs/orpheus-v1-english',
			voice: 'troy',
			responseFormat: 'wav',
		});
		expect(resolveGroqSpeech('hannah', 'hello there')).toEqual({
			model: 'canopylabs/orpheus-v1-english',
			voice: 'hannah',
			responseFormat: 'wav',
		});
		expect(resolveGroqSpeech('Fritz-PlayAI', 'hello there')).toEqual({
			model: 'canopylabs/orpheus-v1-english',
			voice: 'troy',
			responseFormat: 'wav',
		});
	});
});

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
