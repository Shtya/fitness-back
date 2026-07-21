import { BadRequestException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import {
  WhatsAppConversation,
  WhatsAppMessage,
  WhatsAppMessageDirection,
} from "../../whatsapp/entities/whatsapp.entity";

export interface AiReplyContextMessage {
  role: "customer" | "agent";
  content: string;
}

const PLACEHOLDERS: Record<string, string> = {
  image: "[image message]",
  photo: "[image message]",
  video: "[video message]",
  audio: "[audio message]",
  ptt: "[voice message]",
  voice: "[voice message]",
  document: "[document message]",
  sticker: "[sticker message]",
  location: "[location message]",
  live_location: "[location message]",
  contact: "[contact message]",
  contacts: "[contact message]",
  poll: "[poll message]",
};

@Injectable()
export class AiReplyContextService {
  constructor(
    @InjectRepository(WhatsAppConversation)
    private readonly conversationRepo: Repository<WhatsAppConversation>,
    @InjectRepository(WhatsAppMessage)
    private readonly messageRepo: Repository<WhatsAppMessage>,
  ) {}

  async load(
    conversationId: string,
    limit: number,
    throughMessageId?: string,
  ): Promise<{
    messages: AiReplyContextMessage[];
    contextThroughMessageId: string | null;
  }> {
    const conversation = await this.conversationRepo.findOne({
      where: { id: conversationId },
      select: ["id"],
    });
    if (!conversation) {
      throw new BadRequestException("WhatsApp conversation does not exist");
    }

    let cursor: Pick<WhatsAppMessage, "id" | "providerTimestamp"> | null = null;
    if (throughMessageId) {
      cursor = await this.messageRepo.findOne({
        where: { id: throughMessageId, conversationId },
        select: ["id", "providerTimestamp"],
      });
      if (!cursor) {
        throw new BadRequestException(
          "Context message does not belong to conversation",
        );
      }
    }

    const query = this.messageRepo
      .createQueryBuilder("message")
      .select([
        "message.id",
        "message.direction",
        "message.type",
        "message.text",
        "message.providerTimestamp",
      ])
      .where("message.conversationId = :conversationId", { conversationId })
      .andWhere("message.deletedMode = 'none'")
      .andWhere("message.providerDeletedAt IS NULL")
      .andWhere(
        "(LOWER(message.type) <> 'text' OR NULLIF(BTRIM(message.text), '') IS NOT NULL)",
      );
    if (cursor) {
      query.andWhere(
        "(message.providerTimestamp < :cursorTimestamp OR (message.providerTimestamp = :cursorTimestamp AND message.id <= :cursorId))",
        { cursorTimestamp: cursor.providerTimestamp, cursorId: cursor.id },
      );
    }
    const rows = await query
      .orderBy("message.providerTimestamp", "DESC")
      .addOrderBy("message.id", "DESC")
      .take(Math.min(Math.max(limit, 5), 50))
      .getMany();
    const chronological = rows.reverse();

    return {
      messages: chronological.map((message) => ({
        role:
          message.direction === WhatsAppMessageDirection.OUTBOUND
            ? "agent"
            : "customer",
        content: this.safeContent(message),
      })),
      contextThroughMessageId:
        (cursor?.id || chronological[chronological.length - 1]?.id) ?? null,
    };
  }

  private safeContent(message: Pick<WhatsAppMessage, "type" | "text">) {
    const type = String(message.type || "unknown").toLowerCase();
    const text = String(message.text || "")
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 4000);
    if (type === "text") return text;
    const placeholder = PLACEHOLDERS[type] || "[non-text message]";
    return text ? `${placeholder} Caption: ${text}` : placeholder;
  }
}
