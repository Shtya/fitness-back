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

export type PrepareComposerOpts = {
  caption?: string;
  imageUrl?: string | null;
  /** When true, clicks Post after filling. Default false so the user can watch the draft. */
  autoPost?: boolean;
};

@Injectable()
export class BrowserFacebookPublisher {
  private readonly logger = new Logger(BrowserFacebookPublisher.name);
  private liveBrowser: Browser | null = null;
  private inFlight: Promise<any> | null = null;

  constructor(private readonly config: ConfigService) {}

  private profileDir() {
    const custom = String(this.config.get('AI_CONTENT_STUDIO_FB_PROFILE') || '').trim();
    const dir = custom || join(homedir(), '.so7bafit', 'facebook-browser-profile');
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

  /**
   * Opens a visible Chrome popup, waits for Facebook login, opens Create post,
   * and fills caption + image when a pipeline result exists. Window stays open.
   */
  async prepareComposer(opts: PrepareComposerOpts = {}) {
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
      throw Object.assign(new Error('No caption to post'), { status: 400, module: 'facebook' });
    }
    const result = await this.prepareComposer({ caption, imageUrl: opts.imageUrl, autoPost: true });
    if (!result.posted) {
      throw Object.assign(
        new Error(
          result.message ||
            'Facebook did not post. Look for the Chrome window — log in if needed, then click Publish again.',
        ),
        { status: 409, code: result.loggedIn ? 'FB_NOT_POSTED' : 'FB_LOGIN_REQUIRED', module: 'facebook', ...result },
      );
    }
    return result;
  }

  async probeSession() {
    return this.prepareComposer({ autoPost: false });
  }

  private async runPrepare(opts: PrepareComposerOpts) {
    const caption = String(opts.caption || '').trim();
    const imagePath = await this.materializeImage(opts.imageUrl);
    const browser = await this.ensureBrowser();
    const page = await firstPage(browser);
    page.setDefaultTimeout(180000);
    await raiseVisibleWindow(page, 'Facebook');
    await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded' });
    await raiseVisibleWindow(page, 'Facebook');
    await this.dismissOverlays(page);

    if (await this.isLoginPage(page)) {
      return {
        ok: true,
        mode: 'browser' as const,
        loggedIn: false,
        filled: false,
        posted: false,
        postId: undefined,
        windowKeptOpen: true,
        message:
          'ده مش نفس المتصفح اللي أنت فاتحه يدويًا. So7baFit بيفتح Chrome منفصل ببروفايل خاص. سجّل دخول فيسبوك في الشباك ده مرة واحدة (الجلسة بتتحفظ)، بعدين دوس Publish تاني.',
      };
    }

    const ready = await this.waitForComposer(page, 45000);
    if (!ready) {
      return {
        ok: true,
        mode: 'browser' as const,
        loggedIn: false,
        filled: false,
        posted: false,
        postId: undefined,
        windowKeptOpen: true,
        message:
          'Chrome is open on Facebook, but Create post did not appear. Log in in that window if needed, then click Publish again.',
      };
    }

    let filled = false;
    if (caption) {
      await this.typeCaption(page, caption);
      filled = true;
    }
    if (imagePath && existsSync(imagePath)) {
      await this.attachImage(page, imagePath);
      filled = true;
    }

    let posted = false;
    if (opts.autoPost) {
      posted = await this.clickPost(page);
      if (!posted) {
        throw Object.assign(
          new Error('Could not click Post. Caption is filled in the Chrome window — click Post there so you can see it go live.'),
          { status: 504, code: 'FB_POST_CLICK_FAILED', module: 'facebook' },
        );
      }
      await sleep(2500);
    }

    return {
      ok: true,
      mode: 'browser' as const,
      loggedIn: true,
      filled,
      posted,
      postId: posted ? 'browser' : undefined,
      windowKeptOpen: true,
      message: posted
        ? 'Posted. Chrome popup stays open so you can see the result.'
        : filled
          ? 'Create post is open in the Chrome popup with your caption and image. Review it, then click Post there or use Publish.'
          : 'Facebook session is ready. Create post is open in the Chrome popup — run the pipeline first to fill caption + image.',
    };
  }

