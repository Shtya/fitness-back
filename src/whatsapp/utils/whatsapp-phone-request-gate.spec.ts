import { PhoneRequestGate } from './whatsapp-phone-request-gate';

function clockGate(options: ConstructorParameters<typeof PhoneRequestGate>[1] = {}) {
	let now = 1_000_000;
	const lines: string[] = [];
	const gate = new PhoneRequestGate('acc-1', {
		now: () => now,
		log: (line) => lines.push(line),
		...options,
	});
	return {
		gate,
		lines,
		advance: (ms: number) => {
			now += ms;
		},
	};
}

describe('PhoneRequestGate', () => {
	it('never sends background requests to the phone', async () => {
		const { gate, lines } = clockGate();
		const task = jest.fn(async () => true);
		await expect(gate.run('history_on_demand', 'm1', task, { background: true })).resolves.toBe(
			'skipped_background',
		);
		expect(task).not.toHaveBeenCalled();
		expect(lines[0]).toContain('kind=history_on_demand');
		expect(lines[0]).toContain('outcome=skipped_background');
	});

	it('asks for the same message once per cooldown, including concurrent callers', async () => {
		const { gate, advance } = clockGate({ keyCooldownMs: 60_000 });
		let release!: (value: boolean) => void;
		const task = jest.fn(() => new Promise<boolean>((resolve) => (release = resolve)));
		const first = gate.run('media_reupload', 'm1', task);
		await expect(gate.run('media_reupload', 'm1', task)).resolves.toBe('skipped_duplicate');
		release(true);
		await expect(first).resolves.toBe('ok');
		await expect(gate.run('media_reupload', 'm1', task)).resolves.toBe('skipped_duplicate');
		advance(60_001);
		await expect(gate.run('media_reupload', 'm1', async () => true)).resolves.toBe('ok');
		expect(task).toHaveBeenCalledTimes(1);
	});

	it('caps requests per rolling minute', async () => {
		const { gate, advance } = clockGate({ perMinute: 2 });
		await expect(gate.run('placeholder_resend', 'a', async () => true)).resolves.toBe('ok');
		await expect(gate.run('placeholder_resend', 'b', async () => true)).resolves.toBe('ok');
		await expect(gate.run('placeholder_resend', 'c', async () => true)).resolves.toBe(
			'skipped_rate_limit',
		);
		advance(60_000);
		await expect(gate.run('placeholder_resend', 'c', async () => true)).resolves.toBe('ok');
	});

	it('pauses after the phone stops answering, then resumes', async () => {
		const { gate, advance, lines } = clockGate({ unresponsiveAfter: 2, unresponsivePauseMs: 30_000 });
		await expect(gate.run('media_reupload', 'a', async () => false)).resolves.toBe('no_response');
		await expect(
			gate.run('media_reupload', 'b', async () => {
				throw new Error('Phone media re-upload timed out');
			}),
		).resolves.toBe('failed');
		expect(gate.isPaused()).toBe(true);
		expect(lines.some((line) => line.includes('event=paused'))).toBe(true);
		const task = jest.fn(async () => true);
		await expect(gate.run('media_reupload', 'c', task)).resolves.toBe('skipped_phone_unresponsive');
		expect(task).not.toHaveBeenCalled();
		advance(30_000);
		await expect(gate.run('media_reupload', 'c', task)).resolves.toBe('ok');
	});

	it('a successful answer resets the unanswered streak', async () => {
		const { gate } = clockGate({ unresponsiveAfter: 2 });
		await gate.run('media_reupload', 'a', async () => false);
		await gate.run('media_reupload', 'b', async () => true);
		await gate.run('media_reupload', 'c', async () => false);
		expect(gate.isPaused()).toBe(false);
	});

	it('logs ids truncated and never message content', async () => {
		const { gate, lines } = clockGate();
		await gate.run('placeholder_resend', '3EB0ABCDEF0123456789ABCDEF', async () => true);
		expect(lines[0]).toContain('key=3EB0ABCDEF012345…');
		expect(lines[0]).not.toContain('6789ABCDEF');
	});
});
