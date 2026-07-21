import { existsSync } from "fs";
import { platform } from "os";

/**
 * Resolve a Chrome/Chromium binary for Puppeteer/wppconnect.
 * Never return a configured path that does not exist on this host
 * (e.g. a Windows path copied into a Linux production .env).
 */
export function resolveChromeExecutablePath(
  configuredPath?: string | null,
): string | undefined {
  const configured = String(configuredPath || "").trim();
  if (configured && existsSync(configured)) {
    return configured;
  }

  const isWindows = platform() === "win32";
  const candidates = isWindows
    ? [
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
      ]
    : [
        process.env.CHROME_PATH || "",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/google-chrome",
        "/usr/bin/chromium-browser",
        "/usr/bin/chromium",
        "/snap/bin/chromium",
        "/usr/lib/chromium/chrome",
        "/opt/google/chrome/chrome",
      ];

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }

  try {
    // Lazy require so unit tests / boot do not hard-depend on puppeteer layout.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const puppeteer = require("puppeteer") as {
      executablePath?: () => string;
    };
    const bundled = puppeteer.executablePath?.();
    if (bundled && existsSync(bundled)) return bundled;
  } catch {
    // Fall through — caller may omit executablePath and let the library discover it.
  }

  return undefined;
}

export function isServerlessRuntime() {
  return Boolean(
    process.env.VERCEL ||
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.FUNCTION_NAME ||
      process.env.K_SERVICE,
  );
}
