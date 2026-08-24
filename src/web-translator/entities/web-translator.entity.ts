import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("web_translator_words")
@Index(
  "uq_web_translator_word",
  ["userId", "normalizedText", "sourceLang", "targetLang"],
  { unique: true },
)
@Index("idx_web_translator_words_user_updated", ["userId", "updatedAt"])
export class WebTranslatorWord {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Index()
  @Column({ name: "user_id", type: "uuid" })
  userId: string;

  @Column({ type: "varchar", length: 500 })
  text: string;

  @Column({ name: "normalized_text", type: "varchar", length: 500 })
  normalizedText: string;

  @Column({ type: "text" })
  translation: string;

  @Column({ name: "source_lang", type: "varchar", length: 8, default: "en" })
  sourceLang: string;

  @Column({ name: "target_lang", type: "varchar", length: 8, default: "ar" })
  targetLang: string;

  @Column({ type: "varchar", length: 160, nullable: true })
  pronunciation: string | null;

  @Column({
    name: "part_of_speech",
    type: "varchar",
    length: 64,
    nullable: true,
  })
  partOfSpeech: string | null;

  @Column({ type: "text", nullable: true })
  example: string | null;

  @Column({ name: "source_url", type: "text", nullable: true })
  sourceUrl: string | null;

  @Column({
    name: "source_title",
    type: "varchar",
    length: 240,
    nullable: true,
  })
  sourceTitle: string | null;

  @Column({ name: "lookup_count", type: "int", default: 1 })
  lookupCount: number;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt: Date;
}

@Entity("web_translator_lookups")
@Index("idx_web_translator_lookups_user_created", ["userId", "createdAt"])
export class WebTranslatorLookup {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Index()
  @Column({ name: "user_id", type: "uuid" })
  userId: string;

  @Column({ name: "word_id", type: "uuid", nullable: true })
  wordId: string | null;

  @Column({ type: "varchar", length: 500 })
  text: string;

  @Column({ type: "text" })
  translation: string;

  @Column({ name: "source_lang", type: "varchar", length: 8 })
  sourceLang: string;

  @Column({ name: "target_lang", type: "varchar", length: 8 })
  targetLang: string;

  @Column({ type: "varchar", length: 160, nullable: true })
  pronunciation: string | null;

  @Column({
    name: "part_of_speech",
    type: "varchar",
    length: 64,
    nullable: true,
  })
  partOfSpeech: string | null;

  @Column({ type: "text", nullable: true })
  example: string | null;

  @Column({ name: "source_url", type: "text", nullable: true })
  sourceUrl: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;
}

@Entity("web_translator_settings")
export class WebTranslatorSettings {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Index({ unique: true })
  @Column({ name: "user_id", type: "uuid" })
  userId: string;

  @Column({ type: "varchar", length: 8, default: "en" })
  locale: string;

  @Column({ name: "source_lang", type: "varchar", length: 8, default: "auto" })
  sourceLang: string;

  @Column({ name: "target_lang", type: "varchar", length: 8, default: "ar" })
  targetLang: string;

  @Column({ name: "double_click_enabled", type: "boolean", default: true })
  doubleClickEnabled: boolean;

  @Column({ name: "selection_enabled", type: "boolean", default: true })
  selectionEnabled: boolean;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt: Date;
}

@Entity("web_translator_pairings")
@Index("idx_web_translator_pairings_hash", ["codeHash"])
export class WebTranslatorPairing {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Index()
  @Column({ name: "user_id", type: "uuid" })
  userId: string;

  @Column({ name: "code_hash", type: "varchar", length: 64 })
  codeHash: string;

  @Column({ name: "expires_at", type: "timestamptz" })
  expiresAt: Date;

  @Column({ name: "used_at", type: "timestamptz", nullable: true })
  usedAt: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;
}

export const WEB_TRANSLATOR_ENTITIES = [
  WebTranslatorWord,
  WebTranslatorLookup,
  WebTranslatorSettings,
  WebTranslatorPairing,
];
