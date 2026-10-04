/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Functions serialized by Puppeteer into the analyzed page.
 * They must stay self-contained: no imports, no references to outer scope.
 */

export async function autoScrollPage(maxHeight: number) {
	const step = Math.max(400, Math.floor(window.innerHeight * 0.8));
	const limit = Math.min(document.documentElement.scrollHeight, maxHeight);
	for (let y = 0; y < limit; y += step) {
		window.scrollTo(0, y);
		await new Promise(r => setTimeout(r, 110));
	}
	window.scrollTo(0, 0);
	await new Promise(r => setTimeout(r, 500));
}

export function readGlobals(paths: string[]) {
	const out: Record<string, string | boolean> = {};
	for (const path of paths) {
		try {
			let cur: any = window;
			for (const key of path.split('.')) {
				if (cur == null) break;
				cur = cur[key];
			}
			if (cur === undefined || cur === null) continue;
			if (typeof cur === 'string' || typeof cur === 'number') out[path] = String(cur).slice(0, 40);
			else out[path] = true;
		} catch {
			/* cross-origin or throwing getter */
		}
	}
	return out;
}

export function readDomSignals() {
	const count = (sel: string) => {
		try {
			return document.querySelectorAll(sel).length;
		} catch {
			return 0;
		}
	};
	const selectors: Record<string, string> = {
		'#__next': '#__next',
		'next-route-announcer': 'next-route-announcer',
		'#___gatsby': '#___gatsby',
		'astro-island': 'astro-island',
		'[data-reactroot]': '[data-reactroot]',
		'[data-v-app]': '[data-v-app]',
		'[ng-version]': '[ng-version]',
		'[ng-app]': '[ng-app]',
		'[q:container]': '[q\\:container]',
		'.ember-view': '.ember-view',
		'[x-data]': '[x-data]',
		'[hx-get]': '[hx-get]',
		'[hx-post]': '[hx-post]',
		'turbo-frame': 'turbo-frame',
		'[data-controller]': '[data-controller]',
		'[wire:id]': '[wire\\:id]',
		'[data-page]': '#app[data-page]',
		'[data-radix-popper-content-wrapper]': '[data-radix-popper-content-wrapper]',
		'[data-radix-collection-item]': '[data-radix-collection-item]',
		'[data-radix-scroll-area-viewport]': '[data-radix-scroll-area-viewport]',
		'[data-headlessui-state]': '[data-headlessui-state]',
		'[data-sonner-toaster]': '[data-sonner-toaster]',
		'[cmdk-root]': '[cmdk-root]',
		'[vaul-drawer]': '[vaul-drawer]',
		'style[data-styled]': 'style[data-styled]',
		'style[data-emotion]': 'style[data-emotion]',
		'style[data-jss]': 'style[data-jss]',
		'[data-projection-id]': '[data-projection-id]',
		'[data-aos]': '[data-aos]',
		'lottie-player': 'lottie-player',
		'dotlottie-player': 'dotlottie-player',
		'[data-barba]': '[data-barba]',
		'[data-scroll-container]': '[data-scroll-container]',
		'.swiper': '.swiper',
		'.splide': '.splide',
		'.slick-slider': '.slick-slider',
		'.glide__track': '.glide__track',
		'spline-viewer': 'spline-viewer',
		'svg.lucide': 'svg.lucide',
		'ion-icon': 'ion-icon',
		'iconify-icon': 'iconify-icon',
		'.iconify': '.iconify',
		'svg.tabler-icon': 'svg.tabler-icon',
		'svg.feather': 'svg.feather',
		'[data-wf-page]': '[data-wf-page]',
		'[data-framer-name]': '[data-framer-name]',
		'[data-framer-component-type]': '[data-framer-component-type]',
		'.leaflet-container': '.leaflet-container',
		heroicon: 'svg[data-slot="icon"]',
		radixId: '[id^="radix-"]',
		headlessuiId: '[id^="headlessui-"]',
		framerAppear: '[data-framer-appear-id]',
		nextFont: '[class*="__className_"], [class*="__variable_"]',
		svelteClass: '[class*="svelte-"]',
		manifest: 'link[rel="manifest"]',
	};
	const out: Record<string, number> = {};
	for (const [key, sel] of Object.entries(selectors)) {
		const n = count(sel);
		if (n) out[key] = n;
	}
	if (document.documentElement.classList.contains('lenis')) out['html.lenis'] = 1;
	const sample = Array.from(document.querySelectorAll('body *')).slice(0, 1500);
	let fiber = 0;
	let vueScoped = 0;
	let vueApp = 0;
	for (const el of sample) {
		const keys = Object.keys(el);
		if (keys.some(k => k.startsWith('__reactFiber$') || k.startsWith('__reactContainer$') || k === '_reactRootContainer')) fiber++;
		if ((el as any).__vue_app__ || (el as any).__vue__ || (el as any).__vueParentComponent) vueApp++;
		for (const attr of Array.from(el.attributes)) {
			if (attr.name.startsWith('data-v-')) {
				vueScoped++;
				break;
			}
		}
	}
	if (fiber) out.reactFiber = fiber;
	if (vueApp) out.vueApp = vueApp;
	if (vueScoped) out['[data-v-]'] = vueScoped;
	return out;
}

export function resolveRootVariables(names: string[]) {
	const cs = getComputedStyle(document.documentElement);
	const out: Record<string, string> = {};
	for (const name of names) {
		const v = cs.getPropertyValue(name).trim();
		if (v) out[name] = v.slice(0, 200);
	}
	return out;
}

