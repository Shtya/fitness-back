import {
	configuredCorsOrigins,
	corsAllowlistWarning,
	corsOriginDelegate,
	isCorsOriginAllowed,
} from './cors-origin';

describe('CORS origin allowlist (audit P4)', () => {
	it('parses a comma-separated allowlist and normalizes trailing slashes and case', () => {
		expect(
			configuredCorsOrigins({ CORS_ORIGIN: 'https://App.example.com/, https://admin.example.com' }),
		).toEqual(['https://app.example.com', 'https://admin.example.com']);
		expect(configuredCorsOrigins({ CORS_ORIGIN: '*' })).toBeNull();
		expect(configuredCorsOrigins({})).toBeNull();
	});

	it('allows only listed origins when CORS_ORIGIN is set', () => {
		const env = { CORS_ORIGIN: 'https://app.example.com' };
		expect(isCorsOriginAllowed('https://app.example.com', env)).toBe(true);
		expect(isCorsOriginAllowed('https://app.example.com/', env)).toBe(true);
		expect(isCorsOriginAllowed('https://evil.example.net', env)).toBe(false);
		expect(isCorsOriginAllowed('https://app.example.com.evil.net', env)).toBe(false);
	});

	it('accepts requests without an Origin header', () => {
		expect(isCorsOriginAllowed(undefined, { CORS_ORIGIN: 'https://app.example.com' })).toBe(true);
	});

	it('keeps the dev default (reflect) and the production base-URL fallback', () => {
		expect(isCorsOriginAllowed('http://localhost:3001', {})).toBe(true);
		const prod = { NODE_ENV: 'production', NEXT_PUBLIC_BASE_URL: 'https://app.example.com' };
		expect(isCorsOriginAllowed('https://app.example.com', prod)).toBe(true);
		expect(isCorsOriginAllowed('https://evil.example.net', prod)).toBe(false);
	});

	it('lets a gateway-specific key override CORS_ORIGIN', () => {
		const env = {
			CORS_ORIGIN: 'https://app.example.com',
			WHATSAPP_WS_CORS_ORIGIN: 'https://inbox.example.com',
		};
		expect(isCorsOriginAllowed('https://inbox.example.com', env, 'WHATSAPP_WS_CORS_ORIGIN')).toBe(true);
		expect(isCorsOriginAllowed('https://app.example.com', env, 'WHATSAPP_WS_CORS_ORIGIN')).toBe(false);
	});

	it('reads env lazily on every request', () => {
		const previous = process.env.CORS_ORIGIN;
		const delegate = corsOriginDelegate();
		const callback = jest.fn();
		try {
			process.env.CORS_ORIGIN = 'https://app.example.com';
			delegate('https://evil.example.net', callback);
			expect(callback).toHaveBeenLastCalledWith(null, false);
			process.env.CORS_ORIGIN = 'https://evil.example.net';
			delegate('https://evil.example.net', callback);
			expect(callback).toHaveBeenLastCalledWith(null, true);
		} finally {
			if (previous === undefined) delete process.env.CORS_ORIGIN;
			else process.env.CORS_ORIGIN = previous;
		}
	});

	it('drives the cors middleware Nest uses (allowed vs blocked preflight)', async () => {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const express = require('express');
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const cors = require('cors');
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const request = require('supertest');
		const previous = process.env.CORS_ORIGIN;
		process.env.CORS_ORIGIN = 'https://app.example.com';
		try {
			const app = express();
			app.use(cors({ origin: corsOriginDelegate(), credentials: true }));
			app.get('/x', (_req: any, res: any) => res.json({ ok: true }));

			const allowed = await request(app)
				.options('/x')
				.set('Origin', 'https://app.example.com')
				.set('Access-Control-Request-Method', 'GET');
			expect(allowed.headers['access-control-allow-origin']).toBe('https://app.example.com');
			expect(allowed.headers['access-control-allow-credentials']).toBe('true');

			const blocked = await request(app)
				.options('/x')
				.set('Origin', 'https://evil.example.net')
				.set('Access-Control-Request-Method', 'GET');
			expect(blocked.headers['access-control-allow-origin']).toBeUndefined();
		} finally {
			if (previous === undefined) delete process.env.CORS_ORIGIN;
			else process.env.CORS_ORIGIN = previous;
		}
	});

	it('warns only when origins are reflected', () => {
		expect(corsAllowlistWarning({})).toMatch(/CORS_ORIGIN is not set/);
		expect(corsAllowlistWarning({ CORS_ORIGIN: 'https://app.example.com' })).toBeNull();
	});
});
