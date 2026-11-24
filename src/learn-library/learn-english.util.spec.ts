import { normalizeEnglish, parseJsonObject, questionsPrompt, readCorrection, readQuestions, readWord } from './learn-english.util';

describe('learn english util', () => {
	it('cleans a day: drops junk, duplicate ids, empty words, unknown keys', () => {
		const day = normalizeEnglish({
			videoUrl: ' https://youtu.be/abc ',
			transcript: 'Hello there',
			words: [
				{ id: 'w1', text: ' introduce ', meaning: 'present', translation: 'يقدّم', example: 'Let me introduce myself.', createdAt: 5 },
				{ id: 'w1', text: 'dup' },
				{ id: 'w2', text: '   ' },
				{ id: 'bad id!', text: 'x' },
				'nope',
			],
			questions: [{ id: 'q1', q: 'Where are you from?', a: '', source: 'ai' }, { id: 'q2', q: 'x', source: 'weird' }],
			speaking: [{ id: 's1', at: 10, seconds: 99999, prompt: 'p', text: 'I go home', fixes: [{ wrong: 'go', right: 'went', why: 'past', done: 1 }, 'x'] }],
			hacked: true,
		});
		expect(day.videoUrl).toBe('https://youtu.be/abc');
		expect(day.words.map(w => w.text)).toEqual(['introduce']);
		expect(day.questions.map(q => q.source)).toEqual(['ai', 'own']);
		expect(day.speaking[0].seconds).toBe(3600);
		expect(day.speaking[0].text).toBe('I go home');
		expect(day.speaking[0].fixes).toEqual([{ id: 'f0', wrong: 'go', right: 'went', why: 'past', done: true }]);
		expect((day as any).hacked).toBeUndefined();
		expect(normalizeEnglish(null)).toEqual({ videoUrl: '', transcript: '', words: [], questions: [], speaking: [] });
	});

	it('reads AI replies', () => {
		expect(readQuestions(parseJsonObject('```json\n{"questions":["What do you do?"," ",3]}\n```'))).toEqual(['What do you do?']);
		expect(readWord(parseJsonObject('Sure! {"meaning":"to present someone","translation":"يقدّم","examples":["I introduced my friend.","Let me introduce myself."]}'))).toEqual({
			meaning: 'to present someone',
			translation: 'يقدّم',
			example: 'I introduced my friend.',
			examples: ['I introduced my friend.', 'Let me introduce myself.'],
		});
		expect(readCorrection(parseJsonObject('{"corrected":"I went home.","fixes":[{"wrong":"I go home yesterday","right":"I went home yesterday","why":"past tense"},{"wrong":"same","right":"same"}]}'))).toEqual({
			corrected: 'I went home.',
			fixes: [{ wrong: 'I go home yesterday', right: 'I went home yesterday', why: 'past tense' }],
		});
		expect(readWord(parseJsonObject('no json'))).toBeNull();
	});

	it('builds the questions prompt with topic, words and limits', () => {
		const p = questionsPrompt({ topic: 'Introduce yourself', words: ['hometown', 'hobby'], count: 50 });
		expect(p).toContain('Introduce yourself');
		expect(p).toContain('hometown, hobby');
		expect(p).toContain('Write 10 open questions');
	});
});
