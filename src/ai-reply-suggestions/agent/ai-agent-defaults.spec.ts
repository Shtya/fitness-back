import {
	AGENT_DIALECTS,
	AGENT_TONES,
	KNOWLEDGE_CATEGORIES,
} from './ai-agent.entities';
import { FILLABLE_AGENT_FIELDS, recommendedAgentSettings, starterKnowledge } from './ai-agent-defaults';

describe('ai-agent-defaults', () => {
	it('builds a friendly Egyptian setup named after the WhatsApp account', () => {
		const settings = recommendedAgentSettings({ accountLabel: 'Power Gym' });
		expect(settings.businessName).toBe('Power Gym');
		expect(settings.agentName).toContain('Power Gym');
		expect(settings.dialect).toBe('egyptian');
		expect(settings.tone).toBe('friendly');
		expect(settings.discloseAi).toBe(false);
		expect(AGENT_DIALECTS).toContain(settings.dialect);
		expect(AGENT_TONES).toContain(settings.tone);
		expect(settings.rules.split('\n').length).toBeGreaterThanOrEqual(5);
	});

	it('falls back to the product name for generic account labels', () => {
		expect(recommendedAgentSettings({ accountLabel: 'Main' }).businessName).toBe('So7baFit');
		expect(recommendedAgentSettings({ accountLabel: null }).businessName).toBe('So7baFit');
	});

	it('stays inside the settings DTO limits', () => {
		const settings = recommendedAgentSettings({ accountLabel: 'x'.repeat(300) });
		expect(settings.agentName.length).toBeLessThanOrEqual(80);
		expect(settings.businessName.length).toBeLessThanOrEqual(120);
		expect(settings.persona.length).toBeLessThanOrEqual(2000);
		expect(settings.rules.length).toBeLessThanOrEqual(4000);
		expect(settings.handoffMessage.length).toBeLessThanOrEqual(500);
		for (const topic of [...settings.allowedTopics, ...settings.forbiddenTopics]) {
			expect(topic.length).toBeLessThanOrEqual(80);
		}
		for (const key of FILLABLE_AGENT_FIELDS) expect(settings[key]).toBeTruthy();
	});

	it('starter knowledge has valid categories and no invented prices', () => {
		const entries = starterKnowledge({ accountLabel: 'Power Gym' });
		expect(entries.length).toBeGreaterThan(3);
		for (const entry of entries) {
			expect(KNOWLEDGE_CATEGORIES).toContain(entry.category);
			expect(entry.content).not.toMatch(/\d{2,}/);
		}
		expect(new Set(entries.map(entry => entry.title)).size).toBe(entries.length);
	});
});
