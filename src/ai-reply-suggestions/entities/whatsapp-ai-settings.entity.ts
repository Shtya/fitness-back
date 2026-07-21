import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";
import { User } from "../../../entities/global.entity";
import { WhatsAppAccount } from "../../whatsapp/entities/whatsapp.entity";

export const AI_REPLY_PROVIDERS = ["dragify-free"] as const;
export const AI_REPLY_LANGUAGES = ["auto", "ar", "en"] as const;
export const AI_REPLY_TONES = [
  "professional",
  "friendly",
  "egyptian",
  "sales",
  "support",
  "concise",
] as const;

export type AiReplyProviderName = (typeof AI_REPLY_PROVIDERS)[number];
export type AiReplyLanguage = (typeof AI_REPLY_LANGUAGES)[number];
export type AiReplyTone = (typeof AI_REPLY_TONES)[number];

export interface AiReplyPromptPreset {
  id: string;
  name: string;
  prompt: string;
}

@Entity("whatsapp_ai_settings")
export class WhatsAppAiSettings {
  @PrimaryColumn({ name: "account_id", type: "uuid" })
  accountId: string;

  @OneToOne(() => WhatsAppAccount, { onDelete: "CASCADE" })
  @JoinColumn({ name: "account_id" })
  account: WhatsAppAccount;

  @Column({ type: "boolean", default: false })
  enabled: boolean;

  @Column({ type: "varchar", length: 40, default: "dragify-free" })
  provider: AiReplyProviderName;

  @Column({ type: "varchar", length: 80, default: "auto" })
  model: string;

  @Column({ name: "system_prompt", type: "text", nullable: true })
  systemPrompt: string | null;

  @Column({ name: "prompt_presets", type: "jsonb", default: () => "'[]'::jsonb" })
  promptPresets: AiReplyPromptPreset[];

  @Column({ name: "active_prompt_id", type: "uuid", nullable: true })
  activePromptId: string | null;

  @Column({ type: "text", nullable: true })
  persona: string | null;

  @Column({ type: "varchar", length: 10, default: "auto" })
  language: AiReplyLanguage;

  @Column({ type: "varchar", length: 20, default: "professional" })
  tone: AiReplyTone;

  @Column({ name: "suggestion_count", type: "smallint", default: 3 })
  suggestionCount: number;

  @Column({ name: "context_message_limit", type: "smallint", default: 20 })
  contextMessageLimit: number;

  @Column({ name: "updated_by", type: "uuid", nullable: true })
  updatedBy: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "updated_by" })
  updatedByUser: User | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  created_at: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updated_at: Date;
}
