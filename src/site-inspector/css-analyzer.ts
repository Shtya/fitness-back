import { normalizeColor } from './color-utils';

export interface CssSource {
	url: string;
	text: string;
}

export interface CssVariable {
	name: string;
	value: string;
	scope: string;
	isColor: boolean;
	hex?: string;
}

export interface KeyframeInfo {
	name: string;
	css: string;
	source: string;
	usedBy: string[];
}

export interface FontFaceInfo {
	family: string;
	weight: string;
	style: string;
	display: string;
	src: string[];
}

export interface CssBanner {
	name: string;
	version?: string;
	source: string;
}

export interface CssAnalysis {
	bytes: number;
	ruleCount: number;
	mediaQueryCount: number;
	importantCount: number;
	variables: CssVariable[];
	breakpoints: { value: number; unit: 'px'; type: 'min' | 'max'; count: number }[];
	keyframes: KeyframeInfo[];
	fontFaces: FontFaceInfo[];
	banners: CssBanner[];
	layers: string[];
	features: { containerQueries: boolean; cssNesting: boolean; propertyRules: number; supportsRules: number; darkModeMedia: boolean; reducedMotion: boolean };
	animationDeclarations: { selector: string; value: string }[];
	authoredColors: { hex: string; count: number }[];
}

const COLOR_TOKEN = /#[0-9a-fA-F]{3,8}\b|(?:rgba?|hsla?|oklch|oklab|lab|lch)\([^)]*\)/g;

