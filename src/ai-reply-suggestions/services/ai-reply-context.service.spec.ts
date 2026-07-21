import { WhatsAppMessageDirection } from "../../whatsapp/entities/whatsapp.entity";
import { AiReplyContextService } from "./ai-reply-context.service";

describe("AiReplyContextService", () => {
  it("returns only sanitized chronological local context", async () => {
    const rows = [
      {
        id: "message-2",
        direction: WhatsAppMessageDirection.INBOUND,
        type: "image",
        text: " product photo\u0000 ",
        providerTimestamp: new Date("2026-01-02"),
        providerMessageId: "secret-provider-id",
        senderWaId: "201000000000@c.us",
        raw: { phone: "201000000000" },
        storagePath: "private/file.jpg",
      },
      {
        id: "message-1",
        direction: WhatsAppMessageDirection.OUTBOUND,
        type: "text",
        text: "  Welcome   back ",
        providerTimestamp: new Date("2026-01-01"),
      },
    ];
    const query = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(rows),
    };
    const conversationRepo = {
      findOne: jest.fn().mockResolvedValue({ id: "conversation-1" }),
    };
    const messageRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(query),
      findOne: jest.fn(),
    };
    const service = new AiReplyContextService(
      conversationRepo as any,
      messageRepo as any,
    );

    const result = await service.load("conversation-1", 20);
    expect(result).toEqual({
      messages: [
        { role: "agent", content: "Welcome back" },
        { role: "customer", content: "[image message] Caption: product photo" },
      ],
      contextThroughMessageId: "message-2",
    });
    expect(JSON.stringify(result)).not.toContain("provider-id");
    expect(JSON.stringify(result)).not.toContain("201000000000");
    expect(JSON.stringify(result)).not.toContain("private/file");
  });
});
