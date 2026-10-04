import { Logger } from '@nestjs/common';
import puppeteer, { Browser, HTTPRequest, HTTPResponse } from 'puppeteer';
import { autoScrollPage, collectPage, measureViewport, readDomSignals, readGlobals, resolveRootVariables } from './page-scripts';
import { BROWSER_UA, isBlockedHostname, resolvePublicHost } from './url-guard';

export const GLOBAL_PATHS = [
	'__NEXT_DATA__', 'next', 'next.version', '__next_f', '__NUXT__', '$nuxt', '__NUXT_DATA__', '___gatsby', '___loader',
	'__remixContext', '__reactRouterContext', '__remixManifest', '__sveltekit', '__docusaurus', '__VP_HASH_MAP__',
	'React', 'React.version', 'preact', 'Vue', 'Vue.version', '__VUE__', 'ng', 'getAllAngularRootElements', 'angular',
	'angular.version.full', '_$HY', 'Ember', 'Ember.VERSION', 'Alpine', 'Alpine.version', 'htmx', 'htmx.version', 'Turbo',
	'Stimulus', 'Livewire', 'jQuery', 'jQuery.fn.jquery', 'webpackChunk', '__webpack_require__', 'bootstrap',
	'bootstrap.Tooltip.VERSION', 'Foundation', 'UIkit', 'Flowbite', 'gsap', 'gsap.version', 'TweenMax', 'TweenLite',
	'ScrollTrigger', 'AOS', 'anime', 'lottie', 'bodymovin', 'WOW', 'ScrollReveal', 'barba', 'lenis', 'Lenis',
	'LocomotiveScroll', 'Swiper', 'Swiper.version', 'Splide', 'THREE', '__THREE__', 'PIXI', 'PIXI.VERSION', 'BABYLON',
	'p5', 'FontAwesome', 'lucide', 'Iconify', 'feather', 'Typekit', 'WebFont', 'wp', 'Shopify', 'Webflow',
	'Static.SQUARESPACE_CONTEXT', 'Drupal', 'gtag', 'ga', 'GoogleAnalyticsObject', 'google_tag_manager', 'dataLayer',
	'fbq', 'ttq', '_linkedin_partner_id', 'hj', 'clarity', 'mixpanel', 'amplitude', 'posthog', 'plausible', '_hsq',
	'hbspt', 'klaviyo', 'Intercom', '$crisp', 'Tawk_API', 'zE', 'drift', 'Sentry', '__SENTRY__', 'DD_RUM', 'LogRocket',
	'NREUM', 'newrelic', 'Stripe', 'paypal', 'grecaptcha', 'hcaptcha', 'turnstile', 'Cookiebot', 'OneTrust',
	'OptanonWrapper', '__APOLLO_STATE__', '__APOLLO_CLIENT__', '__PRELOADED_STATE__', '__REDUX_STATE__',
	'__REACT_QUERY_STATE__', 'firebase', 'io', '_', '_.VERSION', 'moment', 'moment.version', 'dayjs', 'i18next',
	'google.maps', 'mapboxgl', 'L.version', 'Chart', 'd3', 'd3.version', 'workbox', 'Calendly',
];

export interface NetworkEntry {
	url: string;
	method: string;
	type: string;
	status: number;
	mime: string;
	size: number;
	fromCache: boolean;
	failed?: string;
	blocked?: boolean;
	preview?: string;
}

export interface BrowserCollectResult {
	finalUrl: string;
	status: number;
	headers: Record<string, string>;
	page: any;
	globals: Record<string, string | boolean>;
	domSignals: Record<string, number>;
	rootVariables: Record<string, string>;
	responsive: any[];
	screenshots: { desktop?: { data: string; width: number; height: number }; mobile?: { data: string; width: number; height: number } };
	network: NetworkEntry[];
	stylesheets: { url: string; text: string; bytes: number; truncated: boolean }[];
	scripts: { url: string; bytes: number; sample: string }[];
	cookies: string[];
	consoleErrors: string[];
	blockedRequests: string[];
	timings: Record<string, number>;
}

const MAX_CSS_TOTAL = 5_000_000;
const MAX_CSS_FILE = 1_500_000;
const MAX_SCRIPTS = 30;
const MAX_SCRIPT_SAMPLE = 350_000;
const MAX_REQUESTS = 600;

export class SiteBrowser {
	private readonly logger = new Logger(SiteBrowser.name);
	private browser: Browser | null = null;
	private launching: Promise<Browser> | null = null;
	private active = 0;
	private readonly waiters: (() => void)[] = [];
	private idleTimer: NodeJS.Timeout | null = null;

