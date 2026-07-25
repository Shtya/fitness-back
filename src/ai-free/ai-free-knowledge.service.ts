import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

@Injectable()
export class AiFreeKnowledgeService {
  private readonly logger = new Logger(AiFreeKnowledgeService.name);
  private cache: { loadedAt: number; text: string; path: string } | null =
    null;

  constructor(private readonly config: ConfigService) {}

  resolveKnowledgePath() {
    const configured = String(
      this.config.get("AI_FREE_KNOWLEDGE_PATH") || "",
    ).trim();
    if (configured && existsSync(configured)) return configured;

    const candidates = [
      join(__dirname, "PROJECT_KNOWLEDGE.md"),
      join(process.cwd(), "src", "ai-free", "knowledge", "PROJECT_KNOWLEDGE.md"),
      join(
        process.cwd(),
        "backend",
        "src",
        "ai-free",
        "knowledge",
        "PROJECT_KNOWLEDGE.md",
      ),
    ];
    return candidates.find((path) => existsSync(path)) || null;
  }

  getStatus() {
    const path = this.resolveKnowledgePath();
    const content = this.loadRaw();
    return {
      enabledByDefault:
        String(this.config.get("AI_FREE_PROJECT_KNOWLEDGE") ?? "true") !==
        "false",
      path,
      loaded: Boolean(content),
      characters: content?.length || 0,
      updatedHint:
        "Edit PROJECT_KNOWLEDGE.md then restart or wait for cache refresh (30s).",
    };
  }

  buildSystemContext() {
    const raw = this.loadRaw();
    if (!raw) return null;
    const maxChars = Math.min(
      Math.max(Number(this.config.get("AI_FREE_KNOWLEDGE_MAX_CHARS")) || 24000, 2000),
      100000,
    );
    const clipped = raw.length > maxChars ? `${raw.slice(0, maxChars)}\n\n[truncated]` : raw;
    return [
      "You are FitCoach inside So7baFit.",
      "Use the PROJECT KNOWLEDGE below as the source of truth about this codebase and product.",
      "If something is missing from the knowledge file, say so clearly instead of inventing APIs.",
      "You can explain how to create plans, accounts, WhatsApp flows, etc.",
      "You cannot execute write actions unless an explicit tool call is available (tools are not enabled by default).",
      "",
      "=== PROJECT KNOWLEDGE START ===",
      clipped,
      "=== PROJECT KNOWLEDGE END ===",
    ].join("\n");
  }

  private loadRaw() {
    const path = this.resolveKnowledgePath();
    if (!path) {
      this.logger.warn("PROJECT_KNOWLEDGE.md was not found");
      return null;
    }
    const now = Date.now();
    if (this.cache && this.cache.path === path && now - this.cache.loadedAt < 30_000) {
      return this.cache.text;
    }
    try {
      const text = readFileSync(path, "utf8").trim();
      this.cache = { loadedAt: now, text, path };
      return text;
    } catch (error) {
      this.logger.warn(
        `Failed to read knowledge file: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }
}
