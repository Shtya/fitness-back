import {
	BadRequestException,
	Injectable,
	Logger,
	ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import FormData = require('form-data');
import axios from 'axios';

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
		let phone: {
			id?: string;
			display_phone_number?: string;
			verified_name?: string;
			quality_rating?: string;
			whatsapp_business_account?: { id?: string; name?: string };
		};
		try {
			phone = await this.request(
				'GET',
				`/${input.phoneNumberId}?fields=id,display_phone_number,verified_name,quality_rating,whatsapp_business_account{id,name}`,
				input.accessToken,
			);
		} catch (err: any) {
			throw new BadRequestException(
				this.explainWhatsAppAccessError(this.errText(err), {
					phoneNumberId: input.phoneNumberId,
					wabaId: input.wabaId,
					stage: 'phone',
				}),
			);
		}

		const resolvedFromPhone = phone.whatsapp_business_account?.id || null;
		let configuredWaba = String(input.wabaId || '').trim() || null;

		// Common mistake: Phone Number ID pasted into WABA ID field
		if (configuredWaba && configuredWaba === String(input.phoneNumberId).trim()) {
			configuredWaba = null;
		}

		let wabaOk: { id?: string; name?: string } | null = null;
		const wabaToCheck = configuredWaba || resolvedFromPhone;
		if (wabaToCheck) {
			try {
				wabaOk = await this.request(
					'GET',
					`/${wabaToCheck}?fields=id,name`,
					input.accessToken,
				);
			} catch (err) {
				if (resolvedFromPhone && configuredWaba && configuredWaba !== resolvedFromPhone) {
					try {
						wabaOk = await this.request(
							'GET',
							`/${resolvedFromPhone}?fields=id,name`,
							input.accessToken,
						);
					} catch (err2: any) {
						throw new BadRequestException(
							this.explainWhatsAppAccessError(this.errText(err2), {
								phoneNumberId: input.phoneNumberId,
								wabaId: resolvedFromPhone,
								stage: 'waba',
							}),
						);
					}
				} else {
					throw new BadRequestException(
						this.explainWhatsAppAccessError(this.errText(err), {
							phoneNumberId: input.phoneNumberId,
							wabaId: wabaToCheck,
							stage: 'waba',
						}),
					);
				}
			}
		}

		const finalWabaId = wabaOk?.id || resolvedFromPhone || configuredWaba || null;

		// Prove the token can list templates on this WABA (catches missing whatsapp_business_management)
		if (finalWabaId) {
			try {
				await this.request(
					'GET',
					`/${finalWabaId}/message_templates?limit=1&fields=id,name`,
					input.accessToken,
				);
			} catch (err: any) {
				throw new BadRequestException(
					this.explainWhatsAppAccessError(this.errText(err), {
						phoneNumberId: input.phoneNumberId,
						wabaId: finalWabaId,
						stage: 'templates',
					}),
				);
			}
		}

		return {
			phoneNumberId: phone.id || input.phoneNumberId,
			displayPhoneNumber: phone.display_phone_number || null,
			verifiedName: phone.verified_name || null,
			qualityRating: phone.quality_rating || null,
			wabaId: finalWabaId,
			wabaName: wabaOk?.name || phone.whatsapp_business_account?.name || null,
			wabaAutoResolved:
				Boolean(resolvedFromPhone) &&
				(!input.wabaId ||
					String(input.wabaId).trim() !== finalWabaId ||
					String(input.wabaId).trim() === String(input.phoneNumberId).trim()),
		};
	}

	errText(err: unknown) {
		const response =
			typeof (err as any)?.getResponse === 'function' ? (err as any).getResponse() : null;
		const raw =
			typeof response === 'string'
				? response
				: response?.message || (err as any)?.message || '';
		return Array.isArray(raw) ? raw.join(', ') : String(raw);
	}

	explainWhatsAppAccessError(
		metaMessage: string,
		ctx: { phoneNumberId?: string | null; wabaId?: string | null; stage?: string },
	) {
		const phone = ctx.phoneNumberId || '—';
		const waba = ctx.wabaId || '—';
		const base = metaMessage || 'Meta Graph access failed';

		// Don't wrap clear API validation / parameter errors as "token assignment" issues
		if (
			/#100\b/i.test(base) ||
			/invalid parameter/i.test(base) ||
			/hsm_id requires name/i.test(base) ||
			/button input/i.test(base) ||
			/library buttons/i.test(base) ||
			/does not exist/i.test(base) ||
			/already exists/i.test(base) ||
			/\(#\d+\)/.test(base)
		) {
			return base;
		}

		return (
			`${base} ` +
			`Your Phone Number ID (${phone}) and WABA ID (${waba}) look like Meta dashboard values, ` +
			`but this Access Token cannot use them. Fix the token: ` +
			`1) Meta Business Suite → Business Settings → System Users → generate a permanent token for THIS app, ` +
			`2) assign the WhatsApp Business Account "So7bahfit" (${waba}) to that system user with full control, ` +
			`3) include permissions whatsapp_business_management + whatsapp_business_messaging (+ business_management). ` +
			`Then paste the new token, Save, and Verify connection.`
		);
	}

	/**
	 * Ensure we have a real WhatsApp Business Account ID (not Phone Number ID).
	 * Resolves from the phone number when missing/wrong.
	 */
	async resolveWabaId(input: {
		accessToken: string;
		phoneNumberId: string;
		wabaId?: string | null;
	}): Promise<{ wabaId: string; autoResolved: boolean }> {
		const phoneId = String(input.phoneNumberId || '').trim();
		let wabaId = String(input.wabaId || '').trim();
		if (wabaId && wabaId === phoneId) wabaId = '';

		if (wabaId) {
			return { wabaId, autoResolved: false };
		}

		const phone = await this.request<{
			whatsapp_business_account?: { id?: string };
		}>(
			'GET',
			`/${phoneId}?fields=whatsapp_business_account{id}`,
			input.accessToken,
		);
		const resolved = String(phone.whatsapp_business_account?.id || '').trim();
		if (!resolved) {
			throw new BadRequestException(
				'Could not resolve WABA ID from Phone Number ID. In Meta Developer → WhatsApp → API Setup, copy the WhatsApp Business Account ID (not Phone Number ID) into WABA ID.',
			);
		}
		return { wabaId: resolved, autoResolved: true };
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

	/**
	 * Meta Template Library — pre-written UTILITY/AUTHENTICATION templates.
	 * GET /message_template_library
	 */
	async listTemplateLibrary(
		accessToken: string,
		options?: { search?: string; language?: string; limit?: number },
	) {
		const params = new URLSearchParams();
		params.set('limit', String(Math.min(Math.max(options?.limit || 40, 1), 100)));
		if (options?.search?.trim()) params.set('search', options.search.trim());
		if (options?.language?.trim()) params.set('language', options.language.trim());
		const data = await this.request<{ data?: any[]; paging?: any }>(
			'GET',
			`/message_template_library?${params.toString()}`,
			accessToken,
		);
		return (data.data || []).map(t => ({
			libraryTemplateName: t.name,
			name: t.name,
			language: t.language,
			category: t.category || 'UTILITY',
			topic: t.topic || null,
			usecase: t.usecase || null,
			industry: t.industry || [],
			body: t.body || t.body_text || '',
			bodyParams: t.body_params || t.body_param_types || [],
			header: t.header || t.header_text || null,
			footer: t.footer || t.footer_text || null,
			buttons: t.buttons || [],
			raw: t,
		}));
	}

	async createMessageTemplateFromLibrary(
		accessToken: string,
		wabaId: string,
		input: {
			name: string;
			language: string;
			category?: string;
			libraryTemplateName: string;
			libraryTemplateButtonInputs?: any[];
			buttons?: any[];
			buttonUrl?: string;
			buttonPhone?: string;
		},
	) {
		const payload: Record<string, any> = {
			name: String(input.name || '').trim(),
			language: String(input.language || 'en_US').trim(),
			category: String(input.category || 'UTILITY').toUpperCase(),
			library_template_name: String(input.libraryTemplateName || '').trim(),
		};

		const buttonInputs =
			input.libraryTemplateButtonInputs?.length
				? input.libraryTemplateButtonInputs
				: this.buildLibraryTemplateButtonInputs(input.buttons || [], {
						url: input.buttonUrl,
						phone: input.buttonPhone,
				  });

		if (buttonInputs.length) {
			payload.library_template_button_inputs = buttonInputs;
		}

		this.logger.debug(
			`Creating Meta library template ${payload.name} from ${payload.library_template_name}` +
				(buttonInputs.length ? ` with ${buttonInputs.length} button input(s)` : ''),
		);
		return this.request<any>('POST', `/${wabaId}/message_templates`, accessToken, payload);
	}

	/**
	 * Meta requires library_template_button_inputs for library buttons that take
	 * business-specific values (URL / PHONE_NUMBER / OTP). Count must match.
	 */
	buildLibraryTemplateButtonInputs(
		buttons: any[],
		defaults?: { url?: string; phone?: string },
	): any[] {
		const list = Array.isArray(buttons) ? buttons : [];
		const site = String(defaults?.url || process.env.PUBLIC_WEB_URL || 'https://so7bafit.com')
			.trim()
			.replace(/\/$/, '');
		const httpsSite = /^https:\/\//i.test(site) ? site : `https://${site.replace(/^https?:\/\//i, '')}`;
		let phone = String(defaults?.phone || '').replace(/[^\d+]/g, '');
		if (phone && !phone.startsWith('+')) phone = `+${phone}`;
		if (!phone) phone = '+201000000000';

		const inputs: any[] = [];
		for (const btn of list) {
			const type = String(btn?.type || btn?.button_type || '').toUpperCase();
			if (type === 'URL' || type === 'VISIT_WEBSITE') {
				const fromBtn = String(btn?.url || btn?.example || '').trim();
				const base =
					fromBtn && /^https:\/\//i.test(fromBtn)
						? fromBtn.replace(/\{\{.*?\}\}/g, '{{1}}')
						: `${httpsSite}/{{1}}`;
				const withVar = /\{\{/.test(base) ? base : `${base.replace(/\/$/, '')}/{{1}}`;
				inputs.push({
					type: 'URL',
					url: {
						base_url: withVar,
						url_suffix_example: withVar.replace(/\{\{\s*\d+\s*\}\}/g, 'demo'),
					},
				});
			} else if (
				type === 'PHONE_NUMBER' ||
				type === 'CALL' ||
				type === 'CALL_PHONE_NUMBER' ||
				type === 'VOICE_CALL'
			) {
				const fromBtn = String(btn?.phone_number || btn?.phone || '').replace(/[^\d+]/g, '');
				const value = fromBtn
					? fromBtn.startsWith('+')
						? fromBtn
						: `+${fromBtn}`
					: phone;
				inputs.push({ type: 'PHONE_NUMBER', phone_number: value });
			} else if (type === 'OTP') {
				inputs.push({
					type: 'OTP',
					otp_type: String(btn?.otp_type || 'COPY_CODE').toUpperCase(),
					zero_tap_terms_accepted: true,
				});
			}
			// QUICK_REPLY / CATALOG / FLOW / etc. typically need no button inputs
		}
		return inputs;
	}

	async deleteMessageTemplate(
		accessToken: string,
		wabaId: string,
		input: { name?: string; hsmId?: string },
	) {
		const name = String(input.name || '').trim();
		const hsmId = String(input.hsmId || '').trim();
		// Meta: deleting by hsm_id ALSO requires name — name alone deletes all languages for that template
		if (!name) {
			throw new BadRequestException('Template name is required to delete');
		}
		const params = new URLSearchParams();
		params.set('name', name);
		if (hsmId) params.set('hsm_id', hsmId);
		return this.request<{ success?: boolean }>(
			'DELETE',
			`/${wabaId}/message_templates?${params.toString()}`,
			accessToken,
		);
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
			existingHeaderComponent?: Record<string, any>;
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
		const components = this.buildMessageTemplateComponents(input);
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

	async editMessageTemplate(
		accessToken: string,
		templateId: string,
		input: {
			category?: string;
			bodyText: string;
			headerFormat?: string;
			headerText?: string;
			headerHandle?: string;
			existingHeaderComponent?: Record<string, any>;
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
		const id = String(templateId || '').trim();
		if (!id) throw new BadRequestException('Template id is required to edit');
		const components = this.buildMessageTemplateComponents(input);
		// Meta forbids changing category on APPROVED templates (#100).
		// Edits only update components — never send category / allow_category_change.
		const payload = { components };
		this.logger.debug(`Editing Meta template ${id}: ${JSON.stringify(payload)}`);
		return this.request<any>('POST', `/${id}`, accessToken, payload);
	}

	buildMessageTemplateComponents(input: {
		bodyText: string;
		headerFormat?: string;
		headerText?: string;
		headerHandle?: string;
		existingHeaderComponent?: Record<string, any>;
		footerText?: string;
		buttons?: Array<{
			type: string;
			text: string;
			url?: string;
			phone_number?: string;
		}>;
		exampleBodyParams?: string[];
		exampleHeaderParams?: string[];
	}) {
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
					header_text: [headerExamples[0] || 'Sample'],
				};
			}
			components.push(header);
		} else if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerFormat)) {
			if (input.headerHandle?.trim()) {
				components.push({
					type: 'HEADER',
					format: headerFormat,
					example: { header_handle: [input.headerHandle.trim()] },
				});
			} else if (input.existingHeaderComponent) {
				components.push(input.existingHeaderComponent);
			} else {
				throw new BadRequestException(
					`Sample ${headerFormat.toLowerCase()} is required for ${headerFormat} header`,
				);
			}
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
			if (urlCount > 2) throw new BadRequestException('Maximum 2 URL buttons');
			if (phoneCount > 1) throw new BadRequestException('Maximum 1 phone button');
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

		return components;
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

	async sendVideoById(
		accessToken: string,
		phoneNumberId: string,
		to: string,
		mediaId: string,
		caption?: string,
	) {
		return this.sendMessage(accessToken, phoneNumberId, {
			messaging_product: 'whatsapp',
			to,
			type: 'video',
			video: { id: mediaId, ...(caption ? { caption } : {}) },
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

	/**
	 * Messaging analytics on WABA:
	 * fields=analytics.start(...).end(...).granularity(DAY)
	 */
	async getMessagingAnalytics(
		accessToken: string,
		wabaId: string,
		startUnix: number,
		endUnix: number,
		granularity: 'HALF_HOUR' | 'DAY' | 'MONTH' = 'DAY',
	) {
		const fields = `analytics.start(${startUnix}).end(${endUnix}).granularity(${granularity})`;
		return this.request<any>('GET', `/${wabaId}?fields=${fields}`, accessToken);
	}

	/**
	 * Per-message pricing analytics (July 2025+ model):
	 * fields=pricing_analytics.start(...).end(...).granularity(DAILY).dimensions(...)
	 */
	async getPricingAnalytics(
		accessToken: string,
		wabaId: string,
		startUnix: number,
		endUnix: number,
		granularity: 'HALF_HOUR' | 'DAILY' | 'MONTHLY' = 'DAILY',
	) {
		const fields =
			`pricing_analytics.start(${startUnix}).end(${endUnix})` +
			`.granularity(${granularity})` +
			`.dimensions(PRICING_CATEGORY,PRICING_TYPE,COUNTRY)` +
			`.metric_types(COST,VOLUME)`;
		return this.request<any>('GET', `/${wabaId}?fields=${fields}`, accessToken);
	}

	/**
	 * Template analytics (sent/delivered/read/cost) — requires analytics enablement on WABA.
	 */
	async getTemplateAnalytics(
		accessToken: string,
		wabaId: string,
		startUnix: number,
		endUnix: number,
		templateIds?: string[],
	) {
		let fields = `template_analytics.start(${startUnix}).end(${endUnix}).granularity(DAILY)`;
		if (templateIds?.length) {
			fields += `.template_ids([${templateIds.slice(0, 10).join(',')}])`;
		}
		return this.request<any>('GET', `/${wabaId}?fields=${fields}`, accessToken);
	}

	private async request<T>(
		method: 'GET' | 'POST' | 'DELETE',
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
			const codePrefix =
				err?.code != null ? `(#${err.code}) ` : '';
			const message =
				err?.message ||
				`Meta Graph API error (${res.status})`;
			const coded = message.startsWith('(#') ? message : `${codePrefix}${message}`;
			const fullMessage = details ? `${coded} — ${details}` : coded;
			let withHint = fullMessage;
			if (/131058/.test(String(err?.code)) || /hello world templates can only be sent/i.test(fullMessage)) {
				withHint = `${fullMessage} — hello_world only works from Meta Public Test Numbers. Use your own APPROVED template on a live phone number, or send from the Meta test number in API Setup.`;
			} else if (/132018/.test(String(err?.code)) || /URL parameter generates an invalid URL/i.test(fullMessage)) {
				withHint = `${fullMessage} — URL button variables must be Latin/URL-safe only (e.g. demo or user/123). Do not put Arabic text, spaces, or a full URL in that field.`;
			} else if (
				/cannot update an approved template category/i.test(fullMessage) ||
				(/100/.test(String(err?.code)) && /template category/i.test(fullMessage))
			) {
				withHint = `${fullMessage} — Category cannot be changed after Meta approves a template. Edit body/header/buttons only, or create a new template with a different category.`;
			} else if (!details && /invalid parameter/i.test(message)) {
				withHint = `${fullMessage} — Check variables (use {{1}}, {{2}} not {{name}}), https:// URL buttons, no variables in footer, and TEXT header max one {{1}}.`;
			}
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