	constructor(private readonly maxConcurrent = 2) {}

	private async getBrowser(): Promise<Browser> {
		if (this.browser?.connected) return this.browser;
		if (this.launching) return this.launching;
		const noSandbox = String(process.env.SITE_INSPECTOR_NO_SANDBOX || '').toLowerCase() === 'true';
		this.launching = puppeteer
			.launch({
				headless: true,
				executablePath: process.env.SITE_INSPECTOR_CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
				args: [
					'--disable-dev-shm-usage',
					'--disable-gpu',
					'--no-first-run',
					'--no-default-browser-check',
					'--disable-background-networking',
					'--disable-component-update',
					'--disable-sync',
					'--no-pings',
					'--mute-audio',
					'--hide-scrollbars',
					...(noSandbox ? ['--no-sandbox', '--disable-setuid-sandbox'] : []),
				],
			})
			.then(browser => {
				this.browser = browser;
				browser.on('disconnected', () => {
					this.browser = null;
				});
				return browser;
			})
			.finally(() => {
				this.launching = null;
			});
		return this.launching;
	}

	async isAvailable() {
		try {
			await this.getBrowser();
			return true;
		} catch (err) {
			this.logger.warn(`Headless Chrome unavailable: ${err instanceof Error ? err.message : String(err)}`);
			return false;
		}
	}

	private async acquire() {
		if (this.idleTimer) {
			clearTimeout(this.idleTimer);
			this.idleTimer = null;
		}
		if (this.active < this.maxConcurrent) {
			this.active++;
			return;
		}
		await new Promise<void>(resolve => this.waiters.push(resolve));
		this.active++;
	}

	private release() {
		this.active--;
		const next = this.waiters.shift();
		if (next) next();
		else if (this.active === 0) {
			this.idleTimer = setTimeout(() => {
				this.browser?.close().catch(() => undefined);
				this.browser = null;
			}, 120_000);
		}
	}

	get queueLength() {
		return this.waiters.length;
	}

	async collect(url: string, { timeoutMs = 75_000 }: { timeoutMs?: number } = {}): Promise<BrowserCollectResult> {
		await this.acquire();
		const browser = await this.getBrowser().catch(err => {
			this.release();
			throw err;
		});
		const context = await browser.createBrowserContext();
		let timer: NodeJS.Timeout | null = null;
		try {
			return await Promise.race([
				this.run(context, url),
				new Promise<never>((_, reject) => {
					timer = setTimeout(() => reject(new Error('Browser analysis timed out')), timeoutMs);
				}),
			]);
		} finally {
			if (timer) clearTimeout(timer);
			await context.close().catch(() => undefined);
			this.release();
		}
	}

	private async run(context: Awaited<ReturnType<Browser['createBrowserContext']>>, url: string): Promise<BrowserCollectResult> {
		const t0 = Date.now();
		const timings: Record<string, number> = {};
		const page = await context.newPage();
		await page.setUserAgent(BROWSER_UA);
		await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
		await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
		await page.evaluateOnNewDocument(() => {
			const deny = function () {
				throw new Error('Blocked by site inspector sandbox');
			};
			try {
				Object.defineProperty(navigator, 'serviceWorker', { get: () => undefined });
			} catch {
				/* ignore */
			}
			for (const key of ['WebSocket', 'RTCPeerConnection', 'webkitRTCPeerConnection', 'Worker', 'SharedWorker']) {
				try {
					Object.defineProperty(window, key, { value: deny, writable: false, configurable: false });
				} catch {
					/* ignore */
				}
			}
		});

		const hostChecks = new Map<string, Promise<boolean>>();
		const isHostAllowed = (hostname: string) => {
			if (!hostChecks.has(hostname)) {
				hostChecks.set(
					hostname,
					isBlockedHostname(hostname)
						? Promise.resolve(false)
						: resolvePublicHost(hostname).then(
								() => true,
								() => false,
							),
				);
			}
			return hostChecks.get(hostname)!;
		};

		const network: NetworkEntry[] = [];
		const byUrl = new Map<string, NetworkEntry>();
		const transfer = new Map<string, number>();
		const stylesheets: BrowserCollectResult['stylesheets'] = [];
		const scripts: BrowserCollectResult['scripts'] = [];
		const blockedRequests: string[] = [];
		const consoleErrors: string[] = [];
		const pending: Promise<unknown>[] = [];
		let cssTotal = 0;
		let requestCount = 0;
		let apiPreviews = 0;
		let mainResponse: HTTPResponse | null = null;

		const cdp = await page.createCDPSession();
		await cdp.send('Network.enable');
		const idToUrl = new Map<string, string>();
		cdp.on('Network.responseReceived', (e: any) => idToUrl.set(e.requestId, e.response?.url));
		cdp.on('Network.loadingFinished', (e: any) => {
			const u = idToUrl.get(e.requestId);
			if (u) transfer.set(u, e.encodedDataLength || 0);
		});

		await page.setRequestInterception(true);
		page.on('request', async (req: HTTPRequest) => {
			if (req.isInterceptResolutionHandled()) return;
			const reqUrl = req.url();
			try {
				if (reqUrl.startsWith('data:') || reqUrl.startsWith('blob:')) return void (await req.continue());
				const parsed = new URL(reqUrl);
				if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
					blockedRequests.push(reqUrl.slice(0, 200));
					return void (await req.abort('blockedbyclient'));
				}
				requestCount++;
				if (requestCount > MAX_REQUESTS || req.resourceType() === 'media') {
					return void (await req.abort('blockedbyclient'));
				}
				if (!(await isHostAllowed(parsed.hostname))) {
					blockedRequests.push(reqUrl.slice(0, 200));
					return void (await req.abort('blockedbyclient'));
				}
				await req.continue();
			} catch {
				if (!req.isInterceptResolutionHandled()) await req.abort('failed').catch(() => undefined);
			}
		});