export function measureViewport() {
	const vw = window.innerWidth;
	const isShown = (el: Element) => {
		const r = el.getBoundingClientRect();
		const cs = getComputedStyle(el);
		return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.01;
	};
	const header = document.querySelector('header, [role="banner"], nav');
	const navLinks = header ? Array.from(header.querySelectorAll('a')).filter(isShown).length : 0;
	const hamburger = header
		? Array.from(header.querySelectorAll('button, [role="button"]')).some(b => {
				if (!isShown(b)) return false;
				const label = `${b.getAttribute('aria-label') || ''} ${b.getAttribute('class') || ''} ${b.textContent || ''}`;
				const r = b.getBoundingClientRect();
				return /menu|nav|toggle|hamburger|burger|open/i.test(label) || (r.width <= 56 && r.height <= 56 && !!b.querySelector('svg') && !(b.textContent || '').trim());
			})
		: false;
	let maxGridColumns = 0;
	let flexRowCount = 0;
	const containers: number[] = [];
	const els = Array.from(document.querySelectorAll('body *')).slice(0, 3000);
	for (const el of els) {
		const cs = getComputedStyle(el);
		if (cs.display === 'grid' || cs.display === 'inline-grid') {
			const cols = cs.gridTemplateColumns.split(' ').filter(x => x && x !== 'none').length;
			if (cols > maxGridColumns && isShown(el)) maxGridColumns = cols;
		}
		if (cs.display === 'flex' && cs.flexDirection === 'row' && el.children.length >= 3) flexRowCount++;
		if (cs.maxWidth !== 'none' && cs.maxWidth.endsWith('px')) {
			const r = el.getBoundingClientRect();
			if (r.width > vw * 0.5 && Math.abs(r.left - (vw - r.right)) < 2) containers.push(Math.round(r.width));
		}
	}
	const h1 = document.querySelector('h1');
	const hiddenLandmarks = Array.from(document.querySelectorAll('header nav, aside, [class*="sidebar"]')).filter(el => !isShown(el)).length;
	return {
		width: vw,
		height: window.innerHeight,
		docWidth: document.documentElement.scrollWidth,
		docHeight: document.documentElement.scrollHeight,
		overflowX: document.documentElement.scrollWidth > vw + 1,
		navLinksVisible: navLinks,
		hamburger,
		h1Size: h1 ? getComputedStyle(h1).fontSize : '',
		bodySize: getComputedStyle(document.body).fontSize,
		maxGridColumns,
		flexRowCount,
		containerWidth: containers.length ? Math.max(...containers) : 0,
		hiddenLandmarks,
		imagesVisible: Array.from(document.images).filter(isShown).length,
	};
}

