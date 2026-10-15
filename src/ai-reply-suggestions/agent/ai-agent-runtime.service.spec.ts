import { AiAgentRuntimeService, mergeAgentSettings } from './ai-agent-runtime.service';

type Row = Record<string, any>;

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const CONVERSATION = '22222222-2222-4222-8222-222222222222';
const ACTOR = '33333333-3333-4333-8333-333333333333';

function message(id: string, direction: 'inbound' | 'outbound', text: string, minutesAgo: number): Row {
	return {
		id,
		conversationId: CONVERSATION,
		direction,
		type: 'text',
		text,
		senderUserId: null,
		providerTimestamp: new Date(Date.now() - minutesAgo * 60_000),
	};
}

function setup(options: {
	settings?: Row;
	messages?: Row[];
	latestId?: string;
	claim?: boolean;
	providerText?: string;
	state?: Row | null;
	agentMessageIds?: string[];
} = {}) {
	const settingsRow = { enabled: true, scope: 'all', defaultMode: 'auto', actorUserId: ACTOR, debounceSeconds: 2, ...options.settings };
	const messages = options.messages ?? [message('m1', 'inbound', 'How much is the basic plan?', 1)];
	const states = new Map<string, Row>();
	if (options.state) states.set(CONVERSATION, { conversationId: CONVERSATION, accountId: ACCOUNT, ...options.state });
	const runs: Row[] = [];

	const settingsRepo = { findOne: jest.fn(async () => settingsRow), update: jest.fn() };
	const stateRepo = {
		findOne: jest.fn(async () => states.get(CONVERSATION) ?? null),
		create: jest.fn((row: Row) => ({ ...row })),
		save: jest.fn(async (row: Row) => {
			states.set(row.conversationId, { ...row });
			return row;
		}),
	};
	const knowledgeRepo = {
		find: jest.fn(async () => [
			{ id: 'k1', title: 'Basic plan price', content: 'The basic plan costs 300 EGP per month.', category: 'price', tags: [] },
		]),
	};
	const memoryRepo = {
		findOne: jest.fn(async () => null),
		create: jest.fn((row: Row) => row),
		save: jest.fn(async (row: Row) => row),
	};
	const runRepo = {
		query: jest.fn(async () => (options.claim === false ? [] : [{ id: `run-${runs.length + 1}` }])),
		count: jest.fn(async ({ where }: Row) =>
			where?.replyMessageId && options.agentMessageIds?.includes(where.replyMessageId) ? 1 : 0,
		),
		find: jest.fn(async () => []),
		update: jest.fn(async (id: string, patch: Row) => {
			runs.push({ id, ...patch });
		}),
	};
	const conversationRepo = {
		findOne: jest.fn(async () => ({
			id: CONVERSATION,
			accountId: ACCOUNT,
			type: 'direct',
			isClosed: false,
			assignedUserId: null,
		})),
	};
	const messageRepo = {
		find: jest.fn(async ({ where }: Row) => (where.providerTimestamp ? [] : [...messages].reverse())),
		findOne: jest.fn(async () => ({ id: options.latestId ?? messages[messages.length - 1].id, direction: 'inbound' })),
	};
	const userRepo = { findOne: jest.fn(async () => ({ id: ACTOR })) };
	const listeners: Row = {};
	const sync = {
		onInboundMessagePersisted: jest.fn((listener: any) => {
			listeners.inbound = listener;
			return () => undefined;
		}),
		onOutboundMessagePersisted: jest.fn((listener: any) => {
			listeners.outbound = listener;
			return () => undefined;
		}),
		sendText: jest.fn(async () => ({ ok: true, message: { id: 'sent-1' } })),
	};
	const gateway = { emitAccountEvent: jest.fn() };
	const provider = {
		name: 'ai-free',
		generate: jest.fn(async () => ({
			text:
				options.providerText ??
				JSON.stringify({
					reply: 'The basic plan costs 300 EGP per month.',
					action: 'reply',
					confidence: 0.9,
					usedKnowledgeIds: ['k1'],
					memory: { facts: ['Interested in the basic plan'], commitments: [] },
					reasoning: 'Answered from the price entry.',
				}),
			actualModel: 'test-model',
		})),
	};
	const providers = { tryGet: jest.fn(() => provider) };
	const audit = { write: jest.fn(async () => undefined) };

	const runtime = new AiAgentRuntimeService(
		settingsRepo as any,
		stateRepo as any,
		knowledgeRepo as any,
		memoryRepo as any,
		runRepo as any,
		conversationRepo as any,
		messageRepo as any,
		userRepo as any,
		sync as any,
		gateway as any,
		providers as any,
		audit as any,
	);
	runtime.onModuleInit();
	return { runtime, sync, provider, runRepo, states, runs, gateway, listeners, settingsRow };
}

