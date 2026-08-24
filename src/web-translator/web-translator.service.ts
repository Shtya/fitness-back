import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import axios from "axios";
import { User } from "entities/global.entity";
import { IsNull, Repository } from "typeorm";
import { AuthService } from "../auth/auth.service";
import { AiService } from "../ai/ai.service";
import { MetaWhatsAppTranslateService } from "../meta-whatsapp/services/meta-whatsapp-translate.service";
import {
  ExchangePairingDto,
  LookupDto,
  SaveWordDto,
  UpdateSettingsDto,
} from "./dto/web-translator.dto";
import {
  WebTranslatorLookup,
  WebTranslatorPairing,
  WebTranslatorSettings,
  WebTranslatorWord,
} from "./entities/web-translator.entity";
import {
  detectLang,
  hashPairingCode,
  isSingleWord,
  normalizeLookupText,
  parseAiEnrichment,
  parseDictionaryEntry,
  randomPairingCode,
  uniquenessKey,
  websiteOrigin,
} from "./web-translator.util";

const LOOKUP_WINDOW_MS = 60_000;
const LOOKUP_MAX = 40;
const PAIRING_TTL_MS = 10 * 60 * 1000;
const EXCHANGE_WINDOW_MS = 10 * 60 * 1000;
const EXCHANGE_MAX = 8;

@Injectable()
export class WebTranslatorService {
  private readonly logger = new Logger(WebTranslatorService.name);
  private readonly lookupHits = new Map<string, number[]>();
  private readonly exchangeHits = new Map<string, number[]>();

  constructor(
    @InjectRepository(WebTranslatorWord)
    private readonly words: Repository<WebTranslatorWord>,
    @InjectRepository(WebTranslatorLookup)
    private readonly lookups: Repository<WebTranslatorLookup>,
    @InjectRepository(WebTranslatorSettings)
    private readonly settings: Repository<WebTranslatorSettings>,
    @InjectRepository(WebTranslatorPairing)
    private readonly pairings: Repository<WebTranslatorPairing>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly translator: MetaWhatsAppTranslateService,
    private readonly auth: AuthService,
    @Optional() private readonly ai?: AiService,
  ) {}

