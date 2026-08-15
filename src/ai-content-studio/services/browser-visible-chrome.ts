import { execFile } from 'child_process';
import puppeteer, { Browser, Page } from 'puppeteer';

/**
 * Prefer an already-running Chrome with remote debugging (same cookies as that Chrome).
 * Set AI_CONTENT_STUDIO_CHROME_CDP=http://127.0.0.1:9222 after starting Chrome with
 * --remote-debugging-port=9222 (close all Chrome windows first, then relaunch with the flag).
 */
export async function connectExistingChromeCdp(cdpUrl?: string): Promise<Browser | null> {
  const url = String(cdpUrl || process.env.AI_CONTENT_STUDIO_CHROME_CDP || '').trim();
  if (!url) return null;
  try {
    const browser = await puppeteer.connect({
      browserURL: url.replace(/\/$/, ''),
      defaultViewport: null,
    });
    return browser;
  } catch {
    return null;
  }
}

/**
 * Visible Chrome popup (not headless, not maximized) so the user can watch login + composer.
 * Reuses an already-open instance when the same profile is still connected.
 *
 * Important: this is NOT the user's everyday Chrome/Edge tab. It uses a dedicated
 * So7baFit profile (or an explicit CDP Chrome) so cookies are separate until they log in once.
 */
export async function launchVisiblePopupBrowser(opts: {
  executablePath?: string;
  userDataDir: string;
  existing?: Browser | null;
  /** When true, try AI_CONTENT_STUDIO_CHROME_CDP before launching a dedicated profile. */
  preferCdp?: boolean;
  cdpUrl?: string;
}): Promise<{ browser: Browser; viaCdp: boolean }> {
  if (opts.existing) {
    try {
      if (opts.existing.connected) return { browser: opts.existing, viaCdp: false };
    } catch {
      /* relaunch */
    }
  }

  if (opts.preferCdp !== false) {
    const cdp = await connectExistingChromeCdp(opts.cdpUrl);
    if (cdp) return { browser: cdp, viaCdp: true };
  }

  const browser = await puppeteer.launch({
    headless: false,
    executablePath: opts.executablePath || undefined,
    userDataDir: opts.userDataDir,
    defaultViewport: null,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--new-window',
      '--window-size=1180,840',
      '--window-position=80,40',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  });
  return { browser, viaCdp: false };
}

export async function firstPage(browser: Browser) {
  const pages = await browser.pages();
  const useful = pages.find((p) => {
    try {
      const u = p.url();
      return u && u !== 'about:blank' && !u.startsWith('chrome://') && !u.startsWith('chrome-extension://');
    } catch {
      return false;
    }
  });
  return useful || pages[0] || browser.newPage();
}

/** Move the Chrome popup on-screen and try to steal focus (Windows often hides Nest-launched windows). */
export async function raiseVisibleWindow(page: Page, titleHint?: string) {
  await page.bringToFront().catch(() => undefined);
  try {
    const session = await page.createCDPSession();
    const { windowId } = await session.send('Browser.getWindowForTarget');
    await session.send('Browser.setWindowBounds', {
      windowId,
      bounds: { windowState: 'normal' },
    });
    await session.send('Browser.setWindowBounds', {
      windowId,
      bounds: { left: 80, top: 40, width: 1180, height: 840, windowState: 'normal' },
    });
  } catch {
    /* CDP unavailable */
  }
  focusChromeOnWindows(titleHint);
}

function focusChromeOnWindows(titleHint?: string) {
  if (process.platform !== 'win32') return;
  const titles = [titleHint, 'Facebook', 'Instagram', 'Google Chrome', 'Chrome', 'Chromium']
    .filter(Boolean)
    .map((t) => String(t).replace(/'/g, "''"));
  const activate = titles.map((t) => `try { $w.AppActivate('${t}') | Out-Null } catch {}`).join('; ');
  execFile(
    'powershell.exe',
    [
      '-NoProfile',
      '-STA',
      '-Command',
      `try { $w = New-Object -ComObject WScript.Shell; ${activate} } catch {}`,
    ],
    { timeout: 4000, windowsHide: true },
    () => undefined,
  );
}
