import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FacebookGraphError } from '../utils/fb-graph-errors';

type GraphParams = Record<string, string | number | boolean | undefined | null>;

const REQUEST_TIMEOUT_MS = 20_000;
const PRE_SEND_NETWORK_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH']);

type GraphErrorBody = {
	error?: {
		message?: string;
		code?: number;
		error_subcode?: number;
		is_transient?: boolean;
	};
};

@Injectable()
export class FacebookGraphClient {
	constructor(private readonly config: ConfigService) {}

	graphVersion() {
		return (
			this.config.get<string>('FB_ENGAGEMENT_GRAPH_VERSION')?.trim() ||
			this.config.get<string>('META_GRAPH_API_VERSION')?.trim() ||
			'v21.0'
		);
	}

	dialogUrl(path: string) {
		return `https://www.facebook.com/${this.graphVersion()}${path}`;
	}

	private url(path: string, params: GraphParams = {}) {
		const url = new URL(`https://graph.facebook.com/${this.graphVersion()}${path.startsWith('/') ? path : `/${path}`}`);
		for (const [key, value] of Object.entries(params)) {
			if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
		}
		return url;
	}

	get<T>(path: string, accessToken: string | null, params: GraphParams = {}) {
		const url = this.url(path, { ...params, access_token: accessToken ?? undefined });
		return this.request<T>('GET', url);
	}

	post<T>(path: string, accessToken: string, body: GraphParams = {}) {
		const form = new URLSearchParams();
		for (const [key, value] of Object.entries({ ...body, access_token: accessToken })) {
			if (value !== undefined && value !== null) form.set(key, String(value));
		}
		return this.request<T>('POST', this.url(path), form);
	}

	private async request<T>(method: 'GET' | 'POST', url: URL, body?: URLSearchParams): Promise<T> {
		let response: Response;
		try {
			response = await fetch(url, {
				method,
				body,
				headers: body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : undefined,
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});
		} catch (error) {
			const code = (error as { cause?: { code?: string } })?.cause?.code;
			const beforeSend = method === 'GET' || (code !== undefined && PRE_SEND_NETWORK_CODES.has(code));
			throw new FacebookGraphError(
				'Network error while contacting Facebook',
				0,
				null,
				null,
				false,
				beforeSend ? 'before_send' : 'after_send',
			);
		}

		const text = await response.text();
		let parsed: unknown = null;
		try {
			parsed = text ? JSON.parse(text) : null;
		} catch {
			parsed = null;
		}

		const graphError = (parsed as GraphErrorBody | null)?.error;
		if (!response.ok || graphError) {
			throw new FacebookGraphError(
				graphError?.message || `Facebook request failed (${response.status})`,
				response.status,
				graphError?.code ?? null,
				graphError?.error_subcode ?? null,
				Boolean(graphError?.is_transient),
			);
		}
		return parsed as T;
	}
}
