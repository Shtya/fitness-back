import {
	applyGuards,
	AgentModelResult,
	buildAgentPrompt,
	debounceDeadline,
	detectHandoffRequest,
	mergeMemory,
	normalizeForSearch,
	parseAgentResult,
	rankRelevantHistory,
	resolveEffectiveMode,
	resolvePermissions,
	retrieveKnowledge,
} from './ai-agent.policy';

const docs = [
	{ id: 'k1', category: 'price', title: 'أسعار الاشتراك الشهري', content: 'الاشتراك الشهري 450 جنيه ويشمل خطة تمارين وخطة تغذية.', tags: ['اشتراك', 'سعر'] },
	{ id: 'k2', category: 'policy', title: 'Refund policy', content: 'Refunds are possible within 7 days of purchase if no session was used.', tags: ['refund'] },
	{ id: 'k3', category: 'service', title: 'المتابعة الأسبوعية', content: 'يتم إرسال تقرير متابعة كل أسبوع عبر واتساب.', tags: [] },
];

function result(overrides: Partial<AgentModelResult> = {}): AgentModelResult {
	return {
		reply: 'الاشتراك الشهري 450 جنيه.',
		action: 'reply',
		confidence: 0.9,
		usedKnowledgeIds: ['k1'],
		memory: { facts: [], commitments: [] },
		reasoning: '',
		parsedJson: true,
		...overrides,
	};
}

const guardBase = {
	permissions: resolvePermissions({}),
	forbiddenTopics: [],
	minConfidence: 0.55,
	knowledgeTexts: [docs[0].content],
	conversationTexts: ['بكام الاشتراك؟'],
	previousAgentReplies: [],
};

describe('resolveEffectiveMode', () => {
	const settings = { enabled: true, scope: 'all' as const, defaultMode: 'auto' as const };
	it('inherits the account default only in all-chats scope', () => {
		expect(resolveEffectiveMode(settings, 'inherit')).toBe('auto');
		expect(resolveEffectiveMode({ ...settings, scope: 'selected' }, 'inherit')).toBe('off');
	});
	it('honours per-chat overrides, including exclusions in all-chats scope', () => {
		expect(resolveEffectiveMode(settings, 'off')).toBe('off');
		expect(resolveEffectiveMode({ ...settings, scope: 'selected' }, 'suggest')).toBe('suggest');
	});
	it('is off whenever the account agent is disabled', () => {
		expect(resolveEffectiveMode({ ...settings, enabled: false }, 'auto')).toBe('off');
		expect(resolveEffectiveMode(null, 'auto')).toBe('off');
	});
});

describe('debounceDeadline', () => {
	it('extends with each message but is capped from the first pending one', () => {
		expect(debounceDeadline({ now: 1_000, firstPendingAt: null, debounceMs: 8_000 })).toBe(9_000);
		expect(debounceDeadline({ now: 20_000, firstPendingAt: 1_000, debounceMs: 8_000 })).toBe(28_000);
		expect(debounceDeadline({ now: 31_000, firstPendingAt: 1_000, debounceMs: 8_000 })).toBe(33_000);
	});
});

describe('normalizeForSearch / retrieveKnowledge', () => {
	it('normalizes Arabic letter variants, diacritics and digits', () => {
		expect(normalizeForSearch('الإشتراكُ ٤٥٠ جنيهاً')).toBe('الاشتراك 450 جنيها');
	});
	it('finds the Arabic price entry from a colloquial question', () => {
		const hits = retrieveKnowledge(docs, 'عايز اعرف سعر الاشتراك الشهري كام؟');
		expect(hits[0]?.doc.id).toBe('k1');
	});
	it('finds English entries and ignores unrelated ones', () => {
		const hits = retrieveKnowledge(docs, 'Can I get a refund?');
		expect(hits.map(hit => hit.doc.id)).toEqual(['k2']);
	});
	it('returns nothing for a question outside the knowledge base', () => {
		expect(retrieveKnowledge(docs, 'what is the weather in Paris')).toEqual([]);
	});
	it('still retrieves from a single-entry knowledge base', () => {
		const single = [{ id: 'only', title: 'Basic plan price', content: 'The basic plan costs 300 EGP per month.', category: 'price' }];
		expect(retrieveKnowledge(single, 'How much is the basic plan?').map(hit => hit.doc.id)).toEqual(['only']);
		expect(retrieveKnowledge(single, 'where is your office')).toEqual([]);
	});
});

describe('applyGuards', () => {
	it('sends a grounded, confident reply', () => {
		expect(applyGuards({ ...guardBase, result: result() })).toEqual({ decision: 'send', reasons: [] });
	});
	it('never auto-sends a figure that is not in knowledge or the chat', () => {
		const out = applyGuards({ ...guardBase, result: result({ reply: 'الاشتراك 300 جنيه بس' }) });
		expect(out.decision).toBe('suggest');
		expect(out.reasons).toContain('unverified_figure');
	});
	it('blocks claims of being human', () => {
		const out = applyGuards({ ...guardBase, result: result({ reply: "Yes, I'm a real human, don't worry" }) });
		expect(out.reasons).toContain('claims_human');
		expect(out.decision).toBe('suggest');
	});
	it('blocks unapproved commitments and discounts', () => {
		const out = applyGuards({ ...guardBase, result: result({ reply: 'أوعدك هنبعتلك خصم بكرة' }) });
		expect(out.reasons).toEqual(expect.arrayContaining(['unapproved_commitment', 'discount_not_allowed']));
	});
	it('drafts low-confidence replies for review', () => {
		expect(applyGuards({ ...guardBase, result: result({ confidence: 0.2 }) }).decision).toBe('suggest');
	});
	it('skips duplicate and empty replies', () => {
		expect(applyGuards({ ...guardBase, previousAgentReplies: ['الاشتراك الشهري ٤٥٠ جنيه'], result: result() }).decision).toBe('skip');
		expect(applyGuards({ ...guardBase, result: result({ action: 'no_reply', reply: '' }) }).decision).toBe('skip');
	});
	it('routes model handoffs to a human', () => {
		expect(applyGuards({ ...guardBase, result: result({ action: 'handoff', reply: 'هحولك لزميل' }) }).decision).toBe('handoff');
	});
	it('flags forbidden topics', () => {
		const out = applyGuards({ ...guardBase, forbiddenTopics: ['politics'], result: result({ reply: 'About politics, I think...' }) });
		expect(out.reasons).toContain('forbidden_topic');
	});
});

