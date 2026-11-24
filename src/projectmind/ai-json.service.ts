import { Injectable } from '@nestjs/common';
import { AiService } from '../ai/ai.service';
import { PM_AI_FEATURE } from './projectmind.constants';

/** Thin wrapper: one AI call that must return a JSON object. Errors from the shared AiService propagate unchanged. */
@Injectable()
export class AiJsonService {
	constructor(private readonly ai: AiService) {}

	async object(user: any, system: string, prompt: string, maxTokens = 1500): Promise<Record<string, any> | null> {
		const res: any = await this.ai.generateText({ prompt, system, feature: PM_AI_FEATURE as any, user, maxTokens, temperature: 0.3 });
		const text = String(res?.text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
		const s = text.indexOf('{');
		const e = text.lastIndexOf('}');
		if (s < 0 || e <= s) return null;
		try {
			const o = JSON.parse(text.slice(s, e + 1));
			return o && typeof o === 'object' ? o : null;
		} catch {
			return null;
		}
	}
}
