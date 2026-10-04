export interface StaticTag {
	tag: string;
	attrs: Record<string, string>;
}

export interface StaticHtml {
	lang: string;
	dir: string;
	title: string;
	meta: { key: string; content: string }[];
	links: Record<string, string>[];
	scripts: { src?: string; type?: string; async: boolean; defer: boolean; module: boolean; id?: string; inline?: string }[];
	styleBlocks: string[];
	classCounts: Record<string, number>;
	inlineStyles: { tag: string; style: string }[];
	svgs: string[];
	images: { src: string; alt: string; width?: string; height?: string; loading?: string; srcset: boolean }[];
	videos: { src: string; poster?: string; autoplay: boolean; loop: boolean; muted: boolean }[];
	iframes: { src: string; title?: string }[];
	jsonLd: unknown[];
	jsonScripts: { id: string; type: string; json: string }[];
	headings: { level: number; text: string }[];
	anchors: { href: string; text: string }[];
	generator?: string;
	elementCount: number;
	attributeNames: Record<string, number>;
}

const ATTR_RE = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g;

export function parseAttrs(raw: string): Record<string, string> {
	const attrs: Record<string, string> = {};
	for (const m of raw.matchAll(ATTR_RE)) {
		const name = m[1].toLowerCase();
		if (!(name in attrs)) attrs[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
	}
	return attrs;
}

export function decodeEntities(text: string) {
	return String(text || '')
		.replace(/&nbsp;/g, ' ')
		.replace(/&quot;/g, '"')
		.replace(/&#39;|&#x27;|&apos;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
		.replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
		.replace(/&amp;/g, '&');
}

function stripTags(html: string) {
	return decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function abs(url: string, base: string) {
	if (!url) return '';
	try {
		return new URL(url, base).toString();
	} catch {
		return url;
	}
}

function tagsOf(html: string, tag: string): StaticTag[] {
	const out: StaticTag[] = [];
	const re = new RegExp(`<${tag}\\b([^>]*)>`, 'gi');
	for (const m of html.matchAll(re)) out.push({ tag, attrs: parseAttrs(m[1]) });
	return out;
}

export function extractStaticHtml(html: string, baseUrl: string): StaticHtml {
	const doc = String(html || '');
	const htmlTag = doc.match(/<html\b([^>]*)>/i);
	const htmlAttrs = htmlTag ? parseAttrs(htmlTag[1]) : {};
	const title = stripTags(doc.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');

	const meta = tagsOf(doc, 'meta')
		.map(({ attrs }) => ({
			key: attrs.name || attrs.property || attrs['http-equiv'] || (attrs.charset ? 'charset' : '') || attrs.itemprop || '',
			content: attrs.content ?? attrs.charset ?? '',
		}))
		.filter(m => m.key);

	const links = tagsOf(doc, 'link').map(({ attrs }) => ({ ...attrs, href: abs(attrs.href, baseUrl) }));

	const scripts: StaticHtml['scripts'] = [];
	const jsonLd: unknown[] = [];
	const jsonScripts: StaticHtml['jsonScripts'] = [];
	for (const m of doc.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
		const attrs = parseAttrs(m[1]);
		const body = m[2] || '';
		const type = (attrs.type || '').toLowerCase();
		if (type === 'application/ld+json') {
			try {
				jsonLd.push(JSON.parse(body.trim()));
			} catch {
				/* invalid JSON-LD is reported as absent */
			}
			continue;
		}
		if (type.includes('json')) {
			if (jsonScripts.length < 12) {
				jsonScripts.push({ id: attrs.id || '', type, json: body.trim().slice(0, 200_000) });
			}
			continue;
		}
		scripts.push({
			src: attrs.src ? abs(attrs.src, baseUrl) : undefined,
			type: attrs.type,
			async: 'async' in attrs,
			defer: 'defer' in attrs,
			module: type === 'module',
			id: attrs.id,
			inline: attrs.src ? undefined : body.trim().slice(0, 60_000),
		});
	}

	const styleBlocks = [...doc.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]).slice(0, 60);

	const classCounts: Record<string, number> = {};
	const attributeNames: Record<string, number> = {};
	const inlineStyles: StaticHtml['inlineStyles'] = [];
	let elementCount = 0;
	for (const m of doc.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/gi)) {
		elementCount++;
		const raw = m[2];
		if (!raw) continue;
		const attrs = parseAttrs(raw);
		for (const name of Object.keys(attrs)) {
			if (name.startsWith('data-') || name.startsWith('aria-') || name.startsWith('x-') || name.startsWith('hx-') || name.startsWith('v-') || name.includes(':')) {
				const key = name.replace(/^(data-v-)[\w]+$/, '$1*').replace(/^(data-[\w]+-)[\w-]+$/, '$1*');
				attributeNames[key] = (attributeNames[key] || 0) + 1;
			}
		}
		if (attrs.class) {
			for (const c of attrs.class.split(/\s+/)) if (c) classCounts[c] = (classCounts[c] || 0) + 1;
		}
		if (attrs.style && inlineStyles.length < 150) inlineStyles.push({ tag: m[1].toLowerCase(), style: attrs.style.slice(0, 400) });
	}

	const svgs: string[] = [];
	const seenSvg = new Set<string>();
	for (const m of doc.matchAll(/<svg\b[\s\S]*?<\/svg>/gi)) {
		const svg = m[0];
		if (svg.length > 12_000 || seenSvg.has(svg)) continue;
		seenSvg.add(svg);
		svgs.push(svg);
		if (svgs.length >= 80) break;
	}

	const images = tagsOf(doc, 'img').slice(0, 300).map(({ attrs }) => ({
		src: abs(attrs.src || attrs['data-src'] || '', baseUrl),
		alt: attrs.alt ?? '',
		width: attrs.width,
		height: attrs.height,
		loading: attrs.loading,
		srcset: Boolean(attrs.srcset),
	}));
	const videos = tagsOf(doc, 'video').slice(0, 40).map(({ attrs }) => ({
		src: abs(attrs.src || '', baseUrl),
		poster: attrs.poster ? abs(attrs.poster, baseUrl) : undefined,
		autoplay: 'autoplay' in attrs,
		loop: 'loop' in attrs,
		muted: 'muted' in attrs,
	}));
	const iframes = tagsOf(doc, 'iframe').slice(0, 40).map(({ attrs }) => ({ src: abs(attrs.src || '', baseUrl), title: attrs.title }));

	const headings: StaticHtml['headings'] = [];
	for (const m of doc.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) {
		const text = stripTags(m[2]).slice(0, 140);
		if (text) headings.push({ level: Number(m[1]), text });
		if (headings.length >= 80) break;
	}
	const anchors: StaticHtml['anchors'] = [];
	for (const m of doc.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
		const attrs = parseAttrs(m[1]);
		if (!attrs.href) continue;
		anchors.push({ href: abs(attrs.href, baseUrl), text: stripTags(m[2]).slice(0, 80) });
		if (anchors.length >= 400) break;
	}

	return {
		lang: htmlAttrs.lang || '',
		dir: htmlAttrs.dir || '',
		title,
		meta,
		links,
		scripts,
		styleBlocks,
		classCounts,
		inlineStyles,
		svgs,
		images,
		videos,
		iframes,
		jsonLd,
		jsonScripts,
		headings,
		anchors,
		generator: meta.find(m => m.key.toLowerCase() === 'generator')?.content,
		elementCount,
		attributeNames,
	};
}