describe('parseAgentResult', () => {
	it('parses fenced JSON and clamps values', () => {
		const parsed = parseAgentResult('```json\n{"reply":"Hi","action":"reply","confidence":4,"usedKnowledgeIds":["k1"],"memory":{"facts":["likes mornings"]}}\n```');
		expect(parsed).toMatchObject({ reply: 'Hi', confidence: 1, usedKnowledgeIds: ['k1'], parsedJson: true });
		expect(parsed.memory.facts).toEqual(['likes mornings']);
	});
	it('treats plain text as a low-confidence unstructured reply', () => {
		const parsed = parseAgentResult('Hello there');
		expect(parsed).toMatchObject({ reply: 'Hello there', parsedJson: false });
		expect(applyGuards({ ...guardBase, result: parsed }).decision).toBe('suggest');
	});
});

describe('detectHandoffRequest', () => {
	it('detects explicit requests for a human in Arabic and English', () => {
		expect(detectHandoffRequest('عايز اكلم موظف لو سمحت', [])).toBe(true);
		expect(detectHandoffRequest('Can I talk to a human?', [])).toBe(true);
		expect(detectHandoffRequest('ميعاد التمرين امتى', [])).toBe(false);
		expect(detectHandoffRequest('please escalate this', ['escalate'])).toBe(true);
	});
});

describe('mergeMemory', () => {
	it('dedupes, caps and refuses sensitive data', () => {
		const now = new Date('2026-10-14T10:00:00Z');
		const merged = mergeMemory(
			[{ text: 'Prefers evening sessions', at: now.toISOString() }],
			['prefers evening sessions', 'Lives in Cairo', 'My card number is 4111111111111111'],
			{ max: 2, now },
		);
		expect(merged.map(item => item.text)).toEqual(['Prefers evening sessions', 'Lives in Cairo']);
	});
});

describe('rankRelevantHistory', () => {
	it('picks earlier messages about the same topic, preferring promises', () => {
		const picked = rankRelevantHistory(
			[
				{ id: 'a', text: 'الجو حلو النهارده' },
				{ id: 'b', text: 'هنبعتلك خطة التغذية بكرة' },
				{ id: 'c', text: 'خطة التغذية جاهزة تقريبا' },
			],
			'فين خطة التغذية؟',
		);
		expect(picked.map(item => item.id)).toEqual(['b', 'c']);
	});
});

describe('buildAgentPrompt', () => {
	it('keeps secrets out, includes honesty and knowledge, and respects the budget', () => {
		const long = 'x'.repeat(5_000);
		const { prompt } = buildAgentPrompt({
			settings: {
				agentName: 'Sara',
				businessName: 'So7ba',
				persona: null,
				dialect: 'egyptian',
				tone: 'friendly',
				replyLength: 'short',
				rules: null,
				allowedTopics: [],
				forbiddenTopics: [],
				permissions: resolvePermissions({}),
				useKnowledgeBase: true,
				knowledgeOnly: true,
				discloseAi: true,
				disclosureText: null,
			},
			recent: Array.from({ length: 30 }, (_, index) => ({ role: 'customer' as const, content: `${index} ${long}` })),
			relevantHistory: [],
			knowledge: retrieveKnowledge(docs, 'سعر الاشتراك'),
			memory: null,
			isFirstAgentReply: true,
			budgetChars: 8_000,
		});
		expect(prompt).toContain('Never claim or imply you are a human');
		expect(prompt).toContain('k1');
		expect(prompt).toContain('first reply');
		expect(prompt.length).toBeLessThan(14_000);
	});

	it('sounds natural without a disclosure but keeps the honesty rule', () => {
		const { prompt } = buildAgentPrompt({
			settings: {
				agentName: 'فريق So7baFit',
				businessName: 'So7baFit',
				persona: null,
				dialect: 'egyptian',
				tone: 'friendly',
				replyLength: 'short',
				rules: null,
				allowedTopics: [],
				forbiddenTopics: [],
				permissions: resolvePermissions({}),
				useKnowledgeBase: false,
				knowledgeOnly: false,
				discloseAi: false,
				disclosureText: null,
			},
			recent: [{ role: 'customer', content: 'اهلا' }],
			relevantHistory: [],
			knowledge: [],
			memory: null,
			isFirstAgentReply: true,
		});
		expect(prompt).toContain('Do not introduce yourself as an AI');
		expect(prompt).toContain('Never claim or imply you are a human');
		expect(prompt).not.toContain('first reply in this chat');
	});
});
