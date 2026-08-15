import { Injectable } from '@nestjs/common';
import { AiFreeService } from '../../ai-free/ai-free.service';
import { User } from '../../../entities/global.entity';
import { GoldIntelligenceService } from './intelligence.service';

const GROUNDING = `You are a gold research analyst. Use ONLY the supplied JSON facts.
Never invent prices, sources, forecasts, CFTC numbers, ETF flows, or central-bank purchases.
If a field is missing/unavailable/licensed, say so.
Always distinguish MODEL OUTPUT from financial advice.
Never claim certainty or 90%+ accuracy.`;

@Injectable()
export class GoldResearchService {
  constructor(
    private readonly intelligence: GoldIntelligenceService,
    private readonly aiFree: AiFreeService,
  ) {}

  async answer(user: User, question: string, useLlm = true) {
    const data = await this.intelligence.intelligence(false, user?.id);
    const facts = {
      price: data.price,
      decision: data.decision,
      forecast: data.forecast,
      macro: data.macro,
      positioning: data.positioning,
      technical: {
        bias: data.technical?.bias,
        score: data.technical?.score,
        rsi: data.technical?.rsi,
        sma50: data.technical?.sma50,
        sma200: data.technical?.sma200,
        nearestSupport: data.technical?.nearestSupport,
        nearestResistance: data.technical?.nearestResistance,
      },
      news: (data.news?.items || []).slice(0, 8),
      egypt: data.egypt,
      similar: data.forecast?.similar,
      limitations: data.data_quality?.limitations,
      why: data.why,
    };
    const deterministic = this.deterministic(question, data);
    if (!useLlm) {
      return { mode: 'facts', answer: deterministic, facts };
    }
    try {
      const locale = /[\u0600-\u06FF]/.test(question) ? 'ar' : 'en';
      const result = await this.aiFree.chat(user, {
        messages: [
          { role: 'system', content: GROUNDING },
          {
            role: 'user',
            content: `Locale: ${locale}\nQuestion: ${question}\n\nFacts JSON:\n${JSON.stringify(facts).slice(0, 6500)}`,
          },
        ],
        useProjectKnowledge: false,
      });
      return {
        mode: 'llm-grounded',
        answer: result.reply,
        provider: result.provider,
        facts,
        fallback: deterministic,
      };
    } catch {
      return { mode: 'facts', answer: deterministic, facts };
    }
  }

  private deterministic(question: string, data: any): string {
    const q = question.toLowerCase();
    if (q.includes('egypt') || q.includes('مصر') || q.includes('21')) {
      if (!data.egypt) return 'Egyptian theoretical prices are unavailable until both XAU/USD and USD/EGP are ingested.';
      return `Theoretical 21K is ${data.egypt.k21.toFixed(2)} EGP/gram from XAU/USD ${data.egypt.xauUsd} × USD/EGP ${data.egypt.usdEgp} ÷ 31.1034768 × 0.875. Local premium requires you to enter the dealer price.`;
    }
    if (q.includes('fall') || q.includes('يهبط') || q.includes('bear')) {
      return (data.risks?.bearishCatalysts || []).join('; ') || 'No stored bearish catalysts.';
    }
    if (q.includes('histor') || q.includes('similar') || q.includes('تاريخ')) {
      return data.forecast?.similar?.note || 'Similar-period sample is still warming up.';
    }
    return data.why?.en || 'No explanation until a valid price exists.';
  }
}
