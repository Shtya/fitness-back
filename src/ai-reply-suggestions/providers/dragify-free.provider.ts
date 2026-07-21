import {
  GatewayTimeoutException,
  Injectable,
  Logger,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { existsSync } from "fs";
import puppeteer, { Browser, Page } from "puppeteer";
import { AiReplyProvider, AiReplyProviderResult } from "./ai-reply-provider";

const SELECTORS = {
  promptCandidates: [
    "#prompt-textarea",
    '[data-testid="prompt-textarea"]',
    'div.ProseMirror[contenteditable="true"]',
    'div[contenteditable="true"][data-placeholder]',
    'textarea[name="prompt-textarea"]',
    "textarea",
  ],
  assistantMessages: '[data-message-author-role="assistant"]',
  modelSwitcher: '[data-testid="model-switcher-dropdown-button"]',
  modelOptions: '[role="menuitemradio"], [role="menuitem"]',
  stopButton: '[data-testid="stop-button"]',
} as const;

function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.min(Math.max(Math.floor(parsed), minimum), maximum)
    : fallback;
}

function sanitizeProviderError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return message
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

@Injectable()
export class DragifyFreeProvider implements AiReplyProvider {
  readonly name = "dragify-free" as const;
  private readonly logger = new Logger(DragifyFreeProvider.name);
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly config: ConfigService) {}

  private async acquire() {
    const maximum = boundedInteger(
      this.config.get("AI_REPLY_MAX_CONCURRENCY"),
      2,
      1,
      10,
    );
    if (this.active < maximum) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  private release() {
    const next = this.waiters.shift();
    if (next) next();
    else this.active = Math.max(0, this.active - 1);
  }

  private resolveExecutablePath() {
    const configured =
      this.config.get<string>("AI_REPLY_EXECUTABLE_PATH") ||
      this.config.get<string>("CHROME_EXECUTABLE_PATH") ||
      "";
    if (configured && existsSync(configured)) return configured;

    const candidates = [
      process.env.PROGRAMFILES
        ? `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`
        : "",
      process.env["PROGRAMFILES(X86)"]
        ? `${process.env["PROGRAMFILES(X86)"]}\\Google\\Chrome\\Application\\chrome.exe`
        : "",
      process.env.LOCALAPPDATA
        ? `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`
        : "",
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    ].filter(Boolean);

    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate;
    }

    try {
      const bundled = puppeteer.executablePath();
      if (bundled && existsSync(bundled)) return bundled;
    } catch {
      // Fall through to Puppeteer's default discovery.
    }
    return undefined;
  }

  async generate(request: {
    prompt: string;
    model: string;
  }): Promise<AiReplyProviderResult> {
    const maximumPromptLength = boundedInteger(
      this.config.get("AI_REPLY_MAX_PROMPT_LENGTH"),
      24000,
      1000,
      100000,
    );
    if (request.prompt.length > maximumPromptLength) {
      throw new PayloadTooLargeException("AI suggestion context is too large");
    }

    await this.acquire();
    try {
      return await this.runBrowser(request.prompt, request.model);
    } finally {
      this.release();
    }
  }

  private async findPromptSelector(page: Page) {
    for (const selector of SELECTORS.promptCandidates) {
      const handle = await page.$(selector);
      if (handle) {
        await handle.dispose();
        return selector;
      }
    }
    return null;
  }

  private async fillPrompt(page: Page, selector: string, prompt: string) {
    await page.waitForSelector(selector, { timeout: 15000 });
    await page.click(selector, { clickCount: 1 });
    const inserted = await page.evaluate(
      (targetSelector, value) => {
        const element = document.querySelector(targetSelector) as
          | HTMLElement
          | HTMLTextAreaElement
          | null;
        if (!element) return false;
        element.focus();
        if (
          element instanceof HTMLTextAreaElement ||
          element instanceof HTMLInputElement
        ) {
          element.value = value;
          element.dispatchEvent(new Event("input", { bubbles: true }));
          return true;
        }
        if (element.isContentEditable) {
          element.textContent = "";
          element.dispatchEvent(new InputEvent("input", { bubbles: true }));
          document.execCommand("selectAll", false);
          document.execCommand("insertText", false, value);
          element.dispatchEvent(new InputEvent("input", { bubbles: true }));
          return Boolean(element.textContent?.trim());
        }
        return false;
      },
      selector,
      prompt,
    );
    if (!inserted) {
      await page.focus(selector);
      await page.keyboard.type(prompt.slice(0, 4000), { delay: 0 });
    }
  }

  private async runBrowser(
    prompt: string,
    model: string,
  ): Promise<AiReplyProviderResult> {
    const navigationTimeout = boundedInteger(
      this.config.get("AI_REPLY_NAVIGATION_TIMEOUT_MS"),
      60000,
      5000,
      180000,
    );
    const responseTimeout = boundedInteger(
      this.config.get("AI_REPLY_RESPONSE_TIMEOUT_MS"),
      120000,
      10000,
      300000,
    );
    const headless =
      String(this.config.get("AI_REPLY_HEADLESS") ?? "true") !== "false";
    const executablePath = this.resolveExecutablePath();
    let browser: Browser | undefined;

    try {
      browser = await puppeteer.launch({
        headless,
        executablePath,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-blink-features=AutomationControlled",
          "--disable-gpu",
        ],
      });
      const page = await browser.newPage();
      await page.setUserAgent(
        this.config.get<string>("AI_REPLY_USER_AGENT") ||
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      );
      await page.setViewport({ width: 1440, height: 900 });
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      });
      page.setDefaultTimeout(navigationTimeout);
      await page.goto(
        this.config.get<string>("AI_REPLY_CHATGPT_URL") ||
          "https://chatgpt.com/",
        {
          waitUntil: "domcontentloaded",
          timeout: navigationTimeout,
        },
      );

      if (model && model.toLowerCase() !== "auto") {
        try {
          await page.waitForSelector(SELECTORS.modelSwitcher, {
            timeout: 5000,
          });
          await page.click(SELECTORS.modelSwitcher);
          await page.waitForSelector(SELECTORS.modelOptions, { timeout: 5000 });
          const options = await page.$$(SELECTORS.modelOptions);
          for (const option of options) {
            const text = String(
              await option.evaluate(
                (element: Element) => element.textContent || "",
              ),
            ).toLowerCase();
            if (text.includes(model.toLowerCase())) {
              await option.click();
              break;
            }
          }
        } catch {
          // Anonymous ChatGPT sessions may not expose a model switcher.
        }
      }

      const promptSelector = await this.findPromptSelector(page);
      if (!promptSelector) {
        throw new ServiceUnavailableException(
          "ChatGPT prompt box was not found. The page may be blocked by login, CAPTCHA, or a UI change.",
        );
      }

      const previousAssistantCount = await page.$$eval(
        SELECTORS.assistantMessages,
        (elements: Element[]) => elements.length,
      );
      await this.fillPrompt(page, promptSelector, prompt);
      await page.keyboard.press("Enter");
      await page.waitForFunction(
        (selector: string, previousCount: number) =>
          document.querySelectorAll(selector).length > previousCount,
        { timeout: responseTimeout, polling: 250 },
        SELECTORS.assistantMessages,
        previousAssistantCount,
      );

      const startedAt = Date.now();
      let lastText = "";
      let stableSince = Date.now();
      while (Date.now() - startedAt < responseTimeout) {
        const currentText = String(
          await page.$$eval(
            SELECTORS.assistantMessages,
            (elements: Element[]) => {
              const last = elements[elements.length - 1] as
                | HTMLElement
                | undefined;
              return last?.innerText || "";
            },
          ),
        ).trim();
        if (currentText !== lastText) {
          lastText = currentText;
          stableSince = Date.now();
        }
        const isStreaming = await page.$(SELECTORS.stopButton);
        if (lastText && !isStreaming && Date.now() - stableSince >= 1500) {
          return { text: lastText, actualModel: null };
        }
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      throw new GatewayTimeoutException("AI suggestion provider timed out");
    } catch (error) {
      if (
        error instanceof GatewayTimeoutException ||
        error instanceof PayloadTooLargeException ||
        error instanceof ServiceUnavailableException
      ) {
        throw error;
      }
      const name = error instanceof Error ? error.name : "";
      if (name === "TimeoutError") {
        throw new GatewayTimeoutException(
          "AI suggestion provider timed out waiting for ChatGPT",
        );
      }
      const detail = sanitizeProviderError(error);
      this.logger.warn(`Dragify-free provider failed: ${detail}`);
      throw new ServiceUnavailableException(
        detail
          ? `AI suggestion provider is unavailable: ${detail}`
          : "AI suggestion provider is unavailable",
      );
    } finally {
      if (browser) await browser.close().catch(() => undefined);
    }
  }
}
