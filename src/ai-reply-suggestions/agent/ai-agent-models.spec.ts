import { AI_REPLY_PROVIDERS } from '../entities/whatsapp-ai-settings.entity';
import {
	BUILT_IN_AGENT_PROVIDERS,
	decryptAgentSecret,
	encryptAgentSecret,
	last4,
	normalizeExternalBaseUrl,
} from './ai-agent-models';

describe('ai-agent-models', () => {
	it('lists the same built-in providers as AI Free', () => {
		expect(BUILT_IN_AGENT_PROVIDERS.map(item => item.name)).toEqual([...AI_REPLY_PROVIDERS]);
	});

	it('encrypts and decrypts API keys', () => {
		const encoded = encryptAgentSecret('sk-test-secret', 'dev-secret');
		expect(encoded).not.toContain('sk-test-secret');
		expect(decryptAgentSecret(encoded, 'dev-secret')).toBe('sk-test-secret');
		expect(last4('sk-test-secret')).toBe('cret');
	});

	it('accepts https endpoints and local http Ollama', () => {
		expect(normalizeExternalBaseUrl('https://api.openai.com/v1/')).toBe('https://api.openai.com/v1');
		expect(normalizeExternalBaseUrl('http://127.0.0.1:11434/v1')).toBe('http://127.0.0.1:11434/v1');
	});

	it('rejects non-local http and metadata hosts', () => {
		expect(() => normalizeExternalBaseUrl('http://evil.example/v1')).toThrow(/https/);
		expect(() => normalizeExternalBaseUrl('https://169.254.169.254')).toThrow(/not allowed/);
	});
});
