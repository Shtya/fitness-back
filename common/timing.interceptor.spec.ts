import { redactQuery } from './timing.interceptor';

describe('redactQuery', () => {
	it('hides tokens and keeps other params', () => {
		expect(redactQuery('/api/v1/whatsapp/attachments/1/content?token=abc.def&download=1')).toBe(
			'/api/v1/whatsapp/attachments/1/content?token=[redacted]&download=1',
		);
	});
	it('leaves URLs without a query alone', () => {
		expect(redactQuery('/api/v1/health')).toBe('/api/v1/health');
	});
});