		const mainHost = new URL(url).hostname.replace(/^www\./, '');
		page.on('response', (res: HTTPResponse) => {
			const req = res.request();
			const resUrl = res.url();
			if (resUrl.startsWith('data:')) return;
			const headers = res.headers();
			const type = req.resourceType();
			if (type === 'document' && req.frame() === page.mainFrame()) mainResponse = res;
			if (network.length >= MAX_REQUESTS) return;
			const entry: NetworkEntry = {
				url: resUrl,
				method: req.method(),
				type,
				status: res.status(),
				mime: (headers['content-type'] || '').split(';')[0],
				size: Number(headers['content-length']) || 0,
				fromCache: res.fromCache(),
			};
			network.push(entry);
			byUrl.set(resUrl, entry);
			const isRedirect = res.status() >= 300 && res.status() < 400;
			if (isRedirect) return;

			if (type === 'stylesheet' && cssTotal < MAX_CSS_TOTAL) {
				pending.push(
					res
						.text()
						.then(text => {
							const truncated = text.length > MAX_CSS_FILE;
							const body = truncated ? text.slice(0, MAX_CSS_FILE) : text;
							cssTotal += body.length;
							stylesheets.push({ url: resUrl, text: body, bytes: text.length, truncated });
						})
						.catch(() => undefined),
				);
			} else if (type === 'script' && scripts.length < MAX_SCRIPTS) {
				pending.push(
					res
						.buffer()
						.then(buf => {
							if (!entry.size) entry.size = buf.length;
							scripts.push({ url: resUrl, bytes: buf.length, sample: buf.toString('utf8', 0, Math.min(buf.length, MAX_SCRIPT_SAMPLE)) });
						})
						.catch(() => undefined),
				);
			} else if ((type === 'xhr' || type === 'fetch') && req.method() === 'GET' && /json|text\/plain|graphql/.test(entry.mime) && apiPreviews < 25) {
				apiPreviews++;
				pending.push(
					res
						.text()
						.then(text => {
							entry.preview = text.slice(0, 3000);
						})
						.catch(() => undefined),
				);
			}
		});
		page.on('requestfailed', (req: HTTPRequest) => {
			if (network.length >= MAX_REQUESTS) return;
			const failure = req.failure()?.errorText || 'failed';
			network.push({
				url: req.url(),
				method: req.method(),
				type: req.resourceType(),
				status: 0,
				mime: '',
				size: 0,
				fromCache: false,
				failed: failure,
				blocked: /BLOCKED_BY_CLIENT/i.test(failure),
			});
		});
		page.on('console', msg => {
			if (msg.type() === 'error' && consoleErrors.length < 25) consoleErrors.push(msg.text().slice(0, 300));
		});
		page.on('pageerror', err => {
			if (consoleErrors.length < 25) consoleErrors.push(String((err as Error)?.message || err).slice(0, 300));
		});
		page.on('dialog', dialog => dialog.dismiss().catch(() => undefined));

		try {
			await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
		} catch (err) {
			if (!mainResponse) throw err;
		}
		timings.navigation = Date.now() - t0;
		await page.waitForNetworkIdle({ idleTime: 700, timeout: 12_000 }).catch(() => undefined);
		timings.networkIdle = Date.now() - t0;