function stripComments(text: string) {
	return text.replace(/\/\*(?!!)[\s\S]*?\*\//g, '');
}

/** Returns the block body after `openIndex` (index of `{`) using brace matching. */
function readBlock(text: string, openIndex: number) {
	let depth = 0;
	for (let i = openIndex; i < text.length; i++) {
		const ch = text[i];
		if (ch === '{') depth++;
		else if (ch === '}') {
			depth--;
			if (depth === 0) return { body: text.slice(openIndex + 1, i), end: i };
		}
	}
	return { body: text.slice(openIndex + 1), end: text.length };
}

function toPx(value: number, unit: string) {
	if (unit === 'em' || unit === 'rem') return Math.round(value * 16);
	return Math.round(value);
}

const BANNERS: { name: string; re: RegExp }[] = [
	{ name: 'Tailwind CSS', re: /tailwindcss\s+v?(\d+\.\d+\.\d+)/i },
	{ name: 'Bootstrap', re: /Bootstrap\s+v?(\d+\.\d+\.\d+)/i },
	{ name: 'Bulma', re: /bulma\.io\s+v?(\d+\.\d+\.\d+)|Bulma\s+v?(\d+\.\d+\.\d+)/i },
	{ name: 'Foundation', re: /Foundation for Sites\s+v?(\d+\.\d+\.\d+)/i },
	{ name: 'Animate.css', re: /animate\.css\s+-?\s*v?(\d+\.\d+\.\d+)/i },
	{ name: 'Font Awesome', re: /Font Awesome (?:Free|Pro)\s+(\d+\.\d+\.\d+)/i },
	{ name: 'Bootstrap Icons', re: /Bootstrap Icons\s+v?(\d+\.\d+\.\d+)/i },
	{ name: 'normalize.css', re: /normalize\.css\s+v?(\d+\.\d+\.\d+)/i },
	{ name: 'Swiper', re: /Swiper\s+(\d+\.\d+\.\d+)/i },
	{ name: 'AOS', re: /\[data-aos\]/ },
	{ name: 'UIkit', re: /UIkit\s+(\d+\.\d+\.\d+)/i },
	{ name: 'Materialize', re: /Materialize\s+v?(\d+\.\d+\.\d+)/i },
	{ name: 'Semantic UI', re: /Semantic UI\s+(\d+\.\d+\.\d+)/i },
	{ name: 'Pico CSS', re: /Pico CSS\s+.*?v?(\d+\.\d+\.\d+)/i },
];

export function analyzeCss(sources: CssSource[]): CssAnalysis {
	const variables = new Map<string, CssVariable>();
	const breakpoints = new Map<string, { value: number; unit: 'px'; type: 'min' | 'max'; count: number }>();
	const keyframes = new Map<string, KeyframeInfo>();
	const fontFaces: FontFaceInfo[] = [];
	const banners: CssBanner[] = [];
	const layers = new Set<string>();
	const animationDeclarations: { selector: string; value: string }[] = [];
	const colorCounts = new Map<string, number>();
	let bytes = 0;
	let ruleCount = 0;
	let mediaQueryCount = 0;
	let importantCount = 0;
	let propertyRules = 0;
	let supportsRules = 0;
	let containerQueries = false;
	let cssNesting = false;
	let darkModeMedia = false;
	let reducedMotion = false;

	for (const source of sources) {
		const raw = source.text || '';
		bytes += raw.length;
		for (const b of BANNERS) {
			const m = raw.slice(0, 4000).match(b.re) || (b.name === 'AOS' ? raw.match(b.re) : null);
			if (m && !banners.some(x => x.name === b.name)) {
				banners.push({ name: b.name, version: m.slice(1).find(Boolean), source: source.url });
			}
		}
		const text = stripComments(raw);
		importantCount += (text.match(/!important/g) || []).length;
		propertyRules += (text.match(/@property\s/g) || []).length;
		supportsRules += (text.match(/@supports\s/g) || []).length;
		if (/@container[\s(]/.test(text)) containerQueries = true;
		if (/prefers-color-scheme\s*:\s*dark/.test(text)) darkModeMedia = true;
		if (/prefers-reduced-motion/.test(text)) reducedMotion = true;
		for (const m of text.matchAll(/@layer\s+([^{;]+)[{;]/g)) {
			m[1].split(',').map(s => s.trim()).filter(Boolean).forEach(l => layers.add(l));
		}

		for (const m of text.matchAll(/@media([^{]+)\{/g)) {
			mediaQueryCount++;
			const query = m[1];
			for (const bp of query.matchAll(/(min|max)-width\s*:\s*([\d.]+)(px|em|rem)/g)) {
				const value = toPx(parseFloat(bp[2]), bp[3]);
				const key = `${bp[1]}:${value}`;
				const entry = breakpoints.get(key) || { value, unit: 'px' as const, type: bp[1] as 'min' | 'max', count: 0 };
				entry.count++;
				breakpoints.set(key, entry);
			}
			for (const bp of query.matchAll(/width\s*(>=|<=|>|<)\s*([\d.]+)(px|em|rem)/g)) {
				const value = toPx(parseFloat(bp[2]), bp[3]);
				const type = bp[1].startsWith('>') ? 'min' : 'max';
				const key = `${type}:${value}`;
				const entry = breakpoints.get(key) || { value, unit: 'px' as const, type, count: 0 };
				entry.count++;
				breakpoints.set(key, entry);
			}
		}

		for (const m of text.matchAll(/@(?:-webkit-)?keyframes\s+([\w-]+)\s*\{/g)) {
			const open = (m.index ?? 0) + m[0].length - 1;
			const { body } = readBlock(text, open);
			if (!keyframes.has(m[1])) {
				keyframes.set(m[1], {
					name: m[1],
					css: `@keyframes ${m[1]} {${body.length > 2400 ? `${body.slice(0, 2400)}…` : body}}`,
					source: source.url,
					usedBy: [],
				});
			}
		}

		for (const m of text.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
			const body = m[1];
			const get = (prop: string) => (body.match(new RegExp(`${prop}\\s*:\\s*([^;]+)`, 'i'))?.[1] || '').trim();
			const src = [...body.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map(x => {
				try {
					return new URL(x[1], source.url.startsWith('http') ? source.url : undefined).toString();
				} catch {
					return x[1];
				}
			});
			if (fontFaces.length < 120) {
				fontFaces.push({
					family: get('font-family').replace(/['"]/g, ''),
					weight: get('font-weight') || '400',
					style: get('font-style') || 'normal',
					display: get('font-display'),
					src: src.slice(0, 4),
				});
			}
		}

		for (const m of text.matchAll(/([^{}@;]+)\{([^{}]*)\}/g)) {
			ruleCount++;
			const selector = m[1].trim().replace(/\s+/g, ' ');
			const body = m[2];
			if (/&/.test(selector)) cssNesting = true;
			for (const decl of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)) {
				const name = decl[1];
				const value = decl[2].trim();
				const isGlobalScope = /^(:root|html|:host|body|\[data-theme[^\]]*\]|\.dark|\.light|:root\[[^\]]+\])/.test(selector);
				if (!isGlobalScope && variables.has(name)) continue;
				if (variables.size >= 600 && !variables.has(name)) continue;
				const hex = normalizeColor(value);
				const existing = variables.get(name);
				if (!existing || (isGlobalScope && !/^(:root|html)/.test(existing.scope))) {
					variables.set(name, {
						name,
						value: value.length > 200 ? `${value.slice(0, 200)}…` : value,
						scope: selector.slice(0, 80),
						isColor: Boolean(hex),
						hex: hex || undefined,
					});
				}
			}
			const anim = body.match(/(?:^|;)\s*animation(?:-name)?\s*:\s*([^;]+)/);
			if (anim && animationDeclarations.length < 400) {
				animationDeclarations.push({ selector: selector.slice(0, 140), value: anim[1].trim().slice(0, 160) });
			}
			for (const c of body.match(COLOR_TOKEN) || []) {
				const hex = normalizeColor(c);
				if (hex) colorCounts.set(hex, (colorCounts.get(hex) || 0) + 1);
			}
		}
	}

	for (const decl of animationDeclarations) {
		for (const name of keyframes.keys()) {
			if (new RegExp(`(^|[\\s,])${name.replace(/[-]/g, '\\-')}($|[\\s,])`).test(decl.value)) {
				const kf = keyframes.get(name);
				if (kf && kf.usedBy.length < 12 && !kf.usedBy.includes(decl.selector)) kf.usedBy.push(decl.selector);
			}
		}
	}

	return {
		bytes,
		ruleCount,
		mediaQueryCount,
		importantCount,
		variables: [...variables.values()],
		breakpoints: [...breakpoints.values()].sort((a, b) => a.value - b.value || a.type.localeCompare(b.type)),
		keyframes: [...keyframes.values()].slice(0, 150),
		fontFaces,
		banners,
		layers: [...layers].slice(0, 20),
		features: { containerQueries, cssNesting, propertyRules, supportsRules, darkModeMedia, reducedMotion },
		animationDeclarations: animationDeclarations.slice(0, 200),
		authoredColors: [...colorCounts.entries()]
			.map(([hex, count]) => ({ hex, count }))
			.sort((a, b) => b.count - a.count)
			.slice(0, 80),
	};
}

const TW_PREFIX =
	/^-?(?:p[xytrblse]?|m[xytrblse]?|gap(?:-[xy])?|space-[xy]|w|h|min-w|min-h|max-w|max-h|size|inset(?:-[xy])?|top|right|bottom|left|start|end|z|order|basis|grow|shrink|flex|grid-cols|grid-rows|col|row|auto-cols|auto-rows|text|font|leading|tracking|bg|from|via|to|border|rounded|shadow|ring|outline|opacity|blur|backdrop|translate(?:-[xy])?|scale(?:-[xy])?|rotate|skew(?:-[xy])?|origin|transition|duration|ease|delay|animate|cursor|select|pointer-events|overflow(?:-[xy])?|object|aspect|columns|break|decoration|underline-offset|line-clamp|fill|stroke|divide(?:-[xy])?|place|items|justify|content|self|drop-shadow|mix-blend|accent|caret|scroll|snap|touch|will-change|indent|align|whitespace|list|mask|inset-ring|outline-offset|ring-offset|bg-linear|bg-gradient|brightness|contrast|grayscale|saturate|sepia|hue-rotate|invert)(?:-|$)/;
const TW_STANDALONE = new Set([
	'flex', 'grid', 'block', 'inline', 'inline-block', 'inline-flex', 'inline-grid', 'hidden', 'contents', 'table',
	'absolute', 'relative', 'fixed', 'sticky', 'static', 'visible', 'invisible', 'collapse', 'uppercase', 'lowercase',
	'capitalize', 'normal-case', 'italic', 'not-italic', 'underline', 'line-through', 'no-underline', 'truncate',
	'antialiased', 'subpixel-antialiased', 'sr-only', 'not-sr-only', 'container', 'isolate', 'grow', 'shrink',
	'transform', 'filter', 'shadow', 'rounded', 'border', 'ring', 'outline', 'transition', 'italic', 'group', 'peer',
]);
const TW_VARIANTS = /^(?:(?:sm|md|lg|xl|2xl|max-sm|max-md|max-lg|max-xl|hover|focus|focus-visible|focus-within|active|visited|disabled|first|last|odd|even|group-hover|group-focus|peer-focus|peer-checked|dark|motion-safe|motion-reduce|print|rtl|ltr|placeholder|before|after|selection|marker|file|open|checked|required|invalid|aria-[\w-]+|data-[\w-]+|group-[\w-]+|peer-[\w-]+|supports-[\w-]+|\[[^\]]+\]|\*|has-[\w\[\]-]+|not-[\w-]+|in-[\w-]+|@[\w-]+):)+/;

const CATEGORY_RULES: [string, RegExp][] = [
	['layout', /^(flex|grid|block|inline|hidden|contents|table|absolute|relative|fixed|sticky|static|container|isolate|z-|order-|overflow|object-|aspect-|columns-|float|clear|inset|top-|right-|bottom-|left-|start-|end-|visible|invisible)/],
	['flexGrid', /^(items-|justify-|content-|self-|place-|grow|shrink|basis-|flex-|grid-cols|grid-rows|col-|row-|auto-cols|auto-rows|gap)/],
	['spacing', /^-?(p[xytrblse]?-|m[xytrblse]?-|space-)/],
	['sizing', /^(w-|h-|min-w|min-h|max-w|max-h|size-)/],
	['typography', /^(text-(xs|sm|base|lg|xl|\d|left|center|right|justify|start|end|wrap|nowrap|balance|pretty|ellipsis|clip)|font-|leading-|tracking-|uppercase|lowercase|capitalize|italic|underline|line-through|truncate|antialiased|whitespace-|break-|line-clamp|indent-|align-|decoration-|list-)/],
	['color', /^(text-|bg-|from-|via-|to-|fill-|stroke-|accent-|caret-|decoration-)/],
	['border', /^(border|rounded|ring|outline|divide)/],
	['effects', /^(shadow|opacity|blur|backdrop|drop-shadow|mix-blend|brightness|contrast|grayscale|saturate|sepia|hue-rotate|invert|filter|mask)/],
	['motion', /^(transition|duration|ease|delay|animate|translate|scale|rotate|skew|origin|transform|will-change)/],
	['interactivity', /^(cursor|select|pointer-events|scroll|snap|touch|resize|appearance|outline)/],
];

export interface ClassTokenAnalysis {
	total: number;
	unique: number;
	tailwindLike: number;
	tailwindRatio: number;
	likelyTailwind: boolean;
	arbitraryValues: number;
	categories: Record<string, { cls: string; count: number }[]>;
	variants: { variant: string; count: number }[];
	cssModules: { cls: string; count: number }[];
	topClasses: { cls: string; count: number }[];
}

export function isTailwindUtility(token: string) {
	const base = token.replace(TW_VARIANTS, '').replace(/^!/, '').replace(/!$/, '');
	if (!base) return false;
	if (TW_STANDALONE.has(base)) return true;
	if (/^\[[a-z-]+:[^\]]+\]$/.test(base)) return true;
	return TW_PREFIX.test(base);
}

export function analyzeClassTokens(counts: Record<string, number>): ClassTokenAnalysis {
	const entries = Object.entries(counts);
	let total = 0;
	let tailwindLike = 0;
	let arbitraryValues = 0;
	const categories: Record<string, { cls: string; count: number }[]> = {};
	const variants = new Map<string, number>();
	const cssModules: { cls: string; count: number }[] = [];

	for (const [cls, count] of entries) {
		total += count;
		if (/^[A-Za-z][\w]*_[\w-]+__[\w-]{5}$/.test(cls) || /^[\w-]+-module__[\w-]+__[\w-]+$/.test(cls)) {
			cssModules.push({ cls, count });
		}
		if (!isTailwindUtility(cls)) continue;
		tailwindLike += count;
		if (/\[[^\]]+\]/.test(cls)) arbitraryValues++;
		const variantMatch = cls.match(TW_VARIANTS);
		if (variantMatch) {
			for (const v of variantMatch[0].split(':').filter(Boolean)) variants.set(v, (variants.get(v) || 0) + count);
		}
		const base = cls.replace(TW_VARIANTS, '').replace(/^!/, '');
		const category = CATEGORY_RULES.find(([, re]) => re.test(base))?.[0] || 'other';
		(categories[category] ||= []).push({ cls, count });
	}
	for (const key of Object.keys(categories)) {
		categories[key] = categories[key].sort((a, b) => b.count - a.count).slice(0, 250);
	}
	const unique = entries.length;
	const tailwindRatio = total ? tailwindLike / total : 0;
	return {
		total,
		unique,
		tailwindLike,
		tailwindRatio: Math.round(tailwindRatio * 100) / 100,
		likelyTailwind: tailwindLike > 40 && tailwindRatio > 0.35,
		arbitraryValues,
		categories,
		variants: [...variants.entries()].map(([variant, count]) => ({ variant, count })).sort((a, b) => b.count - a.count).slice(0, 40),
		cssModules: cssModules.sort((a, b) => b.count - a.count).slice(0, 60),
		topClasses: entries.map(([cls, count]) => ({ cls, count })).sort((a, b) => b.count - a.count).slice(0, 120),
	};
}