export function collectPage(opts: { maxInspect: number; maxHtml: number }) {
	const vw = window.innerWidth;
	const scrollY = window.scrollY;
	const TRANSPARENT = new Set(['rgba(0, 0, 0, 0)', 'transparent']);
	const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'LINK', 'META', 'HEAD', 'BR', 'WBR']);

	const cssPath = (el: Element | null): string => {
		const parts: string[] = [];
		let cur: Element | null = el;
		let depth = 0;
		while (cur && cur.nodeType === 1 && depth < 5) {
			if (cur === document.body) {
				parts.unshift('body');
				break;
			}
			let part = cur.tagName.toLowerCase();
			if (cur.id && /^[A-Za-z][\w-]*$/.test(cur.id)) {
				parts.unshift(`${part}#${cur.id}`);
				break;
			}
			const cls = (cur.getAttribute('class') || '')
				.trim()
				.split(/\s+/)
				.filter(c => c && /^[A-Za-z_-][\w-]*$/.test(c))
				.slice(0, 2);
			if (cls.length) part += `.${cls.join('.')}`;
			const parent: Element | null = cur.parentElement;
			if (parent) {
				const same = Array.from(parent.children).filter(c => c.tagName === cur!.tagName);
				if (same.length > 1) part += `:nth-of-type(${same.indexOf(cur) + 1})`;
			}
			parts.unshift(part);
			cur = parent;
			depth++;
		}
		return parts.join(' > ');
	};

	const directText = (el: Element) => {
		let text = '';
		for (const node of Array.from(el.childNodes)) {
			if (node.nodeType === 3) text += node.textContent || '';
		}
		return text.replace(/\s+/g, ' ').trim();
	};

	const isVisible = (r: DOMRect, cs: CSSStyleDeclaration) =>
		r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.01;

	const DEFAULTS = new Set(['', 'none', 'normal', '0px', 'auto', 'rgba(0, 0, 0, 0)', '0px 0px 0px 0px', 'static', 'visible', 'start']);
	const compact = (obj: Record<string, string>) => {
		const out: Record<string, string> = {};
		for (const [k, v] of Object.entries(obj)) {
			if (k === 'display' || k === 'position' || !DEFAULTS.has(v)) out[k] = v;
		}
		return out;
	};

	const snap = (cs: CSSStyleDeclaration, r: DOMRect) =>
		compact({
			display: cs.display,
			position: cs.position,
			width: `${Math.round(r.width)}px`,
			height: `${Math.round(r.height)}px`,
			color: cs.color,
			backgroundColor: cs.backgroundColor,
			backgroundImage: cs.backgroundImage !== 'none' ? cs.backgroundImage.slice(0, 220) : '',
			fontFamily: cs.fontFamily.slice(0, 90),
			fontSize: cs.fontSize,
			fontWeight: cs.fontWeight,
			lineHeight: cs.lineHeight,
			letterSpacing: cs.letterSpacing,
			textAlign: cs.textAlign,
			textTransform: cs.textTransform,
			padding: cs.padding,
			margin: cs.margin,
			gap: cs.gap,
			border: Number(parseFloat(cs.borderTopWidth)) > 0 && cs.borderTopStyle !== 'none' ? `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}` : '',
			borderRadius: cs.borderRadius,
			boxShadow: cs.boxShadow.slice(0, 200),
			opacity: cs.opacity === '1' ? '' : cs.opacity,
			transform: cs.transform,
			transition: cs.transitionDuration.split(',').some(d => parseFloat(d) > 0) ? cs.transition.slice(0, 160) : '',
			animation: cs.animationName !== 'none' ? `${cs.animationName} ${cs.animationDuration}` : '',
			zIndex: cs.zIndex,
			flexDirection: cs.display.includes('flex') ? cs.flexDirection : '',
			justifyContent: cs.display.includes('flex') || cs.display.includes('grid') ? cs.justifyContent : '',
			alignItems: cs.display.includes('flex') || cs.display.includes('grid') ? cs.alignItems : '',
			gridTemplateColumns: cs.display.includes('grid') ? cs.gridTemplateColumns.slice(0, 160) : '',
			maxWidth: cs.maxWidth,
			backdropFilter: cs.backdropFilter,
			filter: cs.filter,
			overflow: cs.overflow,
			cursor: cs.cursor === 'pointer' ? 'pointer' : '',
		});

	const tally = (map: Record<string, number>, key: string, w = 1) => {
		if (!key) return;
		map[key] = (map[key] || 0) + w;
	};

	const styles = {
		colorsText: {} as Record<string, number>,
		colorsBg: {} as Record<string, number>,
		colorsBorder: {} as Record<string, number>,
		fonts: {} as Record<string, number>,
		sizes: {} as Record<string, number>,
		weights: {} as Record<string, number>,
		lineHeights: {} as Record<string, number>,
		letterSpacings: {} as Record<string, number>,
		radii: {} as Record<string, number>,
		shadows: {} as Record<string, number>,
		spacing: {} as Record<string, number>,
		gaps: {} as Record<string, number>,
		zIndex: {} as Record<string, number>,
		durations: {} as Record<string, number>,
		easings: {} as Record<string, number>,
		transitionProps: {} as Record<string, number>,
		maxWidths: {} as Record<string, number>,
		gradients: {} as Record<string, number>,
	};

	const classCounts: Record<string, number> = {};
	const inspect: any[] = [];
	const transitionEls: any[] = [];
	const willChange: Record<string, number> = {};
	const cardGroups: Record<string, any> = {};
	const badgeGroups: Record<string, any> = {};
	const backgrounds: any[] = [];
	const inlineStyles: any[] = [];

	const all = Array.from(document.querySelectorAll('body *')) as HTMLElement[];
	const limit = Math.min(all.length, 9000);
	let visibleCount = 0;

	for (let i = 0; i < limit; i++) {
		const el = all[i];
		if (SKIP.has(el.tagName)) continue;
		const clsAttr = el.getAttribute('class');
		if (clsAttr && typeof clsAttr === 'string') {
			for (const c of clsAttr.split(/\s+/)) if (c) classCounts[c] = (classCounts[c] || 0) + 1;
		}
		const styleAttr = el.getAttribute('style');
		if (styleAttr && inlineStyles.length < 150) inlineStyles.push({ selector: cssPath(el), style: styleAttr.slice(0, 400) });
		if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue;

		const cs = getComputedStyle(el);
		const r = el.getBoundingClientRect();
		if (!isVisible(r, cs)) continue;
		visibleCount++;
		const text = directText(el);
		const area = Math.min(r.width * r.height, vw * 900);

		if (text) {
			tally(styles.colorsText, cs.color);
			tally(styles.fonts, cs.fontFamily);
			tally(styles.sizes, cs.fontSize);
			tally(styles.weights, cs.fontWeight);
			tally(styles.lineHeights, cs.lineHeight);
			if (cs.letterSpacing !== 'normal') tally(styles.letterSpacings, cs.letterSpacing);
		}
		const bgOpaque = !TRANSPARENT.has(cs.backgroundColor);
		if (bgOpaque) tally(styles.colorsBg, cs.backgroundColor, Math.max(1, Math.round(area / 20000)));
		const hasBorder = Number(parseFloat(cs.borderTopWidth)) > 0 && cs.borderTopStyle !== 'none';
		if (hasBorder) tally(styles.colorsBorder, cs.borderTopColor);
		const radius = parseFloat(cs.borderTopLeftRadius) || 0;
		if (radius > 0) tally(styles.radii, cs.borderRadius);
		const hasShadow = cs.boxShadow !== 'none';
		if (hasShadow) tally(styles.shadows, cs.boxShadow);
		for (const v of [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft, cs.marginTop, cs.marginBottom]) {
			if (v !== '0px' && !v.startsWith('-')) tally(styles.spacing, v);
		}
		if ((cs.display.includes('flex') || cs.display.includes('grid')) && cs.rowGap !== 'normal' && cs.rowGap !== '0px') {
			tally(styles.gaps, cs.rowGap);
		}
		if (cs.zIndex !== 'auto' && cs.position !== 'static') tally(styles.zIndex, cs.zIndex);
		if (cs.backgroundImage.includes('gradient')) tally(styles.gradients, cs.backgroundImage.slice(0, 240));
		if (cs.willChange !== 'auto') tally(willChange, cs.willChange);

		if (cs.transitionDuration.split(',').some(d => parseFloat(d) > 0)) {
			tally(styles.durations, cs.transitionDuration);
			tally(styles.easings, cs.transitionTimingFunction);
			tally(styles.transitionProps, cs.transitionProperty);
			if (transitionEls.length < 80) {
				transitionEls.push({
					selector: cssPath(el),
					tag: el.tagName.toLowerCase(),
					text: (text || el.getAttribute('aria-label') || '').slice(0, 50),
					property: cs.transitionProperty.slice(0, 100),
					duration: cs.transitionDuration,
					easing: cs.transitionTimingFunction.slice(0, 60),
					interactive: el.matches('a, button, [role="button"], input, select, textarea, label, summary') || cs.cursor === 'pointer',
				});
			}
		}

		if (cs.maxWidth !== 'none' && cs.maxWidth.endsWith('px') && r.width > vw * 0.4 && r.width < vw - 1 && Math.abs(r.left - (vw - r.right)) < 2) {
			tally(styles.maxWidths, cs.maxWidth);
		}

		const bgUrl = cs.backgroundImage.match(/url\(["']?([^"')]+)["']?\)/);
		if (bgUrl && backgrounds.length < 80 && !bgUrl[1].startsWith('data:')) {
			backgrounds.push({ url: bgUrl[1], selector: cssPath(el), width: Math.round(r.width), height: Math.round(r.height) });
		}

		const isControl = el.matches('button, a, input, select, textarea, [role="button"]');
		if (!isControl && r.width >= 140 && r.width <= vw * 0.7 && r.height >= 90 && el.childElementCount >= 1 && (hasShadow || hasBorder) && radius >= 4 && (bgOpaque || hasBorder)) {
			const sig = [cs.backgroundColor, cs.borderRadius, cs.boxShadow.slice(0, 80), hasBorder ? `${cs.borderTopWidth} ${cs.borderTopColor}` : '', cs.padding].join('|');
			const g = (cardGroups[sig] ||= { signature: sig, count: 0, widths: [], heights: [], sample: null });
			g.count++;
			g.widths.push(Math.round(r.width));
			g.heights.push(Math.round(r.height));
			if (!g.sample) {
				const heading = el.querySelector('h1, h2, h3, h4, h5, h6, strong');
				g.sample = {
					selector: cssPath(el),
					html: el.outerHTML.slice(0, 3000),
					styles: snap(cs, r),
					heading: heading ? (heading.textContent || '').trim().slice(0, 80) : '',
					hasImage: !!el.querySelector('img, picture, svg, video'),
					hasButton: !!el.querySelector('button, a[class*="btn"], a[class*="button"]'),
					rect: { x: Math.round(r.left), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) },
				};
			}
		}

		if (text && r.height <= 34 && r.width <= 220 && (bgOpaque || hasBorder) && radius >= 4 && parseFloat(cs.fontSize) <= 14 && !el.matches('button, a, input, select, textarea')) {
			const sig = [cs.backgroundColor, cs.color, cs.borderRadius, cs.fontSize, cs.fontWeight, cs.padding].join('|');
			const g = (badgeGroups[sig] ||= { signature: sig, count: 0, samples: [], styles: snap(cs, r), html: el.outerHTML.slice(0, 800), selector: cssPath(el) });
			g.count++;
			if (g.samples.length < 4) g.samples.push(text.slice(0, 30));
		}

		if (inspect.length < opts.maxInspect && r.width >= 10 && r.height >= 8) {
			const attrs: Record<string, string> = {};
			for (const name of ['href', 'src', 'alt', 'aria-label', 'role', 'type', 'placeholder']) {
				const v = el.getAttribute(name);
				if (v) attrs[name] = v.slice(0, 140);
			}
			inspect.push({
				i: inspect.length,
				tag: el.tagName.toLowerCase(),
				id: el.id || undefined,
				cls: clsAttr && typeof clsAttr === 'string' ? clsAttr.trim().split(/\s+/).slice(0, 24).join(' ') : undefined,
				sel: cssPath(el),
				x: Math.round(r.left),
				y: Math.round(r.top + scrollY),
				w: Math.round(r.width),
				h: Math.round(r.height),
				text: (text || '').slice(0, 90) || undefined,
				attrs: Object.keys(attrs).length ? attrs : undefined,
				styles: snap(cs, r),
				children: el.childElementCount,
			});
		}
	}

	/* Components */
	const groupControls = (els: Element[], kind: 'button' | 'input') => {
		const groups: Record<string, any> = {};
		for (const el of els) {
			const cs = getComputedStyle(el);
			const r = el.getBoundingClientRect();
			if (!isVisible(r, cs)) continue;
			const tag = el.tagName.toLowerCase();
			const text = ((el as HTMLInputElement).value && tag === 'input' && kind === 'button' ? (el as HTMLInputElement).value : el.textContent || '').replace(/\s+/g, ' ').trim();
			if (kind === 'button' && tag === 'a') {
				const styled = !TRANSPARENT.has(cs.backgroundColor) || (Number(parseFloat(cs.borderTopWidth)) > 0 && cs.borderTopStyle !== 'none');
				if (!styled || parseFloat(cs.paddingLeft) < 8 || r.height < 24 || r.height > 80 || r.width > 480) continue;
			}
			if (kind === 'button' && r.height < 18) continue;
			const sig =
				kind === 'button'
					? [cs.backgroundColor, cs.color, cs.borderRadius, `${cs.borderTopWidth} ${cs.borderTopColor}`, cs.fontSize, cs.fontWeight, `${cs.paddingTop} ${cs.paddingLeft}`].join('|')
					: [cs.backgroundColor, `${cs.borderTopWidth} ${cs.borderTopColor}`, cs.borderRadius, Math.round(r.height), cs.fontSize, cs.padding].join('|');
			const g = (groups[sig] ||= {
				signature: sig,
				count: 0,
				samples: [],
				types: [],
				styles: snap(cs, r),
				html: (el as HTMLElement).outerHTML.slice(0, 1600),
				selector: cssPath(el),
				classes: ((el.getAttribute('class') || '') as string).trim().split(/\s+/).filter(Boolean).slice(0, 40),
				iconOnly: !text && !!el.querySelector('svg, img, i'),
				height: Math.round(r.height),
				rect: { x: Math.round(r.left), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) },
			});
			g.count++;
			if (text && g.samples.length < 4 && !g.samples.includes(text.slice(0, 40))) g.samples.push(text.slice(0, 40));
			const typeLabel = kind === 'input' ? (el as HTMLInputElement).type || tag : tag;
			if (!g.types.includes(typeLabel)) g.types.push(typeLabel);
		}
		return Object.values(groups).sort((a: any, b: any) => b.count - a.count).slice(0, 16);
	};

	const buttons = groupControls(Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"], a')).slice(0, 2500), 'button');
	const inputs = groupControls(
		Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]), select, textarea')).slice(0, 400),
		'input',
	);

	const summarizeCards = Object.values(cardGroups)
		.sort((a: any, b: any) => b.count - a.count)
		.slice(0, 12)
		.map((g: any) => ({
			signature: g.signature,
			count: g.count,
			avgWidth: Math.round(g.widths.reduce((s: number, n: number) => s + n, 0) / g.widths.length),
			avgHeight: Math.round(g.heights.reduce((s: number, n: number) => s + n, 0) / g.heights.length),
			...g.sample,
		}));

	const navs = Array.from(document.querySelectorAll('header, nav, [role="navigation"], [role="banner"]'))
		.filter(el => !el.parentElement?.closest('header, nav, [role="navigation"]'))
		.slice(0, 4)
		.map(el => {
			const cs = getComputedStyle(el);
			const r = el.getBoundingClientRect();
			const links = Array.from(el.querySelectorAll('a')).map(a => (a.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
			return {
				tag: el.tagName.toLowerCase(),
				selector: cssPath(el),
				position: cs.position,
				sticky: cs.position === 'sticky' || cs.position === 'fixed',
				height: Math.round(r.height),
				styles: snap(cs, r),
				linkCount: links.length,
				links: links.slice(0, 12),
				hasLogo: !!el.querySelector('img, svg'),
				ctaCount: el.querySelectorAll('button, a[class*="btn"], a[class*="button"]').length,
				html: el.outerHTML.slice(0, 5000),
			};
		});

	const footerEl = document.querySelector('footer, [role="contentinfo"]');
	const footer = footerEl
		? (() => {
				const cs = getComputedStyle(footerEl);
				const r = footerEl.getBoundingClientRect();
				return {
					selector: cssPath(footerEl),
					height: Math.round(r.height),
					styles: snap(cs, r),
					linkCount: footerEl.querySelectorAll('a').length,
					columns: Array.from(footerEl.querySelectorAll('ul, nav, [class*="col"]')).length,
					hasForm: !!footerEl.querySelector('form, input[type="email"]'),
					socialLinks: Array.from(footerEl.querySelectorAll('a[href]'))
						.map(a => a.getAttribute('href') || '')
						.filter(h => /twitter|x\.com|facebook|instagram|linkedin|github|youtube|tiktok|discord/.test(h))
						.slice(0, 10),
					html: footerEl.outerHTML.slice(0, 5000),
				};
			})()
		: null;

	const mainEl = document.querySelector('main') || document.body;
	const heroCandidate = Array.from(mainEl.querySelectorAll('section, header, div'))
		.slice(0, 400)
		.find(el => {
			if (el.matches('nav') || el.closest('nav')) return false;
			const r = el.getBoundingClientRect();
			return r.top + scrollY < 160 && r.height >= 280 && r.width >= vw * 0.8 && !!el.querySelector('h1, h2');
		});
	const hero = heroCandidate
		? (() => {
				const cs = getComputedStyle(heroCandidate);
				const r = heroCandidate.getBoundingClientRect();
				const h = heroCandidate.querySelector('h1, h2');
				const p = heroCandidate.querySelector('p');
				return {
					selector: cssPath(heroCandidate),
					height: Math.round(r.height),
					headline: (h?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160),
					subline: (p?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 240),
					ctas: Array.from(heroCandidate.querySelectorAll('a, button'))
						.map(a => (a.textContent || '').replace(/\s+/g, ' ').trim())
						.filter(t => t && t.length < 40)
						.slice(0, 5),
					media: {
						images: heroCandidate.querySelectorAll('img, picture').length,
						videos: heroCandidate.querySelectorAll('video').length,
						canvas: heroCandidate.querySelectorAll('canvas').length,
						svgs: heroCandidate.querySelectorAll('svg').length,
					},
					styles: snap(cs, r),
					headlineStyles: h ? snap(getComputedStyle(h), h.getBoundingClientRect()) : null,
					html: heroCandidate.outerHTML.slice(0, 6000),
				};
			})()
		: null;

	const KIND_RULES: [string, RegExp][] = [
		['pricing', /pric|plan|tier|billing/i],
		['faq', /faq|question|accordion/i],
		['testimonials', /testimonial|review|customer|quote|love/i],
		['features', /feature|benefit|why|capabilit|service/i],
		['cta', /cta|get started|sign up|start|try|join|contact us/i],
		['logos', /logo|partner|brand|trusted|client/i],
		['stats', /stat|number|metric|count/i],
		['team', /team|people|founder/i],
		['blog', /blog|article|post|news/i],
		['contact', /contact|form|newsletter|subscribe/i],
		['gallery', /gallery|portfolio|work|project|showcase/i],
	];
	const sectionRoots = Array.from((document.querySelector('main') || document.body).children).filter(el => !SKIP.has(el.tagName));
	const sectionEls = sectionRoots.length === 1 && sectionRoots[0].children.length > 2 ? Array.from(sectionRoots[0].children) : sectionRoots;
	const sections = sectionEls
		.map(el => {
			const cs = getComputedStyle(el);
			const r = el.getBoundingClientRect();
			if (!isVisible(r, cs) || r.height < 80) return null;
			const heading = el.querySelector('h1, h2, h3');
			const headingText = (heading?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 100);
			const hint = `${headingText} ${el.id} ${el.getAttribute('class') || ''}`;
			const grid = el.querySelector('[style*="grid"], *');
			let columns = 0;
			for (const child of Array.from(el.querySelectorAll('*')).slice(0, 200)) {
				const ccs = getComputedStyle(child);
				if (ccs.display === 'grid') {
					columns = Math.max(columns, ccs.gridTemplateColumns.split(' ').filter(Boolean).length);
				}
			}
			return {
				selector: cssPath(el),
				tag: el.tagName.toLowerCase(),
				y: Math.round(r.top + scrollY),
				height: Math.round(r.height),
				heading: headingText,
				kind: (KIND_RULES.find(([, re]) => re.test(hint)) || ['content'])[0],
				background: cs.backgroundColor,
				backgroundImage: cs.backgroundImage !== 'none' ? cs.backgroundImage.slice(0, 120) : '',
				padding: cs.padding,
				gridColumns: columns,
				childCount: el.childElementCount,
				hasGrid: !!grid,
			};
		})
		.filter(Boolean)
		.slice(0, 30);

	/* Typography */
	const typeOf = (el: Element | null) => {
		if (!el) return null;
		const cs = getComputedStyle(el);
		return {
			fontFamily: cs.fontFamily,
			fontSize: cs.fontSize,
			fontWeight: cs.fontWeight,
			lineHeight: cs.lineHeight,
			letterSpacing: cs.letterSpacing,
			color: cs.color,
			textTransform: cs.textTransform,
			sample: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
		};
	};
	const headingStyles: Record<string, any> = {};
	for (const level of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
		const el = Array.from(document.querySelectorAll(level)).find(h => {
			const r = h.getBoundingClientRect();
			return r.width > 0 && r.height > 0;
		});
		const t = typeOf(el || null);
		if (t) headingStyles[level] = t;
	}

	/* Animations */
	const runtime = (typeof document.getAnimations === 'function' ? document.getAnimations() : []).slice(0, 200).map((a: any) => {
		const eff = a.effect;
		const target = eff?.target as Element | undefined;
		const timing = eff?.getComputedTiming ? eff.getComputedTiming() : {};
		const kfs = eff?.getKeyframes ? eff.getKeyframes() : [];
		const props = new Set<string>();
		for (const kf of kfs) for (const k of Object.keys(kf)) if (!['offset', 'easing', 'composite', 'computedOffset'].includes(k)) props.add(k);
		return {
			type: a.constructor?.name || 'Animation',
			name: a.animationName || a.transitionProperty || a.id || '',
			target: target ? cssPath(target) : '',
			targetTag: target?.tagName?.toLowerCase() || '',
			duration: typeof timing.duration === 'number' ? Math.round(timing.duration) : String(timing.duration || ''),
			delay: timing.delay || 0,
			iterations: timing.iterations === Infinity ? 'infinite' : timing.iterations,
			easing: timing.easing || '',
			playState: a.playState,
			properties: Array.from(props).slice(0, 8),
		};
	});

	const attrTally = (sel: string, attr?: string) => {
		const els = Array.from(document.querySelectorAll(sel));
		const values: Record<string, number> = {};
		if (attr) for (const el of els) tally(values, (el.getAttribute(attr) || '').slice(0, 40));
		return {
			count: els.length,
			values: Object.entries(values).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([value, n]) => ({ value, count: n })),
			samples: els.slice(0, 6).map(el => cssPath(el)),
		};
	};
	const attributeAnimations = {
		aos: attrTally('[data-aos]', 'data-aos'),
		locomotive: attrTally('[data-scroll]', 'data-scroll-speed'),
		framerAppear: attrTally('[data-framer-appear-id]'),
		animateCss: attrTally('[class*="animate__"]'),
		tailwindAnimate: attrTally('[class*="animate-"]'),
		wow: attrTally('.wow'),
		gsapAttrs: attrTally('[data-speed], [data-lag], [data-gsap]'),
	};

	let gsapInfo: any = null;
	try {
		const w = window as any;
		if (w.gsap && w.gsap.globalTimeline) {
			const kids = w.gsap.globalTimeline.getChildren(true, true, false).slice(0, 80);
			gsapInfo = {
				version: w.gsap.version,
				plugins: Object.keys(w.gsap.plugins || {}).slice(0, 20),
				tweens: kids.map((t: any) => ({
					targets: (typeof t.targets === 'function' ? t.targets() : [])
						.slice(0, 3)
						.map((el: any) => (el instanceof Element ? cssPath(el) : String(el).slice(0, 40))),
					duration: typeof t.duration === 'function' ? t.duration() : 0,
					delay: typeof t.delay === 'function' ? t.delay() : 0,
					props: Object.keys(t.vars || {})
						.filter(k => !/^on[A-Z]|callbackScope|immediateRender|overwrite|id$/.test(k))
						.slice(0, 10),
					ease: t.vars && typeof t.vars.ease === 'string' ? t.vars.ease : '',
					scrollTrigger: !!(t.vars && t.vars.scrollTrigger),
				})),
				scrollTriggers:
					w.ScrollTrigger && typeof w.ScrollTrigger.getAll === 'function'
						? w.ScrollTrigger.getAll()
								.slice(0, 40)
								.map((st: any) => ({
									trigger: st.trigger ? cssPath(st.trigger) : '',
									start: String(st.vars?.start ?? ''),
									end: String(st.vars?.end ?? ''),
									scrub: !!st.vars?.scrub,
									pin: !!st.vars?.pin,
								}))
						: [],
			};
		}
	} catch {
		gsapInfo = null;
	}

	/* Layout tree */
	const LANDMARK: Record<string, string> = {
		HEADER: 'Header',
		NAV: 'Navigation',
		MAIN: 'Main',
		FOOTER: 'Footer',
		ASIDE: 'Sidebar',
		SECTION: 'Section',
		ARTICLE: 'Article',
		FORM: 'Form',
		DIALOG: 'Dialog',
		UL: 'List',
		OL: 'List',
		TABLE: 'Table',
		H1: 'Heading 1',
		H2: 'Heading 2',
		H3: 'Heading 3',
		BUTTON: 'Button',
		A: 'Link',
		IMG: 'Image',
		VIDEO: 'Video',
		CANVAS: 'Canvas',
		SVG: 'Icon / SVG',
		INPUT: 'Input',
		PICTURE: 'Image',
		IFRAME: 'Embed',
	};
	const LABEL_RULES: [string, RegExp][] = [
		['Hero', /hero|banner|jumbotron|masthead/i],
		['Navigation', /nav|menu/i],
		['Card', /card|tile/i],
		['Grid', /grid/i],
		['Container', /container|wrapper|wrap|inner/i],
		['Modal', /modal|dialog|drawer/i],
		['Logo', /logo|brand/i],
		['Pricing', /pricing|plan/i],
		['FAQ', /faq|accordion/i],
		['Testimonials', /testimonial|review/i],
		['Features', /feature/i],
		['Call to action', /cta/i],
		['Footer', /footer/i],
		['Header', /header/i],
		['Carousel', /carousel|slider|swiper/i],
	];
	let nodeBudget = 900;
	const build = (start: Element, depth: number): any => {
		if (nodeBudget <= 0 || depth > 9) return null;
		let el = start;
		let wrappers = 0;
		while (
			el !== document.body &&
			el.children.length === 1 &&
			!el.id &&
			!LANDMARK[el.tagName] &&
			!directText(el) &&
			wrappers < 6
		) {
			el = el.children[0];
			wrappers++;
		}
		const cs = getComputedStyle(el);
		const r = el.getBoundingClientRect();
		if (SKIP.has(el.tagName)) return null;
		if (cs.display === 'none' || (r.width === 0 && r.height === 0 && cs.display !== 'contents')) return null;
		nodeBudget--;
		const classes = ((el.getAttribute('class') || '') as string).trim().split(/\s+/).filter(Boolean);
		const hint = `${el.id} ${classes.join(' ')}`;
		const label =
			LANDMARK[el.tagName.toUpperCase()] ||
			(LABEL_RULES.find(([, re]) => re.test(hint)) || [])[0] ||
			(cs.display.includes('grid') ? 'Grid' : cs.display.includes('flex') ? (cs.flexDirection.startsWith('column') ? 'Stack' : 'Row') : '');
		const kids = el.tagName === 'svg' ? [] : Array.from(el.children).filter(c => !SKIP.has(c.tagName));
		const node: any = {
			tag: el.tagName.toLowerCase(),
			id: el.id || undefined,
			cls: classes.slice(0, 4).join(' ') || undefined,
			label: label || undefined,
			sel: cssPath(el),
			y: Math.round(r.top + scrollY),
			x: Math.round(r.left),
			w: Math.round(r.width),
			h: Math.round(r.height),
			display: cs.display,
			text: /^H[1-6]$|^BUTTON$|^A$/.test(el.tagName) ? (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60) : undefined,
			wrappers: wrappers || undefined,
			descendants: el.getElementsByTagName('*').length,
		};
		if (!['svg', 'img', 'picture', 'video', 'canvas', 'iframe', 'input', 'select', 'textarea'].includes(node.tag)) {
			const childNodes = kids.slice(0, 16).map(c => build(c, depth + 1)).filter(Boolean);
			if (childNodes.length) node.children = childNodes;
			if (kids.length > 16) node.more = kids.length - 16;
		}
		return node;
	};
	const tree = build(document.body, 0);

	/* Assets */
	const images = Array.from(document.images)
		.slice(0, 300)
		.map(img => {
			const r = img.getBoundingClientRect();
			return {
				src: img.currentSrc || img.src,
				alt: img.getAttribute('alt'),
				naturalWidth: img.naturalWidth,
				naturalHeight: img.naturalHeight,
				renderedWidth: Math.round(r.width),
				renderedHeight: Math.round(r.height),
				loading: img.getAttribute('loading') || '',
				srcset: !!img.getAttribute('srcset'),
				decoding: img.getAttribute('decoding') || '',
				fetchPriority: img.getAttribute('fetchpriority') || '',
			};
		})
		.filter(i => i.src && !i.src.startsWith('data:image/gif'));
	const videos = Array.from(document.querySelectorAll('video'))
		.slice(0, 30)
		.map(v => ({
			src: v.currentSrc || v.getAttribute('src') || v.querySelector('source')?.getAttribute('src') || '',
			poster: v.poster || '',
			autoplay: v.autoplay,
			loop: v.loop,
			muted: v.muted,
			playsInline: v.playsInline,
		}));
	const iframes = Array.from(document.querySelectorAll('iframe'))
		.slice(0, 30)
		.map(f => ({ src: f.getAttribute('src') || '', title: f.getAttribute('title') || '' }));
	const icons = Array.from(document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="mask-icon"], link[rel="manifest"]')).map(l => ({
		rel: l.getAttribute('rel') || '',
		href: (l as HTMLLinkElement).href,
		sizes: l.getAttribute('sizes') || '',
		type: l.getAttribute('type') || '',
	}));
	const svgSeen = new Set<string>();
	const svgs: any[] = [];
	let svgTotal = 0;
	for (const svg of Array.from(document.querySelectorAll('svg'))) {
		if (svg.parentElement?.closest('svg')) continue;
		svgTotal++;
		const markup = svg.outerHTML;
		if (markup.length > 12000 || svgSeen.has(markup) || svgs.length >= 80) continue;
		svgSeen.add(markup);
		const r = svg.getBoundingClientRect();
		svgs.push({
			markup,
			cls: (svg.getAttribute('class') || '').slice(0, 120),
			viewBox: svg.getAttribute('viewBox') || '',
			width: Math.round(r.width),
			height: Math.round(r.height),
			selector: cssPath(svg),
		});
	}
	let fonts: any[] = [];
	try {
		fonts = Array.from((document as any).fonts || [])
			.slice(0, 80)
			.map((f: any) => ({ family: String(f.family).replace(/['"]/g, ''), weight: f.weight, style: f.style, status: f.status, display: f.display }));
	} catch {
		fonts = [];
	}

	/* Meta */
	const meta = Array.from(document.querySelectorAll('meta'))
		.map(m => ({
			key: m.getAttribute('name') || m.getAttribute('property') || m.getAttribute('http-equiv') || (m.getAttribute('charset') ? 'charset' : '') || m.getAttribute('itemprop') || '',
			content: m.getAttribute('content') ?? m.getAttribute('charset') ?? '',
		}))
		.filter(m => m.key)
		.slice(0, 120);
	const links = Array.from(document.querySelectorAll('link'))
		.slice(0, 120)
		.map(l => ({
			rel: l.getAttribute('rel') || '',
			href: (l as HTMLLinkElement).href,
			hreflang: l.getAttribute('hreflang') || '',
			as: l.getAttribute('as') || '',
			type: l.getAttribute('type') || '',
			media: l.getAttribute('media') || '',
		}));
	const jsonLd: any[] = [];
	const jsonScripts: any[] = [];
	for (const s of Array.from(document.querySelectorAll('script[type]'))) {
		const type = (s.getAttribute('type') || '').toLowerCase();
		if (type === 'application/ld+json') {
			try {
				jsonLd.push(JSON.parse(s.textContent || ''));
			} catch {
				/* skip invalid */
			}
		} else if (type.includes('json') && jsonScripts.length < 12) {
			jsonScripts.push({ id: s.id || '', type, json: (s.textContent || '').slice(0, 200000) });
		}
	}
	const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4'))
		.slice(0, 80)
		.map(h => ({ level: Number(h.tagName[1]), text: (h.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 140) }))
		.filter(h => h.text);
	const anchors = Array.from(document.querySelectorAll('a[href]'))
		.slice(0, 600)
		.map(a => (a as HTMLAnchorElement).href);
	const scripts = Array.from(document.scripts).map(s => ({
		src: s.src || undefined,
		type: s.type || '',
		async: s.async,
		defer: s.defer,
		module: s.type === 'module',
		id: s.id || undefined,
		inline: s.src ? undefined : (s.textContent || '').slice(0, 60000),
	}));
	const styleBlocks = Array.from(document.querySelectorAll('style'))
		.slice(0, 80)
		.map(s => s.textContent || '');

	let html = document.documentElement.outerHTML;
	const truncated = html.length > opts.maxHtml;
	if (truncated) html = html.slice(0, opts.maxHtml);

	const counts = {
		elements: all.length,
		visible: visibleCount,
		forms: document.forms.length,
		tables: document.querySelectorAll('table').length,
		dialogs: document.querySelectorAll('dialog, [role="dialog"]').length,
		tabs: document.querySelectorAll('[role="tablist"]').length,
		accordions: document.querySelectorAll('details, [aria-expanded][aria-controls]').length,
		carousels: document.querySelectorAll('.swiper, .splide, .slick-slider, [aria-roledescription="carousel"], .embla').length,
		images: document.images.length,
		videos: document.querySelectorAll('video').length,
		iframes: document.querySelectorAll('iframe').length,
		svgs: svgTotal,
		canvas: document.querySelectorAll('canvas').length,
		links: document.querySelectorAll('a[href]').length,
		buttons: document.querySelectorAll('button, [role="button"]').length,
		inputs: document.querySelectorAll('input, select, textarea').length,
	};

	return {
		url: location.href,
		title: document.title,
		lang: document.documentElement.lang || '',
		dir: document.documentElement.dir || getComputedStyle(document.documentElement).direction,
		viewport: { width: vw, height: window.innerHeight },
		docWidth: document.documentElement.scrollWidth,
		docHeight: document.documentElement.scrollHeight,
		renderedHtml: html,
		renderedHtmlTruncated: truncated,
		meta,
		links,
		jsonLd,
		jsonScripts,
		headings,
		anchors,
		scripts,
		styleBlocks,
		inlineStyles,
		classCounts,
		styles,
		typography: {
			body: typeOf(document.body),
			paragraph: typeOf(Array.from(document.querySelectorAll('p')).find(p => (p.textContent || '').trim().length > 40) || null),
			link: typeOf(document.querySelector('main a, p a, a')),
			headings: headingStyles,
		},
		components: { buttons, inputs, cards: summarizeCards, badges: Object.values(badgeGroups).sort((a: any, b: any) => b.count - a.count).slice(0, 10), navigation: navs, footer, hero, sections },
		animations: { runtime, transitions: transitionEls, attributes: attributeAnimations, gsap: gsapInfo, willChange },
		tree,
		inspect,
		assets: { images, backgrounds, videos, iframes, icons, svgs, fonts },
		counts,
	};
}