describe('AiAgentRuntimeService', () => {
	afterEach(() => jest.useRealTimers());

	it('merges stored settings over safe defaults', () => {
		const merged = mergeAgentSettings(ACCOUNT, { enabled: true, minConfidence: '0.7' as any });
		expect(merged.enabled).toBe(true);
		expect(merged.minConfidence).toBe(0.7);
		expect(merged.knowledgeOnly).toBe(true);
		expect(merged.discloseAi).toBe(true);
		expect(mergeAgentSettings(ACCOUNT, null).enabled).toBe(false);
	});

	it('auto-sends a grounded reply as the configured actor with an idempotent client id', async () => {
		const { runtime, sync, states, runs } = setup();
		await runtime.process(CONVERSATION);
		expect(sync.sendText).toHaveBeenCalledWith(
			{ id: ACTOR },
			CONVERSATION,
			'The basic plan costs 300 EGP per month.',
			undefined,
			'ai-agent-run-1',
		);
		expect(runs.some(run => run.outcome === 'sent' && run.replyMessageId === 'sent-1')).toBe(true);
		expect(states.get(CONVERSATION)?.status).toBe('replied');
	});

	it('keeps an ungrounded figure as a suggestion instead of sending it', async () => {
		const { runtime, sync, states } = setup({
			providerText: JSON.stringify({ reply: 'It costs 999 EGP.', action: 'reply', confidence: 0.95 }),
		});
		await runtime.process(CONVERSATION);
		expect(sync.sendText).not.toHaveBeenCalled();
		const state = states.get(CONVERSATION)!;
		expect(state.status).toBe('suggested');
		expect(state.pendingSuggestion.reasons).toContain('unverified_figure');
	});

	it('only drafts in suggest mode', async () => {
		const { runtime, sync, states } = setup({ settings: { defaultMode: 'suggest' } });
		await runtime.process(CONVERSATION);
		expect(sync.sendText).not.toHaveBeenCalled();
		expect(states.get(CONVERSATION)?.pendingSuggestion?.text).toBe('The basic plan costs 300 EGP per month.');
	});

	it('does nothing for an already-claimed trigger message (dedupe across restarts)', async () => {
		const { runtime, provider, sync } = setup({ claim: false });
		await runtime.process(CONVERSATION);
		expect(provider.generate).not.toHaveBeenCalled();
		expect(sync.sendText).not.toHaveBeenCalled();
	});

	it('steps back while a human replied recently', async () => {
		const { runtime, provider, states } = setup({
			messages: [message('h1', 'outbound', 'Let me check', 5), message('m2', 'inbound', 'ok?', 1)],
		});
		await runtime.process(CONVERSATION);
		expect(provider.generate).not.toHaveBeenCalled();
		expect(states.get(CONVERSATION)?.status).toBe('paused');
		expect(states.get(CONVERSATION)?.statusReason).toBe('human_active');
	});

	it('does not treat its own previous reply as a human takeover', async () => {
		const { runtime, provider } = setup({
			messages: [message('a1', 'outbound', 'Hello!', 5), message('m2', 'inbound', 'Basic plan price?', 1)],
			agentMessageIds: ['a1'],
		});
		await runtime.process(CONVERSATION);
		expect(provider.generate).toHaveBeenCalledTimes(1);
	});

	it('drops a stale answer when a newer customer message arrived during generation', async () => {
		const { runtime, sync, runs } = setup({ latestId: 'm-newer' });
		await runtime.process(CONVERSATION);
		expect(sync.sendText).not.toHaveBeenCalled();
		expect(runs.some(run => run.outcome === 'superseded')).toBe(true);
	});

	it('hands off when the customer asks for a human and pauses itself', async () => {
		const { runtime, provider, sync, states } = setup({
			messages: [message('m1', 'inbound', 'I want to talk to a human please', 1)],
			settings: { handoffKeywords: [] },
		});
		await runtime.process(CONVERSATION);
		expect(provider.generate).not.toHaveBeenCalled();
		expect(sync.sendText).toHaveBeenCalledTimes(1);
		const state = states.get(CONVERSATION)!;
		expect(state.status).toBe('handoff');
		expect(new Date(state.pausedUntil).getTime()).toBeGreaterThan(Date.now());
	});

	it('ignores a customer message older than the freshness window', async () => {
		const { runtime, provider } = setup({ messages: [message('old', 'inbound', 'basic plan price?', 60 * 24)] });
		await runtime.process(CONVERSATION);
		expect(provider.generate).not.toHaveBeenCalled();
	});

	it('does nothing when the conversation mode is off', async () => {
		const { runtime, provider } = setup({ state: { mode: 'off', status: 'idle' } });
		await runtime.process(CONVERSATION);
		expect(provider.generate).not.toHaveBeenCalled();
	});

	it('debounces a burst into a single run', async () => {
		jest.useFakeTimers();
		const { runtime } = setup();
		const fire = jest.spyOn(runtime, 'fire').mockImplementation(async () => undefined);
		runtime.schedule(ACCOUNT, CONVERSATION, 2_000);
		jest.advanceTimersByTime(1_000);
		runtime.schedule(ACCOUNT, CONVERSATION, 2_000);
		jest.advanceTimersByTime(1_500);
		expect(fire).not.toHaveBeenCalled();
		jest.advanceTimersByTime(600);
		expect(fire).toHaveBeenCalledTimes(1);
	});

	it('runs one generation per conversation and re-runs once for messages that arrived meanwhile', async () => {
		const { runtime } = setup();
		let release!: () => void;
		const process = jest
			.spyOn(runtime, 'process')
			.mockImplementationOnce(() => new Promise<void>(resolve => (release = resolve)))
			.mockImplementation(async () => undefined);
		const first = runtime.fire(CONVERSATION);
		runtime.fire(CONVERSATION);
		runtime.fire(CONVERSATION);
		expect(process).toHaveBeenCalledTimes(1);
		release();
		await first;
		await new Promise(resolve => setImmediate(resolve));
		expect(process).toHaveBeenCalledTimes(2);
	});

	it('publishes the settled state after a run that exits early, so the UI never stays on "waiting"', async () => {
		const { runtime, gateway } = setup({
			state: { mode: 'auto', status: 'paused', pausedUntil: new Date(Date.now() + 60_000) },
		});
		await runtime.fire(CONVERSATION);
		await new Promise(resolve => setImmediate(resolve));
		await new Promise(resolve => setImmediate(resolve));
		const last = gateway.emitAccountEvent.mock.calls.at(-1);
		expect(last?.[1]).toBe('ai_agent.state');
		expect(last?.[2].status).toBe('paused');
	});

	it('pauses when a human sends from the phone', async () => {
		const { runtime, states, listeners } = setup();
		await listeners.outbound(ACCOUNT, message('p1', 'outbound', 'I will handle this', 0));
		expect(states.get(CONVERSATION)?.status).toBe('paused');
		expect(states.get(CONVERSATION)?.statusReason).toBe('human_replied');
	});
});