  private async materializeImage(imageUrl?: string | null) {
    if (!imageUrl) return null;
    if (imageUrl.startsWith('data:image')) {
      const decoded = decodeDataUrl(imageUrl);
      if (!decoded) return null;
      const imagePath = join(tmpdir(), `so7ba-fb-${Date.now()}.${decoded.ext}`);
      writeFileSync(imagePath, decoded.buffer);
      return imagePath;
    }
    if (!/^https?:\/\//i.test(imageUrl) && !imageUrl.startsWith('/')) return null;
    try {
      const res = await fetch(imageUrl);
      const buf = Buffer.from(await res.arrayBuffer());
      const ext = (res.headers.get('content-type') || '').includes('jpeg') ? 'jpg' : 'png';
      const imagePath = join(tmpdir(), `so7ba-fb-${Date.now()}.${ext}`);
      writeFileSync(imagePath, buf);
      return imagePath;
    } catch (e: any) {
      this.logger.warn(`Could not download image for FB browser post: ${e?.message || e}`);
      return null;
    }
  }

  private async isLoginPage(page: Page) {
    return Boolean(
      await page.$('#email, input[name="email"], input[name="pass"], #loginbutton, form[data-testid="royal_login_form"]'),
    );
  }

  private async dismissOverlays(page: Page) {
    const labels = [
      'Allow all cookies',
      'Allow essential and optional cookies',
      'Decline optional cookies',
      'السماح بكل ملفات تعريف الارتباط',
      'Close',
      'إغلاق',
    ];
    await page.evaluate((ariaLabels) => {
      const nodes = Array.from(document.querySelectorAll('[role="button"], button'));
      for (const label of ariaLabels) {
        const btn = nodes.find((n) => {
          const t = (n.getAttribute('aria-label') || n.textContent || '').trim();
          return t === label;
        }) as HTMLElement | undefined;
        if (btn) btn.click();
      }
    }, labels).catch(() => undefined);
    await sleep(400);
  }

  private async waitForComposer(page: Page, timeoutMs: number) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.isLoginPage(page)) return false;
      const opened = await this.openComposer(page);
      if (opened) return true;
      await sleep(1200);
    }
    return false;
  }

  private async openComposer(page: Page) {
    const triggers = [
      '[aria-label="Create a post"]',
      '[aria-label="إنشاء منشور"]',
      '[aria-label="What\'s on your mind, anyone?"]',
      '[aria-label="بم تفكر؟"]',
      'div[role="button"][aria-label*="What\'s on your mind"]',
      'div[role="button"][aria-label*="بم تفكر"]',
      'div[role="button"][aria-label*="Create a post"]',
    ];
    for (const sel of triggers) {
      try {
        const el = await page.$(sel);
        if (el) {
          await el.click();
          await sleep(700);
        }
      } catch {
        /* try next */
      }
    }
    const box = await page.$(
      'div[role="dialog"] div[role="textbox"][contenteditable="true"], div[role="textbox"][contenteditable="true"]',
    );
    return Boolean(box);
  }

  private async typeCaption(page: Page, caption: string) {
    const selectors = [
      'div[role="dialog"] div[role="textbox"][contenteditable="true"]',
      'div[role="textbox"][contenteditable="true"]',
    ];
    for (const sel of selectors) {
      const el = await page.$(sel);
      if (!el) continue;
      await el.click();
      await sleep(200);
      const inserted = await page.evaluate((text) => {
        const box = document.querySelector(
          'div[role="dialog"] div[role="textbox"][contenteditable="true"], div[role="textbox"][contenteditable="true"]',
        ) as HTMLElement | null;
        if (!box) return false;
        box.focus();
        document.execCommand('selectAll', false);
        return document.execCommand('insertText', false, text);
      }, caption.slice(0, 4000));
      if (!inserted) {
        await page.keyboard.down('Control');
        await page.keyboard.press('A');
        await page.keyboard.up('Control');
        await page.keyboard.type(caption.slice(0, 4000), { delay: 6 });
      }
      return;
    }
    throw Object.assign(new Error('Could not find Facebook caption box'), {
      status: 500,
      module: 'facebook',
    });
  }

  private async attachImage(page: Page, filePath: string) {
    const inputs = await page.$$('input[type="file"]');
    for (const input of inputs) {
      try {
        await input.uploadFile(filePath);
        await sleep(1500);
        return;
      } catch {
        /* try next file input */
      }
    }
    this.logger.warn('No file input found for Facebook image attach');
  }

  private async clickPost(page: Page) {
    const labels = ['Post', 'نشر'];
    const clicked = await page.evaluate((ariaLabels) => {
      const dialog = document.querySelector('div[role="dialog"]') || document.body;
      const nodes = Array.from(dialog.querySelectorAll('[role="button"], button'));
      const btn = nodes.find((n) => {
        const aria = (n.getAttribute('aria-label') || '').trim();
        const text = (n.textContent || '').replace(/\s+/g, ' ').trim();
        if (n.getAttribute('aria-disabled') === 'true' || (n as HTMLButtonElement).disabled) return false;
        return ariaLabels.includes(aria) || ariaLabels.includes(text);
      }) as HTMLElement | undefined;
      if (!btn) return false;
      btn.click();
      return true;
    }, labels);
    if (!clicked) return false;
    try {
      await page.waitForFunction(
        () => !document.querySelector('div[role="dialog"] div[role="textbox"][contenteditable="true"]'),
        { timeout: 12000 },
      );
      return true;
    } catch {
      return false;
    }
  }
}
