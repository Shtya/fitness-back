import { colorLuminance, colorSaturation, normalizeColor } from './color-utils';
import { analyzeClassTokens, analyzeCss, isTailwindUtility } from './css-analyzer';
import { extractStaticHtml } from './html-static';
import { buildSeo, findSourceMapUrls, inferBaseUnit, nameButtonVariants } from './report-builder';
import { detectTechnologies, DetectionInput } from './tech-signatures';
import { isBlockedHostname, isBlockedIp, parsePublicUrl } from './url-guard';

describe('url-guard', () => {
	it.each(['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1'])('blocks private IPv4 %s', ip => {
		expect(isBlockedIp(ip)).toBe(true);
	});

	it.each(['::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '64:ff9b::a00:1', 'ff02::1'])('blocks non-public IPv6 %s', ip => {
		expect(isBlockedIp(ip)).toBe(true);
	});

	it('allows public addresses', () => {
		expect(isBlockedIp('8.8.8.8')).toBe(false);
		expect(isBlockedIp('2606:4700:4700::1111')).toBe(false);
		expect(isBlockedIp('::ffff:8.8.8.8')).toBe(false);
	});

	it('blocks internal hostnames', () => {
		for (const host of ['localhost', 'app.localhost', 'printer.local', 'metadata.google.internal', 'intranet', '[::1]']) {
			expect(isBlockedHostname(host)).toBe(true);
		}
		expect(isBlockedHostname('example.com')).toBe(false);
	});

	it('normalizes and validates URLs', () => {
		expect(parsePublicUrl('example.com/path#x').toString()).toBe('https://example.com/path');
		expect(() => parsePublicUrl('ftp://example.com')).toThrow();
		expect(() => parsePublicUrl('http://user:pass@example.com')).toThrow();
		expect(() => parsePublicUrl('http://example.com:22')).toThrow();
		expect(() => parsePublicUrl('http://2130706433/')).toThrow();
		expect(() => parsePublicUrl('http://0x7f.1/')).toThrow();
		expect(() => parsePublicUrl('')).toThrow();
	});
});

describe('color-utils', () => {
	it('normalizes common color syntaxes to hex', () => {
		expect(normalizeColor('rgb(255, 0, 0)')).toBe('#ff0000');
		expect(normalizeColor('#0F0')).toBe('#00ff00');
		expect(normalizeColor('hsl(240 100% 50%)')).toBe('#0000ff');
		expect(normalizeColor('rgba(0, 0, 0, 0)')).toBeNull();
		expect(normalizeColor('transparent')).toBeNull();
	});

	it('computes saturation and luminance', () => {
		expect(colorSaturation('#808080')).toBe(0);
		expect(colorSaturation('#ff0000')).toBe(1);
		expect(colorLuminance('#ffffff')).toBeCloseTo(1, 3);
		expect(colorLuminance('#000000')).toBe(0);
	});
});

describe('css-analyzer', () => {
	const css = `/*! tailwindcss v3.4.1 | MIT License */
:root { --primary: #2563eb; --radius: 0.5rem; }
@media (min-width: 768px) { .a { color: red } }
@media (width >= 1024px) { .b { color: blue !important } }
@keyframes fade { from { opacity: 0 } to { opacity: 1 } }
.c { animation: fade 1s ease; }
@font-face { font-family: "Inter"; font-weight: 400; src: url(/inter.woff2) format("woff2"); }
@media (prefers-reduced-motion: reduce) { .c { animation: none } }`;

	it('extracts variables, breakpoints, keyframes, fonts and banners', () => {
		const result = analyzeCss([{ url: 'https://x.test/app.css', text: css }]);
		expect(result.variables.find(v => v.name === '--primary')?.hex).toBe('#2563eb');
		expect(result.breakpoints.map(b => b.value)).toEqual(expect.arrayContaining([768, 1024]));
		expect(result.keyframes[0].name).toBe('fade');
		expect(result.keyframes[0].usedBy).toContain('.c');
		expect(result.fontFaces[0].family).toBe('Inter');
		expect(result.banners[0]).toMatchObject({ name: 'Tailwind CSS', version: '3.4.1' });
		expect(result.importantCount).toBe(1);
		expect(result.features.reducedMotion).toBe(true);
	});

	it('recognizes Tailwind utility classes', () => {
		for (const cls of ['flex', 'md:px-4', 'hover:bg-blue-500', 'text-[13px]', 'dark:text-white', '-mt-2', 'grid-cols-3']) {
			expect(isTailwindUtility(cls)).toBe(true);
		}
		expect(isTailwindUtility('header__logo')).toBe(false);
		const analysis = analyzeClassTokens({ flex: 30, 'items-center': 20, 'md:px-4': 10, 'text-[13px]': 4, Header_root__a1b2c: 1 });
		expect(analysis.likelyTailwind).toBe(true);
		expect(analysis.arbitraryValues).toBe(1);
		expect(analysis.cssModules.map(c => c.cls)).toContain('Header_root__a1b2c');
	});
});

