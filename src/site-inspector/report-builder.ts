import type { BrowserCollectResult, NetworkEntry } from './browser-collector';
import { colorLuminance, colorSaturation, normalizeColor } from './color-utils';
import type { ClassTokenAnalysis, CssAnalysis } from './css-analyzer';
import type { StaticHtml } from './html-static';
import type { DetectedTech } from './tech-signatures';

type Tally = Record<string, number>;

const LIMITS = {
	rawHtml: 400_000,
	renderedHtml: 400_000,
	stylesheet: 200_000,
	stylesheetsTotal: 1_200_000,
	scriptSample: 30_000,
	scripts: 16,
	inlineScript: 20_000,
	inlineScripts: 30,
	styleBlock: 60_000,
	json: 60_000,
	requests: 400,
};

export const px = (value: string | number | undefined) => {
	const n = parseFloat(String(value ?? ''));
	return Number.isFinite(n) ? n : 0;
};

const top = (map: Tally | undefined, n: number) =>
	Object.entries(map || {})
		.sort((a, b) => b[1] - a[1])
		.slice(0, n)
		.map(([value, count]) => ({ value, count }));

const clip = (text: string | undefined, max: number) => {
	const value = String(text || '');
	return value.length > max ? { text: value.slice(0, max), truncated: true, bytes: value.length } : { text: value, truncated: false, bytes: value.length };
};

const hostOf = (url: string) => {
	try {
		return new URL(url).hostname.replace(/^www\./, '');
	} catch {
		return '';
	}
};

