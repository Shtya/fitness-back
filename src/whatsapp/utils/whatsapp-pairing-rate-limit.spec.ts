import { HttpException } from '@nestjs/common';
import {
	assertPairingCodeRateLimit,
	resetPairingCodeRateLimit,
} from './whatsapp-pairing-rate-limit';

describe('assertPairingCodeRateLimit', () => {
	beforeEach(() => resetPairingCodeRateLimit());

	it('allows the first request', () => {
		expect(() => assertPairingCodeRateLimit('user:acc', 1_000)).not.toThrow();
	});

	it('blocks a second request within 45 seconds', () => {
		assertPairingCodeRateLimit('user:acc', 1_000);
		expect(() => assertPairingCodeRateLimit('user:acc', 20_000)).toThrow(HttpException);
	});

	it('allows a request after the interval', () => {
		assertPairingCodeRateLimit('user:acc', 1_000);
		expect(() => assertPairingCodeRateLimit('user:acc', 46_000)).not.toThrow();
	});

	it('blocks more than 5 requests in 15 minutes', () => {
		let now = 1_000;
		for (let i = 0; i < 5; i += 1) {
			assertPairingCodeRateLimit('user:acc', now);
			now += 46_000;
		}
		expect(() => assertPairingCodeRateLimit('user:acc', now)).toThrow(HttpException);
	});
});