  async me(user: User) {
    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      settings: await this.getOrCreateSettings(user.id),
      websiteUrl: websiteOrigin(),
    };
  }

  async lookup(user: User, dto: LookupDto) {
    this.hit(
      this.lookupHits,
      user.id,
      LOOKUP_WINDOW_MS,
      LOOKUP_MAX,
      "Too many translations. Wait a minute.",
    );
    const text = normalizeLookupText(dto.text);
    if (!text) throw new BadRequestException("text is required");

    const settings = await this.getOrCreateSettings(user.id);
    const preferredTarget =
      dto.targetLang || (settings.targetLang === "en" ? "en" : "ar");
    const forcedSource =
      dto.sourceLang && dto.sourceLang !== "auto" ? dto.sourceLang : null;
    const sourceLang = forcedSource || detectLang(text);
    const targetLang =
      preferredTarget === sourceLang
        ? sourceLang === "ar"
          ? "en"
          : "ar"
        : preferredTarget;

    const translated = await this.translator.translate(text, targetLang);
    let pronunciation: string | null = null;
    let partOfSpeech: string | null = null;
    let example: string | null = null;

    if (isSingleWord(text) && sourceLang === "en") {
      const dict = await this.dictionary(text);
      pronunciation = dict.pronunciation;
      partOfSpeech = dict.partOfSpeech;
      example = dict.example;
    }
    if (!partOfSpeech || !example) {
      const extra = await this.enrichWithAi(
        user,
        text,
        translated.translatedText,
        sourceLang,
        targetLang,
      );
      pronunciation = pronunciation || extra.pronunciation;
      partOfSpeech = partOfSpeech || extra.partOfSpeech;
      example = example || extra.example;
    }

    const saved = await this.words.findOne({
      where: {
        userId: user.id,
        normalizedText: uniquenessKey(text),
        sourceLang,
        targetLang,
      },
    });

    await this.lookups.save(
      this.lookups.create({
        userId: user.id,
        wordId: saved?.id || null,
        text,
        translation: translated.translatedText,
        sourceLang,
        targetLang,
        pronunciation,
        partOfSpeech,
        example,
        sourceUrl: dto.sourceUrl || null,
      }),
    );

    return {
      text,
      translation: translated.translatedText,
      sourceLang,
      targetLang,
      pronunciation,
      partOfSpeech,
      example,
      provider: translated.provider,
      saved: Boolean(saved),
      savedId: saved?.id || null,
      websitePath: saved
        ? `/dashboard/web-translator/words/${saved.id}`
        : "/dashboard/web-translator",
    };
  }

  async saveWord(user: User, dto: SaveWordDto) {
    const text = normalizeLookupText(dto.text);
    if (!text) throw new BadRequestException("text is required");
    const sourceLang = dto.sourceLang || detectLang(text);
    const targetLang = dto.targetLang || (sourceLang === "ar" ? "en" : "ar");
    let translation = normalizeLookupText(dto.translation || "");
    if (!translation) {
      translation = (await this.translator.translate(text, targetLang))
        .translatedText;
    }

    let row = await this.words.findOne({
      where: {
        userId: user.id,
        normalizedText: uniquenessKey(text),
        sourceLang,
        targetLang,
      },
    });
    if (!row) {
      row = this.words.create({
        userId: user.id,
        text,
        normalizedText: uniquenessKey(text),
        translation,
        sourceLang,
        targetLang,
        lookupCount: 1,
      });
    } else {
      row.lookupCount = (row.lookupCount || 0) + 1;
      row.text = text;
      row.translation = translation;
    }
    row.pronunciation = dto.pronunciation ?? row.pronunciation ?? null;
    row.partOfSpeech = dto.partOfSpeech ?? row.partOfSpeech ?? null;
    row.example = dto.example ?? row.example ?? null;
    row.sourceUrl = dto.sourceUrl ?? row.sourceUrl ?? null;
    row.sourceTitle = dto.sourceTitle ?? row.sourceTitle ?? null;
    return this.toWordDto(await this.words.save(row));
  }

  async listWords(user: User, q?: string, page = 1, limit = 30) {
    const take = Math.min(100, Math.max(1, Number(limit) || 30));
    const skip = (Math.max(1, Number(page) || 1) - 1) * take;
    const qb = this.words
      .createQueryBuilder("w")
      .where("w.userId = :userId", { userId: user.id });
    const query = String(q || "").trim();
    if (query) {
      qb.andWhere("(w.text ILIKE :q OR w.translation ILIKE :q)", {
        q: `%${query}%`,
      });
    }
    const [items, total] = await qb
      .orderBy("w.updatedAt", "DESC")
      .skip(skip)
      .take(take)
      .getManyAndCount();
    return {
      items: items.map((row) => this.toWordDto(row)),
      total,
      page: Math.max(1, Number(page) || 1),
      limit: take,
    };
  }

  async getWord(user: User, id: string) {
    const row = await this.words.findOne({ where: { id, userId: user.id } });
    if (!row) throw new NotFoundException("Word not found");
    return this.toWordDto(row);
  }

  async deleteWord(user: User, id: string) {
    const row = await this.words.findOne({ where: { id, userId: user.id } });
    if (!row) throw new NotFoundException("Word not found");
    await this.words.delete({ id: row.id, userId: user.id });
    return { ok: true };
  }

  async recent(user: User, limit = 20) {
    const take = Math.min(50, Math.max(1, Number(limit) || 20));
    const rows = await this.lookups.find({
      where: { userId: user.id },
      order: { createdAt: "DESC" },
      take,
    });
    return {
      items: rows.map((row) => ({
        id: row.id,
        wordId: row.wordId,
        text: row.text,
        translation: row.translation,
        sourceLang: row.sourceLang,
        targetLang: row.targetLang,
        pronunciation: row.pronunciation,
        partOfSpeech: row.partOfSpeech,
        example: row.example,
        createdAt: row.createdAt,
        websitePath: row.wordId
          ? `/dashboard/web-translator/words/${row.wordId}`
          : "/dashboard/web-translator",
      })),
    };
  }

  getSettings(user: User) {
    return this.getOrCreateSettings(user.id);
  }

  async updateSettings(user: User, dto: UpdateSettingsDto) {
    const row = await this.getOrCreateSettings(user.id);
    if (dto.locale) row.locale = dto.locale;
    if (dto.sourceLang) row.sourceLang = dto.sourceLang;
    if (dto.targetLang) row.targetLang = dto.targetLang;
    if (typeof dto.doubleClickEnabled === "boolean") {
      row.doubleClickEnabled = dto.doubleClickEnabled;
    }
    if (typeof dto.selectionEnabled === "boolean") {
      row.selectionEnabled = dto.selectionEnabled;
    }
    return this.settings.save(row);
  }

  async createPairing(user: User) {
    await this.pairings
      .createQueryBuilder()
      .delete()
      .where(
        "user_id = :userId AND (used_at IS NOT NULL OR expires_at < :now)",
        { userId: user.id, now: new Date() },
      )
      .execute();
    const code = randomPairingCode(8);
    const row = this.pairings.create({
      userId: user.id,
      codeHash: hashPairingCode(code),
      expiresAt: new Date(Date.now() + PAIRING_TTL_MS),
      usedAt: null,
    });
    await this.pairings.save(row);
    return { code, expiresAt: row.expiresAt, websiteUrl: websiteOrigin() };
  }

  async exchangePairing(dto: ExchangePairingDto, ip?: string) {
    this.hit(
      this.exchangeHits,
      ip || "unknown",
      EXCHANGE_WINDOW_MS,
      EXCHANGE_MAX,
      "Too many pairing attempts.",
    );
    const row = await this.pairings.findOne({
      where: { codeHash: hashPairingCode(dto.code), usedAt: IsNull() },
    });
    if (!row || row.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException("Invalid or expired pairing code");
    }
    const user = await this.users.findOne({ where: { id: row.userId } });
    if (!user) throw new UnauthorizedException("User not found");
    row.usedAt = new Date();
    await this.pairings.save(row);
    return this.auth.issueSession(user);
  }

  private async getOrCreateSettings(userId: string) {
    let row = await this.settings.findOne({ where: { userId } });
    if (!row) {
      row = await this.settings.save(
        this.settings.create({
          userId,
          locale: "en",
          sourceLang: "auto",
          targetLang: "ar",
          doubleClickEnabled: true,
          selectionEnabled: true,
        }),
      );
    }
    return row;
  }

  private async dictionary(word: string) {
    try {
      const { data } = await axios.get(
        `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
        {
          timeout: 8000,
          validateStatus: (status) => status >= 200 && status < 500,
        },
      );
      return parseDictionaryEntry(data);
    } catch (err: any) {
      this.logger.debug(`dictionary miss: ${err?.message || err}`);
      return { pronunciation: null, partOfSpeech: null, example: null };
    }
  }

  private async enrichWithAi(
    user: User,
    text: string,
    translation: string,
    sourceLang: string,
    targetLang: string,
  ) {
    if (!this.ai?.generateText) {
      return { pronunciation: null, partOfSpeech: null, example: null };
    }
    try {
      const result = await this.ai.generateText({
        user: { id: user.id, tenantId: user.tenantId },
        feature: "email-memo",
        maxTokens: 220,
        temperature: 0.2,
        system: "Return JSON only. No markdown.",
        prompt: `For this bilingual lookup return JSON {"pronunciation": string|null, "partOfSpeech": string|null, "example": string|null}.
Source (${sourceLang}): ${text}
Translation (${targetLang}): ${translation}
Pronunciation is IPA or simple latin. Example is one short sentence. If unknown use null.`,
      });
      return parseAiEnrichment(
        String((result as any)?.text || (result as any)?.payload?.text || ""),
      );
    } catch (err: any) {
      this.logger.debug(`ai enrich skipped: ${err?.message || err}`);
      return { pronunciation: null, partOfSpeech: null, example: null };
    }
  }

  private toWordDto(row: WebTranslatorWord) {
    return {
      id: row.id,
      text: row.text,
      translation: row.translation,
      sourceLang: row.sourceLang,
      targetLang: row.targetLang,
      pronunciation: row.pronunciation,
      partOfSpeech: row.partOfSpeech,
      example: row.example,
      sourceUrl: row.sourceUrl,
      sourceTitle: row.sourceTitle,
      lookupCount: row.lookupCount,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      websitePath: `/dashboard/web-translator/words/${row.id}`,
    };
  }

  private hit(
    bucket: Map<string, number[]>,
    key: string,
    windowMs: number,
    max: number,
    message: string,
  ) {
    const now = Date.now();
    const next = (bucket.get(key) || []).filter((ts) => now - ts < windowMs);
    if (next.length >= max) throw new ForbiddenException(message);
    next.push(now);
    bucket.set(key, next);
  }
}