/** Shapes the regex-based static extraction like the in-browser collector so one builder serves both modes. */
export function staticToPage(st: StaticHtml, finalUrl: string) {
	return {
		url: finalUrl,
		title: st.title,
		lang: st.lang,
		dir: st.dir,
		viewport: null,
		docWidth: 0,
		docHeight: 0,
		renderedHtml: '',
		renderedHtmlTruncated: false,
		meta: st.meta,
		links: st.links.map(l => ({ rel: l.rel || '', href: l.href || '', hreflang: l.hreflang || '', as: l.as || '', type: l.type || '', media: l.media || '' })),
		jsonLd: st.jsonLd,
		jsonScripts: st.jsonScripts,
		headings: st.headings,
		anchors: st.anchors.map(a => a.href),
		scripts: st.scripts,
		styleBlocks: st.styleBlocks,
		inlineStyles: st.inlineStyles.map(s => ({ selector: s.tag, style: s.style })),
		classCounts: st.classCounts,
		styles: {},
		typography: { headings: {} },
		components: { buttons: [], inputs: [], cards: [], badges: [], navigation: [], footer: null, hero: null, sections: [] },
		animations: { runtime: [], transitions: [], attributes: {}, gsap: null, willChange: {} },
		tree: null,
		inspect: [],
		assets: {
			images: st.images.map(i => ({ src: i.src, alt: i.alt, loading: i.loading || '', srcset: i.srcset })),
			backgrounds: [],
			videos: st.videos,
			iframes: st.iframes,
			icons: st.links.filter(l => /icon|manifest/i.test(l.rel || '')).map(l => ({ rel: l.rel, href: l.href, sizes: l.sizes || '', type: l.type || '' })),
			svgs: st.svgs.map(markup => ({ markup, cls: '', viewBox: (markup.match(/viewBox="([^"]+)"/i) || [])[1] || '', width: 0, height: 0, selector: '' })),
			fonts: [],
		},
		counts: { elements: st.elementCount, images: st.images.length, videos: st.videos.length, iframes: st.iframes.length, svgs: st.svgs.length, links: st.anchors.length },
	};
}

/* ───────────── Design system ───────────── */

export function buildColors(page: any, css: CssAnalysis, rootVariables: Record<string, string>, buttonBg?: string | null) {
	const byHex = new Map<string, { hex: string; count: number; roles: Set<string> }>();
	const add = (raw: string, count: number, role: string) => {
		const hex = normalizeColor(raw);
		if (!hex) return;
		const key = hex.length === 9 && hex.endsWith('ff') ? hex.slice(0, 7) : hex;
		const entry = byHex.get(key) || { hex: key, count: 0, roles: new Set<string>() };
		entry.count += count;
		entry.roles.add(role);
		byHex.set(key, entry);
	};
	const styles = page.styles || {};
	for (const [c, n] of Object.entries<number>(styles.colorsText || {})) add(c, n, 'text');
	for (const [c, n] of Object.entries<number>(styles.colorsBg || {})) add(c, n, 'background');
	for (const [c, n] of Object.entries<number>(styles.colorsBorder || {})) add(c, n, 'border');
	const hasComputed = byHex.size > 0;
	for (const c of css.authoredColors.slice(0, 60)) add(c.hex, hasComputed ? 0 : c.count, 'css');

	const palette = [...byHex.values()]
		.filter(e => e.count > 0 || !hasComputed)
		.sort((a, b) => b.count - a.count)
		.slice(0, 48)
		.map(e => {
			const sat = colorSaturation(e.hex);
			const lum = colorLuminance(e.hex);
			return {
				hex: e.hex,
				count: e.count,
				roles: [...e.roles].filter(r => r !== 'css' || e.roles.size === 1),
				saturation: Math.round(sat * 100) / 100,
				luminance: Math.round(lum * 1000) / 1000,
				group: sat < 0.14 || lum > 0.93 || lum < 0.012 ? 'neutral' : 'brand',
			};
		});

	const topRole = (role: string, skip: string[] = []) =>
		[...byHex.values()].filter(e => e.roles.has(role) && !skip.includes(e.hex)).sort((a, b) => b.count - a.count)[0]?.hex;
	const brand = palette.filter(p => p.group === 'brand');
	const normalizedButton = buttonBg ? normalizeColor(buttonBg) : null;
	const primary = normalizedButton && colorSaturation(normalizedButton) >= 0.2 ? normalizedButton.slice(0, 7) : brand[0]?.hex;
	const background = topRole('background');
	const text = topRole('text');
	const tokens = [
		{ token: 'background', hex: background },
		{ token: 'foreground', hex: text },
		{ token: 'primary', hex: primary },
		{ token: 'accent', hex: brand.find(b => b.hex !== primary)?.hex },
		{ token: 'muted-foreground', hex: topRole('text', [text]) },
		{ token: 'surface', hex: topRole('background', [background]) },
		{ token: 'border', hex: topRole('border') },
	].filter(t => t.hex);

	const variables = css.variables
		.filter(v => v.isColor || (rootVariables[v.name] && normalizeColor(rootVariables[v.name])))
		.slice(0, 120)
		.map(v => {
			const resolved = rootVariables[v.name] || v.value;
			return { name: v.name, value: v.value, resolved, hex: normalizeColor(resolved) || v.hex || null, scope: v.scope };
		});

	return {
		palette,
		brand: brand.slice(0, 10),
		neutrals: palette.filter(p => p.group === 'neutral').slice(0, 12),
		tokens,
		gradients: top(styles.gradients, 12),
		variables,
		source: hasComputed ? 'computed' : 'stylesheet',
	};
}

const TW_SCREENS: Record<number, string> = { 640: 'sm (Tailwind)', 768: 'md (Tailwind)', 1024: 'lg (Tailwind)', 1280: 'xl (Tailwind)', 1536: '2xl (Tailwind)' };
const BS_SCREENS: Record<number, string> = { 576: 'sm (Bootstrap)', 992: 'lg (Bootstrap)', 1200: 'xl (Bootstrap)', 1400: 'xxl (Bootstrap)' };

export function inferBaseUnit(spacing: Tally) {
	const entries = Object.entries(spacing || {})
		.map(([v, n]) => [px(v), n] as const)
		.filter(([v]) => v > 0 && v <= 200);
	const total = entries.reduce((s, [, n]) => s + n, 0);
	if (!total) return null;
	for (const unit of [8, 4]) {
		const fit = entries.filter(([v]) => Math.abs(v / unit - Math.round(v / unit)) < 0.01).reduce((s, [, n]) => s + n, 0) / total;
		if (fit >= (unit === 8 ? 0.8 : 0.7)) return { unit, fit: Math.round(fit * 100) };
	}
	const fit4 = entries.filter(([v]) => v % 4 === 0).reduce((s, [, n]) => s + n, 0) / total;
	return { unit: null, fit: Math.round(fit4 * 100) };
}

export function buildDesign(page: any, css: CssAnalysis, rootVariables: Record<string, string>, buttonBg?: string | null) {
	const styles = page.styles || {};
	const fontFaceFamilies = new Map(css.fontFaces.map(f => [f.family.toLowerCase(), f]));
	const linkHrefs = (page.links || []).map((l: any) => String(l.href || ''));
	const loadedFonts = (page.assets?.fonts || []) as { family: string; weight: string; status: string }[];

	const familyTally: Tally = {};
	const stacks: Record<string, string> = {};
	for (const [stack, n] of Object.entries<number>(styles.fonts || {})) {
		const first = stack.split(',')[0].replace(/['"]/g, '').trim();
		if (!first) continue;
		familyTally[first] = (familyTally[first] || 0) + n;
		stacks[first] ||= stack;
	}
	if (!Object.keys(familyTally).length) for (const f of css.fontFaces) familyTally[f.family] = (familyTally[f.family] || 0) + 1;
	const families = Object.entries(familyTally)
		.sort((a, b) => b[1] - a[1])
		.slice(0, 10)
		.map(([family, count]) => {
			const face = fontFaceFamilies.get(family.toLowerCase());
			const src = (face?.src || []).join(' ');
			const source = /fonts\.gstatic|fonts\.googleapis/.test(src) || linkHrefs.some((h: string) => /fonts\.googleapis\.com.*family=[^&]*/i.test(h) && decodeURIComponent(h).toLowerCase().includes(family.toLowerCase().replace(/\s+/g, '+').split('+')[0]))
				? 'Google Fonts'
				: /use\.typekit|typekit\.net/.test(src) || linkHrefs.some((h: string) => /typekit/.test(h))
					? 'Adobe Fonts'
					: /__next|_next\/static\/media/.test(src) || /^__/.test(family)
						? 'next/font (self-hosted)'
						: face
							? 'Self-hosted @font-face'
							: /system-ui|-apple-system|segoe|roboto|helvetica|arial|sans-serif|serif|monospace/i.test(family)
								? 'System font'
								: 'Unknown source';
			const weights = [...new Set(loadedFonts.filter(f => f.family.toLowerCase() === family.toLowerCase()).map(f => f.weight))].slice(0, 10);
			return { family, stack: stacks[family] || family, count, source, weights };
		});

	const headings = page.typography?.headings || {};
	const roleBySize: Record<string, string> = {};
	for (const [level, t] of Object.entries<any>(headings)) roleBySize[t.fontSize] ||= level;
	if (page.typography?.body?.fontSize) roleBySize[page.typography.body.fontSize] ||= 'body';
	const scale = Object.entries<number>(styles.sizes || {})
		.map(([size, count]) => ({ size, px: px(size), rem: Math.round((px(size) / 16) * 1000) / 1000, count, role: roleBySize[size] || '' }))
		.filter(s => s.count >= 2 || s.role)
		.sort((a, b) => b.px - a.px)
		.slice(0, 16);

	const spacingValues = Object.entries<number>(styles.spacing || {})
		.map(([value, count]) => ({ value, px: px(value), count }))
		.filter(s => s.count >= 3 && s.px > 0)
		.sort((a, b) => a.px - b.px)
		.slice(0, 20);

	const radii = top(styles.radii, 10).map(r => ({ ...r, px: px(r.value), label: px(r.value) >= 999 || r.value.includes('%') ? 'full' : '' }));
	const breakpoints = css.breakpoints.slice(0, 18).map(b => ({ ...b, label: TW_SCREENS[b.value] || BS_SCREENS[b.value] || '' }));

	return {
		colors: buildColors(page, css, rootVariables, buttonBg),
		typography: {
			families,
			scale,
			weights: top(styles.weights, 8).sort((a, b) => Number(a.value) - Number(b.value)),
			lineHeights: top(styles.lineHeights, 8),
			letterSpacings: top(styles.letterSpacings, 6),
			styles: page.typography || {},
			fontFaces: css.fontFaces.slice(0, 30),
		},
		spacing: { values: spacingValues, gaps: top(styles.gaps, 10), baseUnit: inferBaseUnit(styles.spacing || {}) },
		radii,
		shadows: top(styles.shadows, 10),
		zIndex: top(styles.zIndex, 10).sort((a, b) => Number(a.value) - Number(b.value)),
		containers: top(styles.maxWidths, 6),
		breakpoints,
		cssVariables: css.variables.slice(0, 400),
	};
}

/* ───────────── Components ───────────── */

export function nameButtonVariants(buttons: any[]) {
	const used = new Map<string, number>();
	let filledSeen = 0;
	return buttons.map(b => {
		const st = b.styles || {};
		const bg = normalizeColor(st.backgroundColor || '');
		const hasBorder = !!st.border;
		const sat = bg ? colorSaturation(bg) : 0;
		const lum = bg ? colorLuminance(bg) : 1;
		let name: string;
		if (b.iconOnly) name = 'Icon button';
		else if (bg && sat >= 0.2) name = filledSeen++ === 0 ? 'Primary' : 'Secondary';
		else if (!bg && hasBorder) name = 'Outline';
		else if (!bg) name = 'Ghost / Link';
		else if (lum < 0.2) name = 'Solid dark';
		else name = 'Soft / Neutral';
		const n = (used.get(name) || 0) + 1;
		used.set(name, n);
		const radius = px(st.borderRadius);
		const shape = radius >= 999 || (b.height && radius >= b.height / 2 - 1) ? 'pill' : radius === 0 ? 'square' : 'rounded';
		const size = b.height <= 32 ? 'sm' : b.height <= 44 ? 'md' : 'lg';
		return { ...b, name: n > 1 ? `${name} ${n}` : name, shape, size };
	});
}

export function buildComponents(page: any) {
	const c = page.components || {};
	const counts = page.counts || {};
	const patterns = [
		['Forms', counts.forms],
		['Tables', counts.tables],
		['Dialogs / modals', counts.dialogs],
		['Tabs', counts.tabs],
		['Accordions / disclosures', counts.accordions],
		['Carousels / sliders', counts.carousels],
		['Canvas / WebGL', counts.canvas],
		['Iframes / embeds', counts.iframes],
	]
		.filter(([, n]) => Number(n) > 0)
		.map(([name, count]) => ({ name, count }));
	return {
		buttons: nameButtonVariants(c.buttons || []),
		inputs: (c.inputs || []).map((i: any) => ({ ...i, name: (i.types || []).join(' / ') || 'input' })),
		cards: c.cards || [],
		badges: c.badges || [],
		navigation: c.navigation || [],
		footer: c.footer || null,
		hero: c.hero || null,
		sections: c.sections || [],
		patterns,
	};
}

/* ───────────── Animations ───────────── */

const ANIMATION_CATEGORIES = /animation|motion|scroll/i;

export function buildAnimations(page: any, css: CssAnalysis, tech: DetectedTech[]) {
	const a = page.animations || {};
	const styles = page.styles || {};
	const libraries = tech.filter(t => ANIMATION_CATEGORIES.test(t.category));
	const runtime = a.runtime || [];
	const keyframes = css.keyframes.slice(0, 60).map(k => ({
		...k,
		css: k.css.slice(0, 1500),
		running: runtime.filter((r: any) => r.name === k.name).length,
	}));
	return {
		libraries,
		keyframes,
		runtime,
		transitions: a.transitions || [],
		attributes: a.attributes || {},
		gsap: a.gsap || null,
		durations: top(styles.durations, 8),
		easings: top(styles.easings, 8),
		transitionProperties: top(styles.transitionProps, 8),
		willChange: top(a.willChange, 8),
		declarations: css.animationDeclarations.slice(0, 60),
		reducedMotion: css.features.reducedMotion,
		summary: {
			libraries: libraries.length,
			keyframes: css.keyframes.length,
			running: runtime.length,
			transitions: (a.transitions || []).length,
			scrollTriggers: a.gsap?.scrollTriggers?.length || 0,
		},
	};
}

/* ───────────── Assets ───────────── */

const extOf = (url: string) => {
	try {
		const m = new URL(url).pathname.toLowerCase().match(/\.([a-z0-9]{2,5})$/);
		return m ? m[1] : '';
	} catch {
		return '';
	}
};

export function buildAssets(page: any, css: CssAnalysis, network: NetworkEntry[]) {
	const sizeOf = new Map(network.map(n => [n.url, n.size]));
	const seen = new Set<string>();
	const images = (page.assets?.images || [])
		.filter((i: any) => i.src && !seen.has(i.src) && seen.add(i.src))
		.map((i: any) => ({ ...i, format: i.src.startsWith('data:') ? 'data-uri' : extOf(i.src) || 'unknown', bytes: sizeOf.get(i.src) || 0 }));
	const fontFiles = network
		.filter(n => n.type === 'font' || /\.(woff2?|ttf|otf|eot)(\?|$)/i.test(n.url))
		.map(n => ({ url: n.url, bytes: n.size, format: extOf(n.url), status: n.status }));
	return {
		images,
		backgrounds: page.assets?.backgrounds || [],
		videos: page.assets?.videos || [],
		iframes: page.assets?.iframes || [],
		icons: page.assets?.icons || [],
		svgs: page.assets?.svgs || [],
		fonts: { faces: css.fontFaces.slice(0, 40), loaded: page.assets?.fonts || [], files: fontFiles.slice(0, 40) },
		summary: {
			images: images.length,
			missingAlt: images.filter((i: any) => i.alt === null || i.alt === undefined).length,
			lazy: images.filter((i: any) => i.loading === 'lazy').length,
			svgs: page.counts?.svgs ?? (page.assets?.svgs || []).length,
			videos: (page.assets?.videos || []).length,
			fonts: fontFiles.length,
		},
	};
}

/* ───────────── SEO ───────────── */

export function buildSeo(page: any, finalUrl: string) {
	const meta: { key: string; content: string }[] = page.meta || [];
	const get = (key: string) => meta.find(m => m.key.toLowerCase() === key.toLowerCase())?.content || '';
	const links: any[] = page.links || [];
	const canonical = links.find(l => /(^|\s)canonical(\s|$)/i.test(l.rel))?.href || '';
	const headings: { level: number; text: string }[] = page.headings || [];
	const h1Count = headings.filter(h => h.level === 1).length;
	const images: any[] = page.assets?.images || [];
	const missingAlt = images.filter(i => i.alt === null || i.alt === undefined).length;
	const title = page.title || '';
	const description = get('description');
	const robots = get('robots');
	const host = hostOf(finalUrl);
	const anchors: string[] = page.anchors || [];
	const internal = anchors.filter(h => hostOf(h) === host).length;
	const openGraph = Object.fromEntries(meta.filter(m => m.key.startsWith('og:')).map(m => [m.key, m.content]));
	const twitter = Object.fromEntries(meta.filter(m => m.key.startsWith('twitter:')).map(m => [m.key, m.content]));

	const check = (id: string, ok: boolean, level: 'error' | 'warning' | 'info', message: string) => ({ id, ok, level, message });
	const checks = [
		check('title', title.length >= 10 && title.length <= 65, 'error', `Title length ${title.length} (recommended 10–65)`),
		check('description', description.length >= 50 && description.length <= 165, 'warning', description ? `Description length ${description.length} (recommended 50–165)` : 'Missing meta description'),
		check('h1', h1Count === 1, 'warning', `${h1Count} <h1> element(s) (recommended exactly 1)`),
		check('lang', !!page.lang, 'warning', page.lang ? `lang="${page.lang}"` : 'Missing <html lang>'),
		check('viewport', !!get('viewport'), 'error', get('viewport') ? 'Responsive viewport meta present' : 'Missing viewport meta'),
		check('canonical', !!canonical, 'info', canonical ? 'Canonical URL set' : 'No canonical link'),
		check('og', !!openGraph['og:title'] && !!openGraph['og:image'], 'info', openGraph['og:image'] ? 'Open Graph title + image present' : 'Open Graph image missing'),
		check('alt', missingAlt === 0, 'warning', `${missingAlt} of ${images.length} images without alt attribute`),
		check('https', finalUrl.startsWith('https://'), 'error', finalUrl.startsWith('https://') ? 'Served over HTTPS' : 'Not served over HTTPS'),
		check('indexable', !/noindex/i.test(robots), 'warning', /noindex/i.test(robots) ? `robots: ${robots}` : 'Indexable (no noindex)'),
		check('structured', (page.jsonLd || []).length > 0, 'info', `${(page.jsonLd || []).length} JSON-LD block(s)`),
		check('favicon', links.some(l => /icon/i.test(l.rel)), 'info', links.some(l => /icon/i.test(l.rel)) ? 'Favicon declared' : 'No favicon link'),
	];
	const score = Math.round((checks.filter(c => c.ok).length / checks.length) * 100);
	return {
		title,
		description,
		canonical,
		robots,
		lang: page.lang,
		dir: page.dir,
		viewport: get('viewport'),
		charset: get('charset'),
		themeColor: get('theme-color'),
		openGraph,
		twitter,
		hreflang: links.filter(l => l.hreflang).map(l => ({ lang: l.hreflang, href: l.href })),
		headings: headings.slice(0, 60),
		h1Count,
		jsonLd: (page.jsonLd || []).slice(0, 10),
		links: { total: anchors.length, internal, external: anchors.length - internal },
		meta: meta.slice(0, 120),
		checks,
		score,
	};
}

/* ───────────── Network ───────────── */

const SECURITY_HEADERS = [
	'content-security-policy',
	'strict-transport-security',
	'x-frame-options',
	'x-content-type-options',
	'referrer-policy',
	'permissions-policy',
	'cross-origin-opener-policy',
	'cross-origin-resource-policy',
];

export function buildNetwork(finalUrl: string, headers: Record<string, string>, browser: BrowserCollectResult | null) {
	const requests = browser?.network || [];
	const byType: Record<string, { count: number; bytes: number }> = {};
	const domains: Record<string, { domain: string; count: number; bytes: number; thirdParty: boolean }> = {};
	let totalBytes = 0;
	for (const r of requests) {
		const t = byType[r.type] || (byType[r.type] = { count: 0, bytes: 0 });
		t.count++;
		t.bytes += r.size;
		totalBytes += r.size;
		const d = hostOf(r.url);
		if (!d) continue;
		const e = domains[d] || (domains[d] = { domain: d, count: 0, bytes: 0, thirdParty: !!(r as any).thirdParty });
		e.count++;
		e.bytes += r.size;
	}
	const apis = requests
		.filter(r => r.type === 'xhr' || r.type === 'fetch' || r.type === 'eventsource' || r.type === 'websocket')
		.slice(0, 80)
		.map(r => ({ ...r, graphql: /graphql/i.test(r.url) || /^\s*\{\s*"data"\s*:/.test(r.preview || '') }));
	const safeHeaders = Object.fromEntries(Object.entries(headers).filter(([k]) => k !== 'set-cookie'));
	return {
		finalUrl,
		status: 0,
		headers: safeHeaders,
		security: SECURITY_HEADERS.map(name => ({ name, present: !!headers[name], value: (headers[name] || '').slice(0, 300) })),
		requests: requests.slice(0, LIMITS.requests).map(({ preview, ...rest }) => rest),
		requestCount: requests.length,
		totalBytes,
		byType: Object.entries(byType)
			.map(([type, v]) => ({ type, ...v }))
			.sort((a, b) => b.bytes - a.bytes),
		domains: Object.values(domains)
			.sort((a, b) => b.count - a.count)
			.slice(0, 40),
		apis,
		cookies: browser?.cookies || [],
		consoleErrors: browser?.consoleErrors || [],
		blocked: browser?.blockedRequests || [],
		timings: browser?.timings || {},
	};
}

/* ───────────── Responsive ───────────── */

export function buildResponsive(browser: BrowserCollectResult | null, css: CssAnalysis) {
	const viewports = browser?.responsive || [];
	const byName = Object.fromEntries(viewports.map(v => [v.name, v]));
	const d = byName.desktop;
	const m = byName.mobile;
	const notes: { level: 'info' | 'warning'; text: string }[] = [];
	if (m?.overflowX) notes.push({ level: 'warning', text: `Horizontal overflow at ${m.width}px (document is ${m.docWidth}px wide)` });
	if (d && m) {
		if (m.hamburger && d.navLinksVisible > m.navLinksVisible) notes.push({ level: 'info', text: `Navigation collapses into a menu button on mobile (${d.navLinksVisible} → ${m.navLinksVisible} visible links)` });
		if (d.maxGridColumns > m.maxGridColumns) notes.push({ level: 'info', text: `Grids reflow from ${d.maxGridColumns} to ${m.maxGridColumns} column(s)` });
		if (d.h1Size && m.h1Size && d.h1Size !== m.h1Size) notes.push({ level: 'info', text: `Heading scales ${d.h1Size} → ${m.h1Size} (responsive / fluid type)` });
		if (d.hiddenLandmarks < m.hiddenLandmarks) notes.push({ level: 'info', text: `${m.hiddenLandmarks - d.hiddenLandmarks} navigation/sidebar region(s) hidden on mobile` });
		if (d.containerWidth) notes.push({ level: 'info', text: `Main container max width ≈ ${d.containerWidth}px on desktop` });
	}
	if (css.features.containerQueries) notes.push({ level: 'info', text: 'Uses CSS container queries' });
	if (!viewports.length) notes.push({ level: 'warning', text: 'Viewport testing requires the headless browser (not available for this run)' });
	return { viewports, breakpoints: css.breakpoints.slice(0, 18), notes, mobileFirst: css.breakpoints.filter(b => b.type === 'min').length >= css.breakpoints.filter(b => b.type === 'max').length };
}

/* ───────────── Source ───────────── */

export function buildSource(input: {
	rawHtml: string;
	page: any;
	stylesheets: { url: string; text: string; bytes: number; truncated: boolean }[];
	scripts: { url: string; bytes: number; sample: string }[];
	css: CssAnalysis;
	classes: ClassTokenAnalysis;
	sourceMaps: { url: string; sources: string[]; error?: string }[];
}) {
	let budget = LIMITS.stylesheetsTotal;
	const stylesheets = input.stylesheets.map(s => {
		const allowed = Math.max(0, Math.min(LIMITS.stylesheet, budget));
		budget -= Math.min(s.text.length, allowed);
		const c = clip(s.text, allowed);
		return { url: s.url, bytes: s.bytes, text: c.text, truncated: s.truncated || c.truncated };
	});
	const page = input.page;
	const inlineScripts = (page.scripts || [])
		.filter((s: any) => s.inline && s.inline.trim())
		.slice(0, LIMITS.inlineScripts)
		.map((s: any) => ({ id: s.id || '', type: s.type || 'text/javascript', ...clip(s.inline, LIMITS.inlineScript) }));
	const raw = clip(input.rawHtml, LIMITS.rawHtml);
	const rendered = clip(page.renderedHtml, LIMITS.renderedHtml);
	return {
		rawHtml: { ...raw, label: 'extracted' },
		renderedHtml: { ...rendered, truncated: rendered.truncated || !!page.renderedHtmlTruncated, label: 'extracted' },
		stylesheets,
		styleBlocks: (page.styleBlocks || []).slice(0, 40).map((text: string, i: number) => ({ index: i, ...clip(text, LIMITS.styleBlock) })),
		inlineStyles: page.inlineStyles || [],
		scripts: input.scripts.slice(0, LIMITS.scripts).map(s => ({ url: s.url, bytes: s.bytes, ...clip(s.sample, LIMITS.scriptSample), minified: /\n/.test(s.sample.slice(0, 5000)) ? false : s.sample.length > 2000 })),
		scriptTags: (page.scripts || []).filter((s: any) => s.src).map((s: any) => ({ src: s.src, type: s.type, async: s.async, defer: s.defer, module: s.module })),
		inlineScripts,
		jsonData: [
			...(page.jsonLd || []).map((j: unknown, i: number) => ({ id: `ld+json #${i + 1}`, type: 'application/ld+json', ...clip(JSON.stringify(j, null, 2), LIMITS.json) })),
			...(page.jsonScripts || []).map((j: any) => ({ id: j.id || '(no id)', type: j.type, ...clip(prettyJson(j.json), LIMITS.json) })),
		],
		svgs: (page.assets?.svgs || []).map((s: any) => ({ markup: s.markup, viewBox: s.viewBox, selector: s.selector, width: s.width, height: s.height })),
		cssVariables: input.css.variables.slice(0, 600),
		classes: input.classes,
		domTree: page.tree || null,
		sourceMaps: input.sourceMaps,
		css: {
			bytes: input.css.bytes,
			ruleCount: input.css.ruleCount,
			mediaQueryCount: input.css.mediaQueryCount,
			importantCount: input.css.importantCount,
			layers: input.css.layers,
			features: input.css.features,
		},
	};
}

function prettyJson(text: string) {
	try {
		return JSON.stringify(JSON.parse(text), null, 2);
	} catch {
		return text;
	}
}

export function findSourceMapUrls(files: { url: string; text: string }[], max = 3) {
	const out: string[] = [];
	for (const f of files) {
		const m = f.text.slice(-600).match(/[#@]\s*sourceMappingURL=([^\s*'"]+)/);
		if (!m || m[1].startsWith('data:')) continue;
		try {
			const abs = new URL(m[1], f.url).toString();
			if (!out.includes(abs)) out.push(abs);
		} catch {
			/* ignore malformed */
		}
		if (out.length >= max) break;
	}
	return out;
}
