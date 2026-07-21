import { BadRequestException } from "@nestjs/common";
import { AiReplyProviderRegistry } from "./ai-reply-provider.registry";

describe("AiReplyProviderRegistry", () => {
  it("selects the configured provider by stable name", () => {
    const dragify = { name: "dragify-free", generate: jest.fn() } as any;
    const registry = new AiReplyProviderRegistry([dragify]);
    expect(registry.get("dragify-free")).toBe(dragify);
  });

  it("rejects unavailable providers with a sanitized exception", () => {
    const registry = new AiReplyProviderRegistry([]);
    expect(() => registry.get("missing" as any)).toThrow(BadRequestException);
  });
});
