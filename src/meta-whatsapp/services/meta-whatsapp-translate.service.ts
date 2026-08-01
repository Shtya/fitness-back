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
			throw new BadRequestException(`text must be at most ${MAX_CHARS} characters`);
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
