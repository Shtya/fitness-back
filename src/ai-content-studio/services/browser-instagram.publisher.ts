import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import { Browser, Page } from 'puppeteer';
import { resolveChromeExecutablePath } from '../../common/chrome-executable';
import { firstPage, launchVisiblePopupBrowser, raiseVisibleWindow } from './browser-visible-chrome';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function decodeDataUrl(dataUrl: string): { buffer: Buffer; ext: string } | null {
  const m = String(dataUrl || '').match(/^data:(image\/[\w+.-]+);base64,(.+)$/i);
  if (!m) return null;
  const mime = m[1].toLowerCase();
  const ext = mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : mime.includes('webp') ? 'webp' : 'png';
  return { buffer: Buffer.from(m[2], 'base64'), ext };
}

export type PrepareIgOpts = {
  caption?: string;
  imageUrl?: string | null;
  autoPost?: boolean;
};

@Injectable()
export class BrowserInstagramPublisher {
  private readonly logger = new Logger(BrowserInstagramPublisher.name);
  private liveBrowser: Browser | null = null;
  private inFlight: Promise<any> | null = null;

  constructor(private readonly config: ConfigService) {}

  private profileDir() {
    const custom = String(this.config.get('AI_CONTENT_STUDIO_IG_PROFILE') || '').trim();
    const dir = custom || join(homedir(), '.so7bafit', 'instagram-browser-profile');
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  private executablePath() {
    return resolveChromeExecutablePath(
      this.config.get<string>('AI_CONTENT_STUDIO_CHROME') ||
        this.config.get<string>('CHROME_EXECUTABLE_PATH') ||
        this.config.get<string>('AI_FREE_EXECUTABLE_PATH'),
    );
  }

  private async ensureBrowser() {
    if (this.liveBrowser) {
      try {
        if (this.liveBrowser.connected) return this.liveBrowser;
      } catch {
        this.liveBrowser = null;
      }
    }
    const launched = await launchVisiblePopupBrowser({
      executablePath: this.executablePath(),
      userDataDir: this.profileDir(),
      existing: this.liveBrowser,
      preferCdp: true,
      cdpUrl: String(this.config.get('AI_CONTENT_STUDIO_CHROME_CDP') || '').trim() || undefined,
    });
    this.liveBrowser = launched.browser;
    this.liveBrowser.once('disconnected', () => {
      this.liveBrowser = null;
    });
    return this.liveBrowser;
  }

  async prepareComposer(opts: PrepareIgOpts = {}) {
    if (this.inFlight) await this.inFlight.catch(() => undefined);
    this.inFlight = this.runPrepare(opts);
    try {
      return await this.inFlight;
    } finally {
      this.inFlight = null;
    }
  }

  async publish(opts: { caption: string; imageUrl?: string | null }) {
    const caption = String(opts.caption || '').trim();
    if (!caption) {
      throw Object.assign(new Error('No caption to post'), { status: 400, module: 'instagram' });
    }
    const result = await this.prepareComposer({ caption, imageUrl: opts.imageUrl, autoPost: true });
    if (!result.posted) {
      throw Object.assign(
        new Error(
          result.message ||
            'Instagram did not post. Look for the Chrome window — log in if needed, then click Publish again.',
        ),
        { status: 409, code: result.loggedIn ? 'IG_NOT_POSTED' : 'IG_LOGIN_REQUIRED', module: 'instagram', ...result },
      );
    }
    return result;
  }

  async probeSession() {
    return this.prepareComposer({ autoPost: false });
  }

  private async runPrepare(opts: PrepareIgOpts) {
    const caption = String(opts.caption || '').trim();
    const imagePath = await this.materializeImage(opts.imageUrl);
    const browser = await this.ensureBrowser();
    const page = await firstPage(browser);
    page.setDefaultTimeout(180000);
    await raiseVisibleWindow(page, 'Instagram');
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' });
    await raiseVisibleWindow(page, 'Instagram');

    const ready = await this.openCreate(page, 180000);
    if (!ready) {
      return {
        ok: true,
        mode: 'browser' as const,
        loggedIn: false,
        filled: false,
        posted: false,
        mediaId: undefined,
        windowKeptOpen: true,
        message:
          'Chrome popup is open on Instagram. Log in in that window (saved for next time). Then open this node again to fill the post.',
      };
    }

    let filled = false;
    if (imagePath && existsSync(imagePath)) {
      await this.attachImage(page, imagePath);
      await this.clickLabeled(page, ['Next', 'التالي']);
      await sleep(800);
      await this.clickLabeled(page, ['Next', 'التالي']);
      filled = true;
    }
    if (caption) {
      await this.typeCaption(page, caption);
      filled = true;
    }

    let posted = false;
    if (opts.autoPost) {
      if (!imagePath) {
        throw Object.assign(new Error('Instagram browser post needs an image file'), {
          status: 400,
          module: 'instagram',
        });
      }
      posted = await this.clickLabeled(page, ['Share', 'مشاركة']);
      if (!posted) {
        throw Object.assign(
          new Error('Could not click Share. The post is open in the Chrome window — finish it there so you can see it.'),
          { status: 504, code: 'IG_SHARE_CLICK_FAILED', module: 'instagram' },
        );
      }
      await sleep(4000);
    }

    return {
      ok: true,
      mode: 'browser' as const,
      loggedIn: true,
      filled,
      posted,
      mediaId: posted ? 'browser' : undefined,
      windowKeptOpen: true,
      message: posted
        ? 'Shared. Chrome popup stays open so you can see the result.'
        : filled
          ? 'Create post is open in the Chrome popup with your image and caption. Review it, then click Share there or use Publish.'
          : 'Instagram session is ready. Create is open in the Chrome popup — run the pipeline first to fill image + caption.',
    };
  }

  private async materializeImage(imageUrl?: string | null) {
    if (!imageUrl) return null;
    if (imageUrl.startsWith('data:image')) {
      const decoded = decodeDataUrl(imageUrl);
      if (!decoded) return null;
      const imagePath = join(tmpdir(), `so7ba-ig-${Date.now()}.${decoded.ext}`);
      writeFileSync(imagePath, decoded.buffer);
      return imagePath;
    }
    if (!/^https?:\/\//i.test(imageUrl) && !imageUrl.startsWith('/')) return null;
    try {
      const res = await fetch(imageUrl);
      const buf = Buffer.from(await res.arrayBuffer());
      const ext = (res.headers.get('content-type') || '').includes('jpeg') ? 'jpg' : 'png';
      const imagePath = join(tmpdir(), `so7ba-ig-${Date.now()}.${ext}`);
      writeFileSync(imagePath, buf);
      return imagePath;
    } catch (e: any) {
      this.logger.warn(`Could not download image for IG browser post: ${e?.message || e}`);
      return null;
    }
  }

  private async openCreate(page: Page, timeoutMs: number) {
    const deadline = Date.now() + timeoutMs;
    const triggers = [
      '[aria-label="New post"]',
      '[aria-label="Create"]',
      '[aria-label="منشور جديد"]',
      '[aria-label="إنشاء"]',
      'svg[aria-label="New post"]',
      'svg[aria-label="Create"]',
    ];
    while (Date.now() < deadline) {
      for (const sel of triggers) {
        try {
          const el = await page.$(sel);
          if (!el) continue;
          await el.click();
          await sleep(800);
          const file = await page.$('input[type="file"]');
          if (file) return true;
        } catch {
          /* try next */
        }
      }
      const loggedOut = await page.$('input[name="username"], input[name="email"]');
      if (loggedOut) return false;
      await sleep(1200);
    }
    return Boolean(await page.$('input[type="file"]'));
  }

  private async attachImage(page: Page, filePath: string) {
    const inputs = await page.$$('input[type="file"]');
    for (const input of inputs) {
      try {
        await input.uploadFile(filePath);
        await sleep(1800);
        return;
      } catch {
        /* try next */
      }
    }
    throw Object.assign(new Error('No Instagram file input for the image'), {
      status: 500,
      module: 'instagram',
    });
  }

  private async typeCaption(page: Page, caption: string) {
    const selectors = [
      'div[aria-label="Write a caption…"]',
      'div[aria-label="كتابة تعليق…"]',
      'textarea[aria-label="Write a caption…"]',
      'div[role="textbox"][contenteditable="true"]',
    ];
    for (const sel of selectors) {
      const el = await page.$(sel);
      if (!el) continue;
      await el.click();
      const inserted = await page.evaluate((text) => {
        const box = document.activeElement as HTMLElement | null;
        if (!box) return false;
        document.execCommand('selectAll', false);
        return document.execCommand('insertText', false, text);
      }, caption.slice(0, 2200));
      if (!inserted) await page.keyboard.type(caption.slice(0, 2200), { delay: 6 });
      return;
    }
    this.logger.warn('Instagram caption box not found — image may still be attached');
  }

  private async clickLabeled(page: Page, labels: string[]) {
    for (const label of labels) {
      const clicked = await page.evaluate((aria) => {
        const nodes = Array.from(document.querySelectorAll('[role="button"], button, div[role="button"]'));
        const btn = nodes.find((n) => {
          const t = (n.getAttribute('aria-label') || n.textContent || '').trim();
          return t === aria || t.startsWith(aria);
        }) as HTMLElement | undefined;
        if (!btn) return false;
        btn.click();
        return true;
      }, label);
      if (clicked) {
        await sleep(700);
        return true;
      }
    }
    return false;
  }
}
