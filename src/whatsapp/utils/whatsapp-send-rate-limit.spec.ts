import { HttpException } from '@nestjs/common';
import { assertSendRateLimit, resetSendRateLimit } from './whatsapp-send-rate-limit';

describe('assertSendRateLimit', () => {
	const previous = process.env.WHATSAPP_ENFORCE_SEND_RATE_LIMIT;

	beforeAll(() => {
		process.env.WHATSAPP_ENFORCE_SEND_RATE_LIMIT = '1';
	});

	afterAll(() => {
		if (previous == null) delete process.env.WHATSAPP_ENFORCE_SEND_RATE_LIMIT;
		else process.env.WHATSAPP_ENFORCE_SEND_RATE_LIMIT = previous;
	});

	beforeEach(() => resetSendRateLimit());

	it('allows a burst under the window cap', () => {
		for (let i = 0; i < 40; i += 1) {
			expect(() => assertSendRateLimit('user-1', 1_000 + i)).not.toThrow();
		}
	});

	it('blocks the 41st send inside the same minute', () => {
		for (let i = 0; i < 40; i += 1) {
			assertSendRateLimit('user-1', 1_000 + i);
		}
		expect(() => assertSendRateLimit('user-1', 2_000)).toThrow(HttpException);
	});

	it('does not share buckets across users', () => {
		for (let i = 0; i < 40; i += 1) {
			assertSendRateLimit('user-1', 1_000);
		}
		expect(() => assertSendRateLimit('user-2', 1_000)).not.toThrow();
	});

	it('allows more sends after the window rolls', () => {
		for (let i = 0; i < 40; i += 1) {
			assertSendRateLimit('user-1', 1_000);
		}
		expect(() => assertSendRateLimit('user-1', 1_000 + 60_000)).not.toThrow();
	});
});
