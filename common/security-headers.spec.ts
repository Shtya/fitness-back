import { authAttemptLimiter, securityHeaders } from './security-headers';

function fakeRes() {
	const headers: Record<string, string> = {};
	const res: any = {
		statusCode: 200,
		body: undefined,
		setHeader: (name: string, value: string) => { headers[name] = value; },
		status(code: number) { this.statusCode = code; return this; },
		json(payload: unknown) { this.body = payload; return this; },
	};
	return { res, headers };
}

describe('security headers (audit S5)', () => {
	it('sets nosniff/referrer headers and HSTS only on secure requests', () => {
		const plain = fakeRes();
		const next = jest.fn();
		securityHeaders()({ secure: false } as any, plain.res, next);
		expect(plain.headers['X-Content-Type-Options']).toBe('nosniff');
		expect(plain.headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
		expect(plain.headers['Strict-Transport-Security']).toBeUndefined();
		expect(plain.headers['X-Frame-Options']).toBeUndefined();
		expect(next).toHaveBeenCalled();

		const secure = fakeRes();
		securityHeaders()({ secure: true } as any, secure.res, jest.fn());
		expect(secure.headers['Strict-Transport-Security']).toBe('max-age=15552000');
	});
});

describe('authAttemptLimiter (audit S5)', () => {
	const req = (email: string, ip = '127.0.0.1', baseUrl = '/api/v1/auth/login') =>
		({ method: 'POST', baseUrl, path: '/', ip, body: { email } }) as any;

	it('ignores non-POST requests', () => {
		const limiter = authAttemptLimiter({ windowMs: 60_000, max: 0, now: () => 0 });
		const next = jest.fn();
		limiter({ ...req('a@x.com'), method: 'OPTIONS' }, fakeRes().res, next);
		expect(next).toHaveBeenCalledTimes(1);
		expect(limiter.size()).toBe(0);
	});

	it('blocks the attempt after max within the window and reports Retry-After', () => {
		let clock = 1_000;
		const limiter = authAttemptLimiter({ windowMs: 60_000, max: 3, now: () => clock });
		const next = jest.fn();
		for (let i = 0; i < 3; i += 1) limiter(req('a@x.com'), fakeRes().res, next);
		expect(next).toHaveBeenCalledTimes(3);

		const blocked = fakeRes();
		limiter(req('A@x.com '), blocked.res, next);
		expect(blocked.res.statusCode).toBe(429);
		expect(blocked.headers['Retry-After']).toBe('60');
		expect(next).toHaveBeenCalledTimes(3);

		clock += 60_000;
		limiter(req('a@x.com'), fakeRes().res, next);
		expect(next).toHaveBeenCalledTimes(4);
	});

	it('keys by account so one throttled account does not lock out others behind the same proxy IP', () => {
		const limiter = authAttemptLimiter({ windowMs: 60_000, max: 1, now: () => 0 });
		const next = jest.fn();
		limiter(req('victim@x.com'), fakeRes().res, next);
		limiter(req('victim@x.com'), fakeRes().res, next);
		limiter(req('other@x.com'), fakeRes().res, next);
		limiter(req('victim@x.com', '127.0.0.1', '/api/v1/auth/reset-password'), fakeRes().res, next);
		expect(next).toHaveBeenCalledTimes(3);
	});

	it('stays bounded in memory', () => {
		let clock = 0;
		const limiter = authAttemptLimiter({ windowMs: 10, max: 5, maxKeys: 50, now: () => clock });
		for (let i = 0; i < 500; i += 1) {
			clock = i;
			limiter(req(`u${i}@x.com`), fakeRes().res, jest.fn());
		}
		expect(limiter.size()).toBeLessThanOrEqual(50);
		const next = jest.fn();
		limiter(req('fresh@x.com'), fakeRes().res, next);
		expect(next).toHaveBeenCalledTimes(1);
	});
});