		const finalHost = new URL(page.url()).hostname;
		if (!(await isHostAllowed(finalHost))) throw new Error('Page redirected to a non-public address');

		await page.evaluate(autoScrollPage, 14_000).catch(() => undefined);
		await page.evaluate(() => (document as any).fonts?.ready).catch(() => undefined);
		await page.waitForNetworkIdle({ idleTime: 500, timeout: 5_000 }).catch(() => undefined);
		timings.scrolled = Date.now() - t0;

		const screenshots: BrowserCollectResult['screenshots'] = {};
		const docHeight = await page.evaluate(() => document.documentElement.scrollHeight).catch(() => 800);
		const shotHeight = Math.max(400, Math.min(docHeight, 7000));
		try {
			const data = (await page.screenshot({
				type: 'jpeg',
				quality: 58,
				clip: { x: 0, y: 0, width: 1280, height: shotHeight },
				captureBeyondViewport: true,
				encoding: 'base64',
			})) as string;
			screenshots.desktop = { data, width: 1280, height: shotHeight };
		} catch (err) {
			this.logger.warn(`Desktop screenshot failed: ${err instanceof Error ? err.message : err}`);
		}
		timings.screenshot = Date.now() - t0;

		const pageData = await page.evaluate(collectPage, { maxInspect: 1800, maxHtml: 1_200_000 });
		const globals = await page.evaluate(readGlobals, GLOBAL_PATHS).catch(() => ({}));
		const domSignals = await page.evaluate(readDomSignals).catch(() => ({}));
		await Promise.race([Promise.allSettled(pending), new Promise(r => setTimeout(r, 6_000))]);
		const varNames = new Set<string>();
		for (const text of [...stylesheets.map(s => s.text), ...(pageData.styleBlocks || [])]) {
			for (const m of text.matchAll(/(--[\w-]+)\s*:/g)) {
				varNames.add(m[1]);
				if (varNames.size >= 800) break;
			}
		}
		const rootVariables = await page.evaluate(resolveRootVariables, [...varNames]).catch(() => ({}));
		timings.collected = Date.now() - t0;

		const responsive: any[] = [];
		const desktopMetrics = await page.evaluate(measureViewport).catch(() => null);
		if (desktopMetrics) responsive.push({ name: 'desktop', ...desktopMetrics });
		for (const vp of [
			{ name: 'tablet', width: 768, height: 1024, isMobile: true },
			{ name: 'mobile', width: 390, height: 844, isMobile: true },
		]) {
			try {
				await page.setViewport({ width: vp.width, height: vp.height, isMobile: vp.isMobile, hasTouch: true, deviceScaleFactor: 1 });
				await new Promise(r => setTimeout(r, 450));
				const metrics = await page.evaluate(measureViewport);
				responsive.push({ name: vp.name, ...metrics });
				if (vp.name === 'mobile') {
					const data = (await page.screenshot({ type: 'jpeg', quality: 60, encoding: 'base64' })) as string;
					screenshots.mobile = { data, width: vp.width, height: vp.height };
				}
			} catch {
				/* keep partial responsive data */
			}
		}
		timings.responsive = Date.now() - t0;

		await Promise.race([Promise.allSettled(pending), new Promise(r => setTimeout(r, 3_000))]);
		const cookies = (await page.cookies().catch(() => [])).map(c => c.name).slice(0, 60);
		for (const [u, bytes] of transfer) {
			const entry = byUrl.get(u);
			if (entry && bytes) entry.size = bytes;
		}
		for (const entry of network) {
			try {
				const host = new URL(entry.url).hostname.replace(/^www\./, '');
				(entry as any).thirdParty = !(host === mainHost || host.endsWith(`.${mainHost}`) || mainHost.endsWith(`.${host}`));
			} catch {
				(entry as any).thirdParty = true;
			}
		}

		const resolvedMain = mainResponse as HTTPResponse | null;
		return {
			finalUrl: page.url(),
			status: resolvedMain?.status() ?? 0,
			headers: resolvedMain?.headers() ?? {},
			page: pageData,
			globals,
			domSignals,
			rootVariables,
			responsive,
			screenshots,
			network,
			stylesheets,
			scripts,
			cookies,
			consoleErrors,
			blockedRequests: blockedRequests.slice(0, 40),
			timings,
		};
	}

	async shutdown() {
		if (this.idleTimer) clearTimeout(this.idleTimer);
		await this.browser?.close().catch(() => undefined);
		this.browser = null;
	}
}
