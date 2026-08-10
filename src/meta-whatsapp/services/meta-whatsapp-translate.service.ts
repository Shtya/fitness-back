import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

const ARABIC_RE = /[\u0600-\u06FF]/;
const MAX_CHARS = 4500;

export type TranslateResult = {
	translatedText: string;
	sourceLang: 'ar' | 'en';
	targetLang: 'ar' | 'en';
	provider: string;
};

@Injectable()
export class MetaWhatsAppTranslateService {
	private readonly logger = new Logger(MetaWhatsAppTranslateService.name);

	detectDirection(text: string): { sourceLang: 'ar' | 'en'; targetLang: 'ar' | 'en' } {
		const sourceLang = ARABIC_RE.test(text) ? 'ar' : 'en';
		return { sourceLang, targetLang: sourceLang === 'ar' ? 'en' : 'ar' };
	}

	async translate(text: string, targetLang?: 'ar' | 'en'): Promise<TranslateResult> {
		const cleaned = String(text || '').trim();
		if (!cleaned) throw new BadRequestException('text is required');
		if (cleaned.length > MAX_CHARS) {
			return this.translateLong(cleaned, targetLang);
		}

		const detected = this.detectDirection(cleaned);
		const sourceLang = detected.sourceLang;
		const to = targetLang === 'ar' || targetLang === 'en' ? targetLang : detected.targetLang;
		if (to === sourceLang) {
			return {
				translatedText: cleaned,
				sourceLang,
				targetLang: to,
				provider: 'passthrough',
			};
		}

		try {
			return await this.translateMyMemory(cleaned, sourceLang, to);
		} catch (err: any) {
			this.logger.warn(`MyMemory failed: ${err?.message || err}`);
		}

		try {
			return await this.translateGoogleGtx(cleaned, sourceLang, to);
		} catch (err: any) {
			this.logger.warn(`Google gtx failed: ${err?.message || err}`);
			throw new BadRequestException('Translation failed. Try again in a moment.');
		}
	}

	/** Free MT for long bodies — chunks under MyMemory/gtx limits. */
	async translateLong(text: string, targetLang?: 'ar' | 'en'): Promise<TranslateResult> {
		const cleaned = String(text || '').trim();
		if (!cleaned) throw new BadRequestException('text is required');

		const detected = this.detectDirection(cleaned);
		const sourceLang = detected.sourceLang;
		const to = targetLang === 'ar' || targetLang === 'en' ? targetLang : detected.targetLang;
		if (to === sourceLang) {
			return {
				translatedText: cleaned,
				sourceLang,
				targetLang: to,
				provider: 'passthrough',
			};
		}

		const chunks = this.chunkText(cleaned, 4000);
		const translatedParts: string[] = [];
		let provider = 'passthrough';
		for (let i = 0; i < chunks.length; i += 1) {
			const part = chunks[i];
			if (part.length <= MAX_CHARS) {
				const result = await this.translate(part, to);
				translatedParts.push(result.translatedText);
				provider = result.provider;
			} else {
				// Hard split if a single paragraph exceeds the cap
				for (const sub of this.hardSplit(part, 4000)) {
					const result = await this.translate(sub, to);
					translatedParts.push(result.translatedText);
					provider = result.provider;
				}
			}
			if (i < chunks.length - 1) {
				await new Promise(resolve => setTimeout(resolve, 120));
			}
		}

		return {
			translatedText: translatedParts.join('\n\n').trim(),
			sourceLang,
			targetLang: to,
			provider,
		};
	}

	private chunkText(text: string, maxLen: number): string[] {
		if (text.length <= maxLen) return [text];
		const paragraphs = text.split(/\n{2,}/);
		const chunks: string[] = [];
		let current = '';
		for (const paragraph of paragraphs) {
			const next = current ? `${current}\n\n${paragraph}` : paragraph;
			if (next.length <= maxLen) {
				current = next;
				continue;
			}
			if (current) chunks.push(current);
			if (paragraph.length <= maxLen) {
				current = paragraph;
			} else {
				chunks.push(...this.hardSplit(paragraph, maxLen));
				current = '';
			}
		}
		if (current) chunks.push(current);
		return chunks.length ? chunks : [text.slice(0, maxLen)];
	}

	private hardSplit(text: string, maxLen: number): string[] {
		const out: string[] = [];
		for (let i = 0; i < text.length; i += maxLen) {
			out.push(text.slice(i, i + maxLen));
		}
		return out;
	}

	private async translateMyMemory(
		text: string,
		sourceLang: 'ar' | 'en',
		targetLang: 'ar' | 'en',
	): Promise<TranslateResult> {
		const { data } = await axios.get('https://api.mymemory.translated.net/get', {
			params: {
				q: text,
				langpair: `${sourceLang}|${targetLang}`,
			},
			timeout: 15000,
			validateStatus: s => s >= 200 && s < 500,
		});

		const translated = String(data?.responseData?.translatedText || '').trim();
		const status = Number(data?.responseStatus);
		if (!translated || (status && status !== 200)) {
			throw new Error(data?.responseDetails || 'MyMemory empty response');
		}
		// MyMemory sometimes returns the same string / quota message
		if (/MYMEMORY WARNING/i.test(translated)) {
			throw new Error(translated);
		}

		return {
			translatedText: translated,
			sourceLang,
			targetLang,
			provider: 'mymemory',
		};
	}

	private async translateGoogleGtx(
		text: string,
		sourceLang: 'ar' | 'en',
		targetLang: 'ar' | 'en',
	): Promise<TranslateResult> {
		const { data } = await axios.get('https://translate.googleapis.com/translate_a/single', {
			params: {
				client: 'gtx',
				sl: sourceLang,
				tl: targetLang,
				dt: 't',
				q: text,
			},
			timeout: 15000,
		});

		const parts = Array.isArray(data?.[0]) ? data[0] : [];
		const translated = parts
			.map((chunk: any) => (Array.isArray(chunk) ? String(chunk[0] || '') : ''))
			.join('')
			.trim();
		if (!translated) throw new Error('Google gtx empty response');

		return {
			translatedText: translated,
			sourceLang,
			targetLang,
			provider: 'google-gtx',
		};
	}
}
