import {
	BadRequestException,
	Injectable,
	Logger,
	ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type MetaGraphError = {
	message?: string;
	type?: string;
	code?: number;
	error_subcode?: number;
	fbtrace_id?: string;
	error_user_title?: string;
	error_user_msg?: string;
	error_data?: {
		messaging_product?: string;
		details?: string;
	};
};

@Injectable()
export class MetaWhatsAppCloudApiService {
	private readonly logger = new Logger(MetaWhatsAppCloudApiService.name);
	private readonly graphVersion: string;

	constructor(private readonly config: ConfigService) {
		this.graphVersion = this.config.get<string>('META_GRAPH_API_VERSION')?.trim() || 'v21.0';
	}

	baseUrl() {
		return `https://graph.facebook.com/${this.graphVersion}`;
	}

	async validateCredentials(input: {
		accessToken: string;
		phoneNumberId: string;
		wabaId?: string | null;
	}) {
		const phone = await this.request<{
			id?: string;
			display_phone_number?: string;
			verified_name?: string;
			quality_rating?: string;
		}>(
			'GET',
			`/${input.phoneNumberId}?fields=id,display_phone_number,verified_name,quality_rating`,
			input.accessToken,
		);

		let wabaOk: { id?: string; name?: string } | null = null;
		if (input.wabaId) {
			wabaOk = await this.request(
				'GET',
				`/${input.wabaId}?fields=id,name`,
				input.accessToken,
			);
		}

		return {
			phoneNumberId: phone.id || input.phoneNumberId,
			displayPhoneNumber: phone.display_phone_number || null,
			verifiedName: phone.verified_name || null,
			qualityRating: phone.quality_rating || null,
			wabaId: wabaOk?.id || input.wabaId || null,
			wabaName: wabaOk?.name || null,
		};
	}

	async listMessageTemplates(accessToken: string, wabaId: string) {
		const data = await this.request<{ data?: any[] }>(
			'GET',
			`/${wabaId}/message_templates?limit=100&fields=id,name,language,status,category,components,quality_score`,
			accessToken,
		);
		return (data.data || []).map(t => ({
			name: t.name,
			language: t.language,
			status: t.status,
			category: t.category,
			components: t.components || [],
			id: t.id,
			qualityScore: t.quality_score || null,
		}));
	}

	async uploadTemplateHeaderHandle(
		accessToken: string,
		wabaId: string,
		file: Buffer,
		mimeType: string,
		fileName: string,
	): Promise<string> {
		const sessionPath =
			`/${wabaId}/uploads` +
			`?file_length=${file.length}` +
			`&file_type=${encodeURIComponent(mimeType)}` +
			`&file_name=${encodeURIComponent(fileName || 'sample')}`;
		const session = await this.request<{ id?: string }>('POST', sessionPath, accessToken);
		const uploadId = String(session?.id || '').trim();
		if (!uploadId) {
			throw new BadRequestException('Meta upload session did not return an id');
		}

		const axios = (await import('axios')).default;
		const url = `${this.baseUrl()}/${uploadId.replace(/^\//, '')}`;
		try {
			const res = await axios.post(url, file, {
				headers: {
					Authorization: `OAuth ${accessToken}`,
					file_offset: '0',
					'Content-Type': mimeType,
				},
				maxBodyLength: Infinity,
				maxContentLength: Infinity,
			});
			const handle = res.data?.h;
			if (!handle) {
				throw new BadRequestException('Meta upload did not return a media handle');
			}
			return String(handle);
		} catch (error: any) {
			const message =
				error?.response?.data?.error?.message ||
				error?.message ||
				'Meta template media upload failed';
			this.logger.warn(`Meta template header upload failed: ${message}`);
			throw new BadRequestException(message);
		}
	}

	async createMessageTemplate(
		accessToken: string,
		wabaId: string,
		input: {
			name: string;
			language: string;
			category: string;
			bodyText: string;
			headerFormat?: string;
			headerText?: string;
			headerHandle?: string;
			footerText?: string;
			buttons?: Array<{
				type: string;
				text: string;
				url?: string;
				phone_number?: string;
			}>;
			exampleBodyParams?: string[];
			exampleHeaderParams?: string[];
		},
	) {
		const components: Record<string, any>[] = [];
		const headerFormat = String(input.headerFormat || 'NONE').toUpperCase();
		const bodyText = this.normalizeTemplateText(input.bodyText);
		const headerText = this.normalizeTemplateText(input.headerText || '');
		const footerText = this.normalizeTemplateText(input.footerText || '');

		this.assertTemplatePlaceholders(bodyText, 'body');
		if (headerFormat === 'TEXT' && headerText) {
			this.assertTemplatePlaceholders(headerText, 'header');
			const headerVars = this.positionalVarIndexes(headerText);
			if (headerVars.length > 1) {
				throw new BadRequestException('TEXT header allows only one variable: {{1}}');
			}
		}
		if (footerText && /\{\{/.test(footerText)) {
			throw new BadRequestException('Footer cannot contain variables like {{1}}');
		}

		if (headerFormat === 'TEXT' && headerText) {
			const header: Record<string, any> = {
				type: 'HEADER',
				format: 'TEXT',
				text: headerText,
			};
			const headerVars = this.positionalVarIndexes(headerText);
			if (headerVars.length) {
				const headerExamples = input.exampleHeaderParams?.filter(Boolean) || [];
				header.example = {
					header_text: [
						headerExamples[0] || 'Sample',
					],
				};
			}
			components.push(header);
		} else if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerFormat)) {
			if (!input.headerHandle?.trim()) {
				throw new BadRequestException(
					`Sample ${headerFormat.toLowerCase()} is required for ${headerFormat} header`,
				);
			}
			components.push({
				type: 'HEADER',
				format: headerFormat,
				example: { header_handle: [input.headerHandle.trim()] },
			});
		}

		const body: Record<string, any> = { type: 'BODY', text: bodyText };
		const bodyVars = this.positionalVarIndexes(bodyText);
		if (bodyVars.length) {
			const bodyExamples = input.exampleBodyParams?.filter(Boolean) || [];
			const examples = bodyVars.map(
				(n, i) => bodyExamples[i] || this.sampleExampleValue(n),
			);
			body.example = { body_text: [examples] };
		}
		components.push(body);

		if (footerText) {
			components.push({ type: 'FOOTER', text: footerText });
		}

		const buttons = (input.buttons || [])
			.map(b => ({
				type: String(b.type || '').toUpperCase(),
				text: String(b.text || '').trim().slice(0, 25),
				url: b.url?.trim(),
				phone_number: b.phone_number?.trim(),
			}))
			.filter(b => b.text && ['QUICK_REPLY', 'URL', 'PHONE_NUMBER'].includes(b.type));

		if (buttons.length) {
			if (buttons.length > 10) {
				throw new BadRequestException('Maximum 10 buttons allowed');
			}
			const urlCount = buttons.filter(b => b.type === 'URL').length;
			const phoneCount = buttons.filter(b => b.type === 'PHONE_NUMBER').length;
			const qrCount = buttons.filter(b => b.type === 'QUICK_REPLY').length;
			if (urlCount > 2) throw new BadRequestException('Maximum 2 URL buttons');
			if (phoneCount > 1) throw new BadRequestException('Maximum 1 phone button');
			if (qrCount && (urlCount || phoneCount) && buttons.length > 3) {
				// Meta allows mixing but keeps a practical cap; leave as soft guide
			}
			components.push({
				type: 'BUTTONS',
				buttons: buttons.map(b => {
					if (b.type === 'URL') {
						if (!b.url) throw new BadRequestException('URL button requires a url');
						if (!/^https:\/\//i.test(b.url)) {
							throw new BadRequestException('URL buttons must start with https://');
						}
						this.assertTemplatePlaceholders(b.url, 'button url');
						const btn: Record<string, any> = { type: 'URL', text: b.text, url: b.url };
						if (/\{\{/.test(b.url)) {
							const sample = b.url.replace(/\{\{\s*\d+\s*\}\}/g, 'sample');
							btn.example = [sample];
						}
						return btn;
					}
					if (b.type === 'PHONE_NUMBER') {
						if (!b.phone_number) {
							throw new BadRequestException('Phone button requires phone_number');
						}
						const phone = b.phone_number.replace(/[^\d+]/g, '');
						if (phone.replace(/\D/g, '').length < 8) {
							throw new BadRequestException('Phone button number is invalid');
						}
						return { type: 'PHONE_NUMBER', text: b.text, phone_number: phone };
					}
					return { type: 'QUICK_REPLY', text: b.text };
				}),
			});
		}

		const payload = {
			name: input.name,
			language: input.language,
			category: String(input.category || 'UTILITY').toUpperCase(),
			allow_category_change: true,
			parameter_format: 'positional',
			components,
		};

		this.logger.debug(`Creating Meta template ${input.name}: ${JSON.stringify(payload)}`);
		return this.request<any>('POST', `/${wabaId}/message_templates`, accessToken, payload);
	}

	private normalizeTemplateText(text: string) {
		return String(text || '')
			.replace(/\r\n/g, '\n')
			.replace(/\{\{\s*(\d+)\s*\}\}/g, '{{$1}}')
			.trim();
	}

	private positionalVarIndexes(text: string): number[] {
		return [
			...new Set(
				[...String(text || '').matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map(m => Number(m[1])),
			),
		].sort((a, b) => a - b);
	}

	private assertTemplatePlaceholders(text: string, field: string) {
		const matches = [...String(text || '').matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)];
		for (const m of matches) {
			const token = String(m[1]).trim();
			if (!/^\d+$/.test(token)) {
				throw new BadRequestException(
					`Invalid parameter in ${field}: use {{1}}, {{2}} — not {{${token}}}. Meta rejected named variables.`,
				);
			}
		}
		const indexes = this.positionalVarIndexes(text);
		for (let i = 0; i < indexes.length; i += 1) {
			if (indexes[i] !== i + 1) {
				throw new BadRequestException(
					`Variables in ${field} must be sequential: {{1}}, {{2}}, {{3}}…`,
				);
			}
		}
	}

	private sampleExampleValue(index: number) {
		const samples = ['Ahmed', 'Cairo', 'So7baFit', '12345', 'today'];
		return samples[(index - 1) % samples.length];
	}

	async sendText(accessToken: string, phoneNumberId: string, to: string, text: string) {
		return this.sendMessage(accessToken, phoneNumberId, {
			messaging_product: 'whatsapp',
			recipient_type: 'individual',
			to,
			type: 'text',
			text: { preview_url: true, body: text },
		});
	}

	async sendTemplate(
		accessToken: string,
		phoneNumberId: string,
		to: string,
		templateName: string,
		language: string,
		components?: any[],
	) {
		const template: Record<string, any> = {
			name: templateName,
			language: { code: language || 'en' },
		};
		if (components?.length) template.components = components;
		return this.sendMessage(accessToken, phoneNumberId, {
			messaging_product: 'whatsapp',
			recipient_type: 'individual',
			to,
			type: 'template',
			template,
		});
	}

	async sendImageById(
		accessToken: string,
		phoneNumberId: string,
		to: string,
		mediaId: string,
		caption?: string,
	) {
		return this.sendMessage(accessToken, phoneNumberId, {
			messaging_product: 'whatsapp',
			to,
			type: 'image',
			image: { id: mediaId, ...(caption ? { caption } : {}) },
		});
	}

	async sendAudioById(accessToken: string, phoneNumberId: string, to: string, mediaId: string) {
		return this.sendMessage(accessToken, phoneNumberId, {
			messaging_product: 'whatsapp',
			to,
			type: 'audio',
			audio: { id: mediaId },
		});
	}

	async sendDocumentById(
		accessToken: string,
		phoneNumberId: string,
		to: string,
		mediaId: string,
		filename?: string,
		caption?: string,
	) {
		return this.sendMessage(accessToken, phoneNumberId, {
			messaging_product: 'whatsapp',
			to,
			type: 'document',
			document: {
				id: mediaId,
				...(filename ? { filename } : {}),
				...(caption ? { caption } : {}),
			},
		});
	}

	async uploadMedia(
		accessToken: string,
		phoneNumberId: string,
		file: Buffer,
		mimeType: string,
		fileName: string,
	) {
		const FormData = (await import('form-data')).default;
		const axios = (await import('axios')).default;
		const form = new FormData();
		form.append('messaging_product', 'whatsapp');
		form.append('type', mimeType);
		form.append('file', file, { filename: fileName, contentType: mimeType });

		const url = `${this.baseUrl()}/${phoneNumberId}/media`;
		try {
			const res = await axios.post(url, form, {
				headers: {
					Authorization: `Bearer ${accessToken}`,
					...form.getHeaders(),
				},
				maxBodyLength: Infinity,
				maxContentLength: Infinity,
			});
			const id = res.data?.id;
			if (!id) throw new BadRequestException('Meta media upload did not return an id');
			return { mediaId: id };
		} catch (error: any) {
			const message =
				error?.response?.data?.error?.message ||
				error?.message ||
				'Meta media upload failed';
			this.logger.warn(`Meta media upload failed: ${message}`);
			throw new BadRequestException(message);
		}
	}

	async sendImage(
		accessToken: string,
		phoneNumberId: string,
		to: string,
		link: string,
		caption?: string,
	) {
		return this.sendMessage(accessToken, phoneNumberId, {
			messaging_product: 'whatsapp',
			to,
			type: 'image',
			image: { link, ...(caption ? { caption } : {}) },
		});
	}

	async sendDocument(
		accessToken: string,
		phoneNumberId: string,
		to: string,
		link: string,
		filename?: string,
		caption?: string,
	) {
		return this.sendMessage(accessToken, phoneNumberId, {
			messaging_product: 'whatsapp',
			to,
			type: 'document',
			document: {
				link,
				...(filename ? { filename } : {}),
				...(caption ? { caption } : {}),
			},
		});
	}

	async sendAudio(accessToken: string, phoneNumberId: string, to: string, link: string) {
		return this.sendMessage(accessToken, phoneNumberId, {
			messaging_product: 'whatsapp',
			to,
			type: 'audio',
			audio: { link },
		});
	}

	async markAsRead(accessToken: string, phoneNumberId: string, messageId: string) {
		return this.request(
			'POST',
			`/${phoneNumberId}/messages`,
			accessToken,
			{
				messaging_product: 'whatsapp',
				status: 'read',
				message_id: messageId,
			},
		);
	}

	async getMediaUrl(accessToken: string, mediaId: string) {
		return this.request<{ url?: string; mime_type?: string; file_size?: number }>(
			'GET',
			`/${mediaId}`,
			accessToken,
		);
	}

	async downloadMedia(accessToken: string, mediaUrl: string): Promise<Buffer> {
		const res = await fetch(mediaUrl, {
			headers: { Authorization: `Bearer ${accessToken}` },
		});
		if (!res.ok) {
			throw new ServiceUnavailableException(`Failed to download Meta media (${res.status})`);
		}
		return Buffer.from(await res.arrayBuffer());
	}

	private async sendMessage(accessToken: string, phoneNumberId: string, body: Record<string, any>) {
		const result = await this.request<{
			messages?: Array<{ id: string }>;
			contacts?: Array<{ wa_id?: string; input?: string }>;
		}>('POST', `/${phoneNumberId}/messages`, accessToken, body);
		const wamid = result.messages?.[0]?.id;
		if (!wamid) {
			throw new BadRequestException('Meta Cloud API did not return a message id');
		}
		return {
			wamid,
			waId: result.contacts?.[0]?.wa_id || body.to,
			raw: result,
		};
	}

	private async request<T>(
		method: 'GET' | 'POST',
		path: string,
		accessToken: string,
		body?: Record<string, any>,
	): Promise<T> {
		const url = `${this.baseUrl()}${path}`;
		const init: RequestInit = {
			method,
			headers: {
				Authorization: `Bearer ${accessToken}`,
				...(body ? { 'Content-Type': 'application/json' } : {}),
			},
			...(body ? { body: JSON.stringify(body) } : {}),
		};

		let res: Response;
		try {
			res = await fetch(url, init);
		} catch (error) {
			this.logger.warn(`Meta Graph request failed: ${error instanceof Error ? error.message : error}`);
			throw new ServiceUnavailableException('Unable to reach Meta Graph API');
		}

		const json = (await res.json().catch(() => ({}))) as T & { error?: MetaGraphError };
		if (!res.ok || json.error) {
			const err = json.error;
			const details =
				err?.error_data?.details ||
				err?.error_user_msg ||
				err?.error_user_title ||
				'';
			const message =
				err?.message ||
				`Meta Graph API error (${res.status})`;
			const fullMessage = details ? `${message} — ${details}` : message;
			const withHint =
				!details && /invalid parameter/i.test(message)
					? `${fullMessage} — Check variables (use {{1}}, {{2}} not {{name}}), https:// URL buttons, no variables in footer, and TEXT header max one {{1}}.`
					: fullMessage;
			this.logger.warn(
				`Meta Graph ${method} ${path}: ${withHint}` +
					(err?.code != null ? ` (code=${err.code}` : '') +
					(err?.error_subcode != null ? ` subcode=${err.error_subcode}` : '') +
					(err?.code != null ? ')' : '') +
					(err?.fbtrace_id ? ` fbtrace=${err.fbtrace_id}` : ''),
			);
			throw new BadRequestException(withHint);
		}
		return json;
	}
}
