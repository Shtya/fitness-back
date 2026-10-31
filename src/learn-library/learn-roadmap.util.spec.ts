import { readFileSync } from 'fs';
import { join } from 'path';
import { BadRequestException } from '@nestjs/common';
import { mergeTopicsIndex, normalizeRoadmap, parseRoadmapJson, parseTopicsIndexJson, roadmapTopicKeys, safeUrl, topicKey } from './learn-roadmap.util';

const PRESET = join(__dirname, '../../../frontend/src/app/[locale]/dashboard/whatsapp/learn/roadmaps/presets/cybersecurity-ethical-hacking.json');

describe('learn roadmap JSON', () => {
	it('accepts the Cybersecurity roadmap as provided', () => {
		const data = parseRoadmapJson(readFileSync(PRESET, 'utf8'));
		expect(data.title).toBe('Cybersecurity & Ethical Hacking Roadmap');
		expect(data.language).toBe('ar');
		expect(data.levels).toHaveLength(7);
		expect(data.levels.reduce((n, l) => n + l.courses.length, 0)).toBe(22);
		expect(data.levels[0].courses[0]).toMatchObject({ id: 'course_01', title_ar: 'أساسيات الشبكات CCNA', level: 'beginner' });
		expect(data.levels[0].courses[0].url).toMatch(/^https:\/\/www\.youtube\.com\/results\?search_query=/);
		expect(data.learning_policy.authorized_testing_only).toBe(true);
		expect(data.recommended_study_schedule?.study_distribution).toHaveLength(4);
		expect(data.recommended_timeline).toHaveLength(9);
		expect(data.certifications.map(c => c.name)).toContain('OSCP+');
		expect(data.recommended_labs).toHaveLength(6);
		expect(data.lab_environment?.software.map(s => s.name)).toContain('Kali Linux');
		const keys = roadmapTopicKeys(data);
		expect(keys).toContain(topicKey('course_01', 'OSI Model'));
		expect(new Set(keys).size).toBe(keys.length);
	});

	it('also accepts the roadmap object without the "roadmap" wrapper', () => {
		const data = normalizeRoadmap({ title: 'X', levels: [{ title: 'L', courses: [{ title: 'C', topics: ['a'] }] }] });
		expect(data.levels[0].id).toBe('level_1');
		expect(data.levels[0].courses[0].id).toBe('level_1_course_1');
	});

	it('gives duplicate course ids unique keys and drops duplicate / empty topics', () => {
		const data = normalizeRoadmap({
			roadmap: {
				title: 'Dupes',
				levels: [{ title: 'L', courses: [{ id: 'c', title: 'A', topics: ['x', 'X', '', '  y '] }, { id: 'c', title: 'B', topics: ['x'] }] }],
			},
		});
		expect(data.levels[0].courses.map(c => c.id)).toEqual(['c', 'c_2']);
		expect(data.levels[0].courses[0].topics).toEqual(['x', 'y']);
	});

	it('keeps only http(s) links', () => {
		expect(safeUrl('javascript:alert(1)')).toBeNull();
		expect(safeUrl('https://tryhackme.com/')).toBe('https://tryhackme.com/');
		expect(safeUrl('not a url')).toBeNull();
	});

	describe('topics index', () => {
		const INDEX = join(__dirname, '../../../frontend/src/app/[locale]/dashboard/whatsapp/learn/roadmaps/presets/cybersecurity-topics-index.json');
		const base = () => parseRoadmapJson(readFileSync(PRESET, 'utf8'));
		const indexText = readFileSync(INDEX, 'utf8');

		it('adds an explanation to every topic, keeps existing topic keys, and inserts the added courses in place', () => {
			const before = base();
			const merged = mergeTopicsIndex(before, parseTopicsIndexJson(indexText));
			expect(merged.topics_index_note).toMatch(/فهرس تفصيلي/);
			// every topic that existed keeps its key, so progress survives
			for (const key of roadmapTopicKeys(before)) expect(roadmapTopicKeys(merged)).toContain(key);
			const level1 = merged.levels[0].courses.map(c => c.id);
			expect(level1).toEqual(['course_01', 'course_02', 'course_03', 'course_04', 'course_05', 'course_05b']);
			expect(merged.levels[1].courses.map(c => c.id)).toEqual(['course_06', 'course_07', 'course_07b']);
			expect(merged.levels[2].courses.map(c => c.id)).toEqual(['course_08', 'course_09', 'course_09b', 'course_10', 'course_10b', 'course_11', 'course_11b']);
			expect(merged.levels[4].courses.map(c => c.id)).toContain('course_16b');
			const git = merged.levels[0].courses[5];
			expect(git).toMatchObject({ title_ar: 'أساسيات Git وGitHub', added_by_index: true });
			expect(git.topics).toHaveLength(6);
			const ccna = merged.levels[0].courses[0];
			expect(ccna.added_by_index).toBe(false);
			expect(ccna.topic_benefits['OSI Model']).toMatch(/السبع طبقات/);
			// every topic in the roadmap now has an explanation
			const missing = merged.levels.flatMap(l => l.courses.flatMap(c => c.topics.filter(t => !c.topic_benefits[t])));
			expect(missing).toEqual([]);
			const law = merged.levels[1].courses[2];
			expect(law.topics[0]).toBe('قانون مكافحة جرائم تقنية المعلومات (مصر)');
		});

		it('survives a round trip through its own output (edit JSON) and a second import', () => {
			const merged = mergeTopicsIndex(base(), parseTopicsIndexJson(indexText));
			const again = parseRoadmapJson(JSON.stringify({ roadmap: merged }));
			expect(again).toEqual(merged);
			expect(mergeTopicsIndex(again, parseTopicsIndexJson(indexText))).toEqual(merged);
		});

		it('takes a file with both the roadmap and its index in one go, and refuses an index on its own as a roadmap', () => {
			const both = JSON.stringify({ ...JSON.parse(readFileSync(PRESET, 'utf8')), ...JSON.parse(indexText) });
			const merged = parseRoadmapJson(both);
			expect(merged.levels[0].courses.some(c => c.id === 'course_05b')).toBe(true);
			expect(() => parseRoadmapJson(indexText)).toThrow(/Import topics index/);
			expect(() => parseTopicsIndexJson(readFileSync(PRESET, 'utf8'))).toThrow(/roadmap_topics_index/);
		});

		it('accepts topics given as { topic, benefit_ar } objects directly in a roadmap', () => {
			const data = normalizeRoadmap({
				roadmap: { title: 'T', levels: [{ title: 'L', courses: [{ title: 'C', topics_detailed: [{ topic: 'DNS', benefit_ar: 'مهم' }, 'ARP'] }] }] },
			});
			expect(data.levels[0].courses[0].topics).toEqual(['DNS', 'ARP']);
			expect(data.levels[0].courses[0].topic_benefits).toEqual({ DNS: 'مهم' });
		});
	});

	it('explains what is wrong', () => {
		expect(() => parseRoadmapJson('{ nope')).toThrow(BadRequestException);
		expect(() => parseRoadmapJson('{ nope')).toThrow(/Invalid JSON/);
		expect(() => normalizeRoadmap({ roadmap: { levels: [] } })).toThrow(/roadmap\.title/);
		expect(() => normalizeRoadmap({ roadmap: { title: 'T', levels: [] } })).toThrow(/at least one level/);
		expect(() => normalizeRoadmap({ roadmap: { title: 'T', levels: [{ title: 'L', courses: [{ topics: ['a'] }] }] } })).toThrow(/levels\[0\]\.courses\[0\]\.title/);
		expect(() => normalizeRoadmap({ roadmap: { title: 'T', levels: [{ title: 'L', courses: [{ title: 'C', topics: [] }] }] } })).toThrow(/no course has any topics/);
	});
});