describe('html-static', () => {
	it('extracts meta, scripts, classes and assets', () => {
		const html = `<!doctype html><html lang="en" dir="ltr"><head><title>Hello &amp; world</title>
<meta name="description" content="Desc"><meta property="og:title" content="OG">
<link rel="stylesheet" href="/app.css"><script src="/_next/static/chunks/main.js" defer></script>
<script type="application/ld+json">{"@type":"Organization"}</script></head>
<body><h1 class="text-xl font-bold">Title</h1><img src="/a.png" alt="A"><svg viewBox="0 0 10 10"><path d="M0 0"/></svg></body></html>`;
		const st = extractStaticHtml(html, 'https://x.test/');
		expect(st.title).toBe('Hello & world');
		expect(st.lang).toBe('en');
		expect(st.meta.find(m => m.key === 'description')?.content).toBe('Desc');
		expect(st.scripts[0].src).toBe('https://x.test/_next/static/chunks/main.js');
		expect(st.jsonLd).toHaveLength(1);
		expect(st.classCounts['font-bold']).toBe(1);
		expect(st.images[0].src).toBe('https://x.test/a.png');
		expect(st.svgs).toHaveLength(1);
		expect(st.headings[0]).toEqual({ level: 1, text: 'Title' });
	});
});

describe('tech-signatures', () => {
	const base = (): DetectionInput => ({
		html: '',
		headers: {},
		scriptUrls: [],
		requestUrls: [],
		css: '',
		js: '',
		globals: {},
		dom: {},
		classes: {},
		meta: [],
		cookies: [],
		cssBanners: [],
		cssVariables: [],
		tailwind: analyzeClassTokens({}),
	});

	it('detects Next.js App Router with React and version', () => {
		const tech = detectTechnologies({
			...base(),
			html: '<script>self.__next_f.push([1,""])</script>',
			scriptUrls: ['https://x.test/_next/static/chunks/main-app.js'],
			globals: { next: true, 'next.version': '15.1.0', __next_f: true },
		});
		const next = tech.find(t => t.name === 'Next.js');
		expect(next).toBeDefined();
		expect(next!.version).toBe('15.1.0');
		expect(next!.note).toMatch(/App Router/);
		expect(tech.some(t => t.name === 'React')).toBe(true);
	});

	it('does not report technologies without evidence', () => {
		expect(detectTechnologies(base())).toEqual([]);
	});

	it('adds Tailwind from class ratio and shadcn/ui from theme tokens', () => {
		const tailwind = analyzeClassTokens({ flex: 40, 'items-center': 30, 'px-4': 30, 'text-sm': 20, 'bg-primary': 10 });
		const tech = detectTechnologies({
			...base(),
			tailwind,
			cssVariables: ['--primary-foreground', '--card-foreground', '--muted-foreground', '--radius', '--ring'].map(name => ({ name, value: '0', scope: ':root', isColor: false })),
		});
		expect(tech.some(t => t.name === 'Tailwind CSS')).toBe(true);
		expect(tech.some(t => t.name === 'shadcn/ui')).toBe(true);
	});
});

describe('report-builder', () => {
	it('infers an 8px spacing grid', () => {
		expect(inferBaseUnit({ '8px': 10, '16px': 20, '24px': 5, '32px': 4 })?.unit).toBe(8);
		expect(inferBaseUnit({ '4px': 10, '12px': 10, '8px': 5 })?.unit).toBe(4);
		expect(inferBaseUnit({})).toBeNull();
	});

	it('names button variants from computed styles', () => {
		const named = nameButtonVariants([
			{ styles: { backgroundColor: 'rgb(37, 99, 235)', borderRadius: '9999px' }, height: 40 },
			{ styles: { backgroundColor: 'rgba(0, 0, 0, 0)', border: '1px solid rgb(0,0,0)', borderRadius: '6px' }, height: 32 },
			{ styles: { backgroundColor: 'rgba(0, 0, 0, 0)' }, height: 48 },
			{ styles: { backgroundColor: 'rgb(17, 17, 17)' }, iconOnly: true, height: 36 },
		]);
		expect(named.map(b => b.name)).toEqual(['Primary', 'Outline', 'Ghost / Link', 'Icon button']);
		expect(named[0]).toMatchObject({ shape: 'pill', size: 'md' });
		expect(named[1].size).toBe('sm');
	});

	it('finds public source map references', () => {
		const urls = findSourceMapUrls([
			{ url: 'https://x.test/js/app.js', text: 'console.log(1)\n//# sourceMappingURL=app.js.map' },
			{ url: 'https://x.test/a.css', text: 'a{}/*# sourceMappingURL=data:application/json;base64,e30= */' },
		]);
		expect(urls).toEqual(['https://x.test/js/app.js.map']);
	});

	it('scores SEO checks', () => {
		const seo = buildSeo(
			{
				title: 'A reasonably descriptive title',
				lang: 'en',
				meta: [{ key: 'viewport', content: 'width=device-width' }],
				links: [{ rel: 'canonical', href: 'https://x.test/' }],
				headings: [{ level: 1, text: 'Hi' }],
				anchors: ['https://x.test/a', 'https://other.test/'],
				assets: { images: [{ src: 'a.png', alt: null }] },
				jsonLd: [],
			},
			'https://x.test/',
		);
		expect(seo.checks.find(c => c.id === 'title')?.ok).toBe(true);
		expect(seo.checks.find(c => c.id === 'alt')?.ok).toBe(false);
		expect(seo.links).toEqual({ total: 2, internal: 1, external: 1 });
		expect(seo.score).toBeGreaterThan(0);
	});
});
