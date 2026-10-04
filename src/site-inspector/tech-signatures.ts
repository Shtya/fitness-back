import type { CssBanner, ClassTokenAnalysis, CssVariable } from './css-analyzer';

export interface DetectionInput {
	html: string;
	headers: Record<string, string>;
	scriptUrls: string[];
	requestUrls: string[];
	css: string;
	js: string;
	globals: Record<string, string | boolean>;
	dom: Record<string, number>;
	classes: Record<string, number>;
	meta: { key: string; content: string }[];
	cookies: string[];
	cssBanners: CssBanner[];
	cssVariables: CssVariable[];
	tailwind: ClassTokenAnalysis;
}

export interface DetectedTech {
	name: string;
	category: string;
	version?: string;
	confidence: number;
	evidence: string[];
	website?: string;
	note?: string;
}

interface Checks {
	g?: string[];
	d?: string[];
	h?: RegExp[];
	s?: RegExp[];
	r?: RegExp[];
	c?: RegExp[];
	j?: RegExp[];
	hd?: Record<string, RegExp>;
	m?: RegExp;
	ck?: RegExp;
	cls?: RegExp;
}

interface Signature {
	name: string;
	category: string;
	website?: string;
	checks: Checks;
	versionGlobal?: string;
	versionRe?: { from: 'html' | 'scripts' | 'js' | 'css' | 'headers' | 'meta'; re: RegExp };
	implies?: string[];
}

const W = { g: 70, d: 55, hd: 80, m: 95, s: 60, r: 40, h: 45, c: 45, j: 45, ck: 50, cls: 40 };

const S = (name: string, category: string, checks: Checks, extra: Partial<Signature> = {}): Signature => ({
	name,
	category,
	checks,
	...extra,
});

export const SIGNATURES: Signature[] = [
	// Frameworks / meta-frameworks
	S('Next.js', 'Meta-framework', { g: ['__NEXT_DATA__', 'next', '__next_f'], d: ['#__next', 'next-route-announcer', 'nextFont'], s: [/\/_next\/static\//], hd: { 'x-powered-by': /next\.js/i, 'x-nextjs-cache': /./, 'x-nextjs-prerender': /./ }, h: [/self\.__next_f\.push/, /id="__NEXT_DATA__"/] }, { website: 'https://nextjs.org', versionGlobal: 'next.version', implies: ['React'] }),
	S('Nuxt', 'Meta-framework', { g: ['__NUXT__', '$nuxt', '__NUXT_DATA__'], s: [/\/_nuxt\//], h: [/id="__NUXT_DATA__"|window\.__NUXT__/], hd: { 'x-powered-by': /nuxt/i } }, { website: 'https://nuxt.com', implies: ['Vue.js'] }),
	S('Gatsby', 'Meta-framework', { g: ['___gatsby', '___loader'], d: ['#___gatsby'], r: [/\/page-data\/.*page-data\.json/], m: /gatsby/i }, { website: 'https://www.gatsbyjs.com', implies: ['React'] }),
	S('Remix / React Router', 'Meta-framework', { g: ['__remixContext', '__reactRouterContext', '__remixManifest'], h: [/window\.__remixContext|__reactRouterContext/] }, { website: 'https://reactrouter.com', implies: ['React'] }),
	S('Astro', 'Meta-framework', { d: ['astro-island'], s: [/\/_astro\//], m: /astro/i, h: [/<astro-island/] }, { website: 'https://astro.build', versionRe: { from: 'meta', re: /Astro v?([\d.]+)/i } }),
	S('SvelteKit', 'Meta-framework', { g: ['__sveltekit'], s: [/\/_app\/immutable\//], h: [/__sveltekit_/] }, { website: 'https://kit.svelte.dev', implies: ['Svelte'] }),
	S('Docusaurus', 'Meta-framework', { g: ['__docusaurus'], m: /docusaurus/i }, { website: 'https://docusaurus.io', implies: ['React'], versionRe: { from: 'meta', re: /Docusaurus v?([\d.]+)/i } }),
	S('VitePress', 'Meta-framework', { m: /vitepress/i, g: ['__VP_HASH_MAP__'] }, { implies: ['Vue.js'] }),
	S('React', 'Framework', { d: ['reactFiber', '[data-reactroot]'], g: ['React'], j: [/rendererPackageName:"react-dom"/, /react-dom\.production/, /__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED|__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE/] }, { website: 'https://react.dev', versionGlobal: 'React.version', versionRe: { from: 'js', re: /version:"(\d+\.\d+\.\d+[^"]*)",rendererPackageName:"react-dom"/ } }),
	S('Preact', 'Framework', { g: ['preact'], j: [/__PREACT_DEVTOOLS__|preact\/hooks/] }, { website: 'https://preactjs.com' }),
	S('Vue.js', 'Framework', { g: ['Vue', '__VUE__'], d: ['vueApp', '[data-v-]', '[data-v-app]'], j: [/__VUE_OPTIONS_API__|__vue_app__/] }, { website: 'https://vuejs.org', versionGlobal: 'Vue.version' }),
	S('Angular', 'Framework', { d: ['[ng-version]'], g: ['ng', 'getAllAngularRootElements'], j: [/ɵcmp|ngDevMode/] }, { website: 'https://angular.dev', versionRe: { from: 'html', re: /ng-version="([\d.]+)"/ } }),
	S('AngularJS', 'Framework', { g: ['angular'], d: ['[ng-app]'] }, { versionGlobal: 'angular.version.full' }),
	S('Svelte', 'Framework', { d: ['svelteClass'], j: [/svelte-[a-z0-9]{6}|\$\$props|SvelteComponent/] }, { website: 'https://svelte.dev' }),
	S('SolidJS', 'Framework', { g: ['_$HY'], j: [/solid-js/] }, { website: 'https://www.solidjs.com' }),
	S('Qwik', 'Framework', { d: ['[q:container]'], h: [/q:container=/] }, { website: 'https://qwik.dev' }),
	S('Ember.js', 'Framework', { g: ['Ember'], d: ['.ember-view'] }, { versionGlobal: 'Ember.VERSION' }),
	S('Alpine.js', 'Framework', { g: ['Alpine'], d: ['[x-data]'] }, { website: 'https://alpinejs.dev', versionGlobal: 'Alpine.version' }),
	S('htmx', 'Framework', { g: ['htmx'], d: ['[hx-get]', '[hx-post]'] }, { website: 'https://htmx.org', versionGlobal: 'htmx.version' }),
	S('Hotwire Turbo', 'Framework', { g: ['Turbo'], d: ['turbo-frame'] }),
	S('Stimulus', 'Framework', { g: ['Stimulus'], d: ['[data-controller]'] }),
	S('Livewire', 'Framework', { g: ['Livewire'], d: ['[wire:id]'] }, { implies: ['Laravel'] }),
	S('Inertia.js', 'Framework', { d: ['[data-page]'], h: [/data-page="\{&quot;component&quot;/] }),
	S('jQuery', 'Utilities', { g: ['jQuery'], s: [/jquery[.-]?(\d[\d.]*)?(\.min)?\.js/i] }, { website: 'https://jquery.com', versionGlobal: 'jQuery.fn.jquery' }),

	// Build tools
	S('Vite', 'Build tool', { s: [/\/@vite\/client|\/assets\/index-[\w-]{6,}\.js/], h: [/type="module" crossorigin src="\/assets\//] }, { website: 'https://vitejs.dev' }),
	S('Webpack', 'Build tool', { g: ['webpackChunk', '__webpack_require__'], j: [/webpackChunk|__webpack_require__/] }, { website: 'https://webpack.js.org' }),
	S('Turbopack', 'Build tool', { j: [/TURBOPACK|turbopack-/], s: [/turbopack/] }),
	S('Parcel', 'Build tool', { j: [/parcelRequire/] }),

	// CSS frameworks / UI libraries
	S('Tailwind CSS', 'CSS framework', { c: [/--tw-[a-z-]+\s*:/, /@layer\s+theme\s*,\s*base\s*,\s*components\s*,\s*utilities/] }, { website: 'https://tailwindcss.com' }),
	S('Bootstrap', 'CSS framework', { g: ['bootstrap'], s: [/bootstrap(\.bundle)?(\.min)?\.js/i], c: [/--bs-(primary|body-bg|gutter-x)/], r: [/bootstrap(\.min)?\.css/i] }, { website: 'https://getbootstrap.com', versionGlobal: 'bootstrap.Tooltip.VERSION' }),
	S('Bulma', 'CSS framework', { c: [/--bulma-|\.is-primary\.is-outlined/] }),
	S('Foundation', 'CSS framework', { g: ['Foundation'], c: [/\.foundation-mq/] }),
	S('UIkit', 'CSS framework', { g: ['UIkit'], cls: /^uk-[a-z]/ }),
	S('DaisyUI', 'UI library', { c: [/--rounded-btn|--animation-btn|--btn-focus-scale|--color-base-100/] }, { website: 'https://daisyui.com', implies: ['Tailwind CSS'] }),
	S('Radix UI', 'UI library', { d: ['[data-radix-popper-content-wrapper]', '[data-radix-collection-item]', '[data-radix-scroll-area-viewport]', 'radixId'] }, { website: 'https://www.radix-ui.com' }),
	S('Headless UI', 'UI library', { d: ['[data-headlessui-state]', 'headlessuiId'] }, { website: 'https://headlessui.com' }),
	S('MUI (Material UI)', 'UI library', { cls: /^Mui[A-Z][A-Za-z]+-(root|container)/, c: [/--mui-|\.MuiButton-root/] }, { website: 'https://mui.com' }),
	S('Chakra UI', 'UI library', { cls: /^chakra-/, c: [/--chakra-/] }, { website: 'https://chakra-ui.com' }),
	S('Ant Design', 'UI library', { cls: /^ant-(btn|layout|menu|row|col)/, c: [/\.ant-btn|--ant-/] }, { website: 'https://ant.design' }),
	S('Mantine', 'UI library', { cls: /^mantine-/, c: [/--mantine-/] }, { website: 'https://mantine.dev' }),
	S('Vuetify', 'UI library', { cls: /^v-(btn|app|main|container)$/, c: [/--v-theme-/] }),
	S('Element Plus', 'UI library', { cls: /^el-(button|input|menu)/, c: [/--el-color-primary/] }),
	S('PrimeReact / PrimeVue', 'UI library', { cls: /^p-(button|component|inputtext)/ }),
	S('NextUI / HeroUI', 'UI library', { c: [/--nextui-|--heroui-/] }),
	S('Flowbite', 'UI library', { g: ['Flowbite'], s: [/flowbite/i] }),
	S('Sonner', 'UI library', { d: ['[data-sonner-toaster]'] }),
	S('cmdk', 'UI library', { d: ['[cmdk-root]'] }),
	S('Vaul', 'UI library', { d: ['[vaul-drawer]'] }),

	// CSS-in-JS / styling approach
	S('styled-components', 'CSS-in-JS', { d: ['style[data-styled]'], cls: /^sc-[a-zA-Z]{5,}/, j: [/styled-components/] }),
	S('Emotion', 'CSS-in-JS', { d: ['style[data-emotion]'], cls: /^css-[a-z0-9]{5,8}$/ }),
	S('Stitches', 'CSS-in-JS', { cls: /^c-[a-zA-Z]{5,}(-[a-zA-Z0-9]+)?$/, c: [/--sx-/] }),
	S('vanilla-extract', 'CSS-in-JS', { cls: /^[a-zA-Z]+_[a-zA-Z0-9]+__[a-z0-9]{6,8}$/ }),
	S('JSS', 'CSS-in-JS', { d: ['style[data-jss]'] }),

	// Animation
	S('GSAP', 'Animation', { g: ['gsap', 'TweenMax', 'TweenLite'], s: [/gsap(\.min)?\.js|greensock|TweenMax/i], j: [/GreenSock|_gsap|gsap\.registerPlugin/] }, { website: 'https://gsap.com', versionGlobal: 'gsap.version' }),
	S('GSAP ScrollTrigger', 'Animation', { g: ['ScrollTrigger'], s: [/ScrollTrigger/], j: [/ScrollTrigger/] }),
	S('Framer Motion / Motion', 'Animation', { d: ['[data-projection-id]', 'framerAppear'], j: [/framer-motion|motion-dom|MotionConfig|useAnimationControls|data-framer-appear-id/] }, { website: 'https://motion.dev' }),
	S('AOS (Animate On Scroll)', 'Animation', { g: ['AOS'], d: ['[data-aos]'], s: [/aos(\.min)?\.js/i] }, { website: 'https://michalsnik.github.io/aos/' }),
	S('Anime.js', 'Animation', { g: ['anime'], s: [/anime(\.min)?\.js/] }),
	S('Lottie', 'Animation', { g: ['lottie', 'bodymovin'], d: ['lottie-player', 'dotlottie-player'], s: [/lottie/i], r: [/\.lottie$|lottie.*\.json/i] }, { website: 'https://airbnb.io/lottie/' }),
	S('Rive', 'Animation', { r: [/\.riv(\?|$)/], j: [/@rive-app/] }),
	S('Animate.css', 'Animation', { cls: /^animate__/, c: [/\.animate__animated/] }),
	S('WOW.js', 'Animation', { g: ['WOW'], cls: /^wow$/ }),
	S('ScrollReveal', 'Animation', { g: ['ScrollReveal'] }),
	S('Motion One', 'Animation', { j: [/@motionone/] }),
	S('Barba.js', 'Animation', { g: ['barba'], d: ['[data-barba]'] }),
	S('View Transitions API', 'Animation', { c: [/::view-transition|view-transition-name/] }),

	// Scroll / carousel
	S('Lenis', 'Scroll', { g: ['lenis', 'Lenis'], d: ['html.lenis'], c: [/\.lenis\.lenis-smooth/] }, { website: 'https://lenis.darkroom.engineering' }),
	S('Locomotive Scroll', 'Scroll', { g: ['LocomotiveScroll'], d: ['[data-scroll-container]'] }),
	S('Swiper', 'Carousel', { g: ['Swiper'], d: ['.swiper'], c: [/\.swiper-wrapper/] }, { website: 'https://swiperjs.com', versionGlobal: 'Swiper.version' }),
	S('Splide', 'Carousel', { g: ['Splide'], d: ['.splide'] }),
	S('Slick', 'Carousel', { d: ['.slick-slider'] }),
	S('Embla Carousel', 'Carousel', { j: [/embla-carousel|EmblaCarousel/] }),
	S('Glide.js', 'Carousel', { d: ['.glide__track'] }),

	// 3D
	S('Three.js', '3D / Canvas', { g: ['THREE', '__THREE__'], j: [/WebGLRenderer|THREE\.REVISION/] }, { website: 'https://threejs.org', versionGlobal: '__THREE__' }),
	S('Spline', '3D / Canvas', { d: ['spline-viewer'], r: [/prod\.spline\.design|splinecode/] }),
	S('PixiJS', '3D / Canvas', { g: ['PIXI'] }, { versionGlobal: 'PIXI.VERSION' }),
	S('Babylon.js', '3D / Canvas', { g: ['BABYLON'] }),
	S('p5.js', '3D / Canvas', { g: ['p5'] }),

	// Icons
	S('Font Awesome', 'Icons', { g: ['FontAwesome'], cls: /^fa-(solid|regular|brands|light|duotone|[a-z]+-[a-z]+)$|^fa[srlbd]?$/, r: [/fontawesome|kit\.fontawesome\.com|font-awesome/i] }, { website: 'https://fontawesome.com' }),
	S('Lucide', 'Icons', { d: ['svg.lucide'], g: ['lucide'] }, { website: 'https://lucide.dev' }),
	S('Heroicons', 'Icons', { d: ['heroicon'] }),
	S('Material Icons / Symbols', 'Icons', { cls: /^material-(icons|symbols)(-[a-z]+)?$/, r: [/fonts\.googleapis\.com\/(icon|css2\?family=Material)/] }),
	S('Bootstrap Icons', 'Icons', { cls: /^bi-[a-z]/, r: [/bootstrap-icons/] }),
	S('Ionicons', 'Icons', { d: ['ion-icon'] }),
	S('Iconify', 'Icons', { d: ['iconify-icon', '.iconify'], g: ['Iconify'], r: [/api\.iconify\.design/] }),
	S('Remix Icon', 'Icons', { cls: /^ri-[a-z]+-(line|fill)$/ }),
	S('Phosphor Icons', 'Icons', { cls: /^ph(-[a-z]+)?$|^ph-(bold|fill|duotone)$/ }),
	S('Tabler Icons', 'Icons', { cls: /^ti-[a-z]/, d: ['svg.tabler-icon'] }),
	S('Boxicons', 'Icons', { cls: /^bx[slb]?-[a-z]/ }),
	S('Feather Icons', 'Icons', { d: ['svg.feather'], g: ['feather'] }),

	// Fonts
	S('Google Fonts', 'Fonts', { r: [/fonts\.googleapis\.com|fonts\.gstatic\.com/] }, { website: 'https://fonts.google.com' }),
	S('Adobe Fonts (Typekit)', 'Fonts', { r: [/use\.typekit\.net|p\.typekit\.net/], g: ['Typekit'] }),
	S('Bunny Fonts', 'Fonts', { r: [/fonts\.bunny\.net/] }),
	S('Fontshare', 'Fonts', { r: [/api\.fontshare\.com/] }),
	S('next/font', 'Fonts', { d: ['nextFont'], r: [/\/_next\/static\/media\/.*\.woff2/] }),
	S('Web Font Loader', 'Fonts', { g: ['WebFont'] }),

	// CMS / builders / e-commerce
	S('WordPress', 'CMS / Builder', { g: ['wp'], r: [/\/wp-content\/|\/wp-includes\//], m: /wordpress/i, h: [/\/wp-json\//] }, { website: 'https://wordpress.org', versionRe: { from: 'meta', re: /WordPress\s*([\d.]+)/i } }),
	S('Elementor', 'CMS / Builder', { cls: /^elementor(-|$)/, m: /elementor/i }),
	S('WooCommerce', 'E-commerce', { cls: /^woocommerce/, r: [/woocommerce/] }),
	S('Shopify', 'E-commerce', { g: ['Shopify'], r: [/cdn\.shopify\.com|shopifycdn/], hd: { 'x-shopid': /./, 'powered-by': /shopify/i } }, { website: 'https://www.shopify.com' }),
	S('Webflow', 'CMS / Builder', { g: ['Webflow'], d: ['[data-wf-page]'], m: /webflow/i, r: [/assets-global\.website-files\.com|cdn\.prod\.website-files\.com/] }, { website: 'https://webflow.com' }),
	S('Framer', 'CMS / Builder', { d: ['[data-framer-name]', '[data-framer-component-type]'], r: [/framerusercontent\.com|framer\.com\/m\//], m: /framer/i }, { website: 'https://www.framer.com' }),
	S('Wix', 'CMS / Builder', { r: [/static\.wixstatic\.com|parastorage\.com/], m: /wix\.com/i }),
	S('Squarespace', 'CMS / Builder', { r: [/static1\.squarespace\.com|squarespace-cdn/], g: ['Static.SQUARESPACE_CONTEXT'] }),
	S('Ghost', 'CMS / Builder', { m: /ghost/i, r: [/\/ghost\/api\//] }),
	S('Drupal', 'CMS / Builder', { g: ['Drupal'], m: /drupal/i, hd: { 'x-generator': /drupal/i } }),
	S('Joomla', 'CMS / Builder', { m: /joomla/i }),
	S('Hugo', 'CMS / Builder', { m: /hugo/i }, { versionRe: { from: 'meta', re: /Hugo\s*([\d.]+)/i } }),
	S('Jekyll', 'CMS / Builder', { m: /jekyll/i }),
	S('Sanity', 'CMS / Builder', { r: [/cdn\.sanity\.io|\.sanity\.io\//] }),
	S('Contentful', 'CMS / Builder', { r: [/images\.ctfassets\.net|cdn\.contentful\.com/] }),
	S('Strapi', 'CMS / Builder', { r: [/\/uploads\/.*_[a-f0-9]{10}\./], hd: { 'x-powered-by': /strapi/i } }),
	S('Prismic', 'CMS / Builder', { r: [/images\.prismic\.io|\.cdn\.prismic\.io/] }),
	S('Storyblok', 'CMS / Builder', { r: [/a\.storyblok\.com/] }),
	S('Laravel', 'Server', { ck: /^(laravel_session|XSRF-TOKEN)$/ }),

	// Analytics / marketing
	S('Google Analytics', 'Analytics', { g: ['gtag', 'ga', 'GoogleAnalyticsObject'], r: [/google-analytics\.com|googletagmanager\.com\/gtag\/js|\/g\/collect\?/] }),
	S('Google Tag Manager', 'Tag manager', { g: ['google_tag_manager'], r: [/googletagmanager\.com\/gtm\.js/] }),
	S('Meta Pixel', 'Marketing', { g: ['fbq'], r: [/connect\.facebook\.net\/.*fbevents\.js/] }),
	S('TikTok Pixel', 'Marketing', { g: ['ttq'], r: [/analytics\.tiktok\.com/] }),
	S('LinkedIn Insight', 'Marketing', { g: ['_linkedin_partner_id'], r: [/snap\.licdn\.com/] }),
	S('Hotjar', 'Analytics', { g: ['hj'], r: [/static\.hotjar\.com/] }),
	S('Microsoft Clarity', 'Analytics', { g: ['clarity'], r: [/clarity\.ms/] }),
	S('Segment', 'Analytics', { r: [/cdn\.segment\.com/] }),
	S('Mixpanel', 'Analytics', { g: ['mixpanel'], r: [/cdn\.mxpnl\.com|api-js\.mixpanel\.com/] }),
	S('Amplitude', 'Analytics', { g: ['amplitude'], r: [/cdn\.amplitude\.com|api2\.amplitude\.com/] }),
	S('PostHog', 'Analytics', { g: ['posthog'], r: [/posthog\.com|\/ingest\/decide/] }),
	S('Plausible', 'Analytics', { g: ['plausible'], r: [/plausible\.io\/js/] }),
	S('Fathom', 'Analytics', { r: [/cdn\.usefathom\.com/] }),
	S('Vercel Analytics', 'Analytics', { r: [/\/_vercel\/insights|va\.vercel-scripts\.com/] }),
	S('Vercel Speed Insights', 'Analytics', { r: [/\/_vercel\/speed-insights/] }),
	S('HubSpot', 'Marketing', { g: ['_hsq', 'hbspt'], r: [/js\.hs-scripts\.com|js\.hsforms\.net/] }),
	S('Klaviyo', 'Marketing', { g: ['klaviyo'], r: [/static\.klaviyo\.com/] }),

	// Support / chat
	S('Intercom', 'Support / Chat', { g: ['Intercom'], r: [/widget\.intercom\.io|js\.intercomcdn\.com/] }),
	S('Crisp', 'Support / Chat', { g: ['$crisp'], r: [/client\.crisp\.chat/] }),
	S('Tawk.to', 'Support / Chat', { g: ['Tawk_API'], r: [/embed\.tawk\.to/] }),
	S('Zendesk', 'Support / Chat', { g: ['zE'], r: [/static\.zdassets\.com/] }),
	S('Drift', 'Support / Chat', { g: ['drift'], r: [/js\.driftt\.com/] }),

	// Monitoring
	S('Sentry', 'Monitoring', { g: ['Sentry', '__SENTRY__'], r: [/browser\.sentry-cdn\.com|ingest\.sentry\.io|ingest\.[a-z]+\.sentry\.io/] }),
	S('Datadog RUM', 'Monitoring', { g: ['DD_RUM'], r: [/datadoghq-browser-agent|browser-intake-datadoghq/] }),
	S('LogRocket', 'Monitoring', { g: ['LogRocket'], r: [/cdn\.logrocket\.io/] }),
	S('New Relic', 'Monitoring', { g: ['NREUM', 'newrelic'], r: [/js-agent\.newrelic\.com|bam\.nr-data\.net/] }),

	// Payments / security
	S('Stripe', 'Payments', { g: ['Stripe'], r: [/js\.stripe\.com/] }),
	S('PayPal', 'Payments', { g: ['paypal'], r: [/paypal\.com\/sdk\/js|paypalobjects\.com/] }),
	S('Google reCAPTCHA', 'Security', { g: ['grecaptcha'], r: [/google\.com\/recaptcha|gstatic\.com\/recaptcha/] }),
	S('hCaptcha', 'Security', { g: ['hcaptcha'], r: [/hcaptcha\.com/] }),
	S('Cloudflare Turnstile', 'Security', { g: ['turnstile'], r: [/challenges\.cloudflare\.com\/turnstile/] }),
	S('Cookiebot', 'Security', { g: ['Cookiebot'], r: [/consent\.cookiebot\.com/] }),
	S('OneTrust', 'Security', { g: ['OneTrust', 'OptanonWrapper'], r: [/cdn\.cookielaw\.org|onetrust/] }),

	// Hosting / CDN / server
	S('Vercel', 'Hosting / CDN', { hd: { 'x-vercel-id': /./, server: /vercel/i, 'x-vercel-cache': /./ } }, { website: 'https://vercel.com' }),
	S('Netlify', 'Hosting / CDN', { hd: { 'x-nf-request-id': /./, server: /netlify/i } }),
	S('Cloudflare', 'Hosting / CDN', { hd: { 'cf-ray': /./, server: /cloudflare/i }, ck: /^(__cf_bm|cf_clearance|__cfruid)$/ }),
	S('Amazon CloudFront', 'Hosting / CDN', { hd: { 'x-amz-cf-id': /./, via: /cloudfront/i } }),
	S('Amazon S3', 'Hosting / CDN', { hd: { server: /AmazonS3/i } }),
	S('Fastly', 'Hosting / CDN', { hd: { 'x-served-by': /cache-/i, via: /varnish/i, 'x-fastly-request-id': /./ } }),
	S('Akamai', 'Hosting / CDN', { hd: { 'x-akamai-transformed': /./, server: /akamai/i } }),
	S('GitHub Pages', 'Hosting / CDN', { hd: { server: /github\.com/i } }),
	S('Firebase Hosting', 'Hosting / CDN', { hd: { 'x-firebase-hosting': /./ } }),
	S('Render', 'Hosting / CDN', { hd: { 'x-render-origin-server': /./, 'rndr-id': /./ } }),
	S('Fly.io', 'Hosting / CDN', { hd: { 'fly-request-id': /./, server: /fly\/.+/i } }),
	S('Google Cloud', 'Hosting / CDN', { hd: { server: /^(gws|Google Frontend|gfe)/i, via: /google/i } }),
	S('Nginx', 'Server', { hd: { server: /nginx/i } }, { versionRe: { from: 'headers', re: /nginx\/([\d.]+)/i } }),
	S('Apache', 'Server', { hd: { server: /apache/i } }, { versionRe: { from: 'headers', re: /Apache\/([\d.]+)/i } }),
	S('LiteSpeed', 'Server', { hd: { server: /litespeed/i } }),
	S('Express', 'Server', { hd: { 'x-powered-by': /express/i } }),
	S('PHP', 'Server', { hd: { 'x-powered-by': /php/i }, ck: /^PHPSESSID$/ }, { versionRe: { from: 'headers', re: /PHP\/([\d.]+)/i } }),
	S('ASP.NET', 'Server', { hd: { 'x-powered-by': /asp\.net/i, 'x-aspnet-version': /./ }, ck: /^ASP\.NET_SessionId$/ }),

	// State / data
	S('Apollo GraphQL', 'State / Data', { g: ['__APOLLO_STATE__', '__APOLLO_CLIENT__'], j: [/ApolloClient|apollo-client/] }),
	S('GraphQL', 'State / Data', { r: [/\/graphql(\?|$)/] }),
	S('Redux', 'State / Data', { g: ['__PRELOADED_STATE__', '__REDUX_STATE__'], j: [/@@redux\/INIT/] }),
	S('TanStack Query', 'State / Data', { g: ['__REACT_QUERY_STATE__'], j: [/QueryClientProvider|@tanstack\/query/] }),
	S('SWR', 'State / Data', { j: [/SWRConfig|swr\/_internal/] }),
	S('Zustand', 'State / Data', { j: [/zustand/] }),
	S('Firebase', 'State / Data', { g: ['firebase'], r: [/firebaseio\.com|firestore\.googleapis\.com|identitytoolkit\.googleapis\.com/] }),
	S('Supabase', 'State / Data', { r: [/\.supabase\.co\//] }),
	S('Socket.IO', 'State / Data', { g: ['io'], r: [/socket\.io\/\?EIO=/] }),
	S('Axios', 'Utilities', { j: [/AxiosError|axios\/[\d.]+/] }),
	S('Lodash', 'Utilities', { g: ['_'], j: [/__lodash_hash_undefined__/] }, { versionGlobal: '_.VERSION' }),
	S('Moment.js', 'Utilities', { g: ['moment'], j: [/moment\.js|isMoment/] }, { versionGlobal: 'moment.version' }),
	S('Day.js', 'Utilities', { g: ['dayjs'], j: [/\$isDayjsObject|dayjs/] }),
	S('Zod', 'Forms', { j: [/ZodError|invalid_type_error/] }),
	S('React Hook Form', 'Forms', { j: [/react-hook-form|useFormContext/] }),
	S('i18next', 'i18n', { g: ['i18next'], j: [/i18next/] }),
	S('next-intl', 'i18n', { j: [/next-intl|NextIntlClientProvider/] }),

	// Maps / media / charts
	S('Google Maps', 'Maps / Media', { g: ['google.maps'], r: [/maps\.googleapis\.com/] }),
	S('Mapbox', 'Maps / Media', { g: ['mapboxgl'], r: [/api\.mapbox\.com/] }),
	S('Leaflet', 'Maps / Media', { g: ['L.version'], d: ['.leaflet-container'] }, { versionGlobal: 'L.version' }),
	S('YouTube embed', 'Maps / Media', { r: [/youtube\.com\/embed|youtube-nocookie\.com|ytimg\.com/] }),
	S('Vimeo embed', 'Maps / Media', { r: [/player\.vimeo\.com/] }),
	S('Cloudinary', 'Maps / Media', { r: [/res\.cloudinary\.com/] }),
	S('imgix', 'Maps / Media', { r: [/\.imgix\.net/] }),
	S('Chart.js', 'Maps / Media', { g: ['Chart'], j: [/Chart\.js/] }),
	S('D3', 'Maps / Media', { g: ['d3'] }, { versionGlobal: 'd3.version' }),
	S('Recharts', 'Maps / Media', { cls: /^recharts-/ }),

	// PWA / misc
	S('Service Worker / PWA', 'PWA', { d: ['serviceWorker', 'manifest'] }),
	S('Workbox', 'PWA', { g: ['workbox'], j: [/workbox-/] }),
	S('AMP', 'Framework', { h: [/<html[^>]+(amp|⚡)[\s>]/i] }),
	S('Calendly', 'Marketing', { g: ['Calendly'], r: [/assets\.calendly\.com/] }),
	S('Typeform', 'Forms', { r: [/embed\.typeform\.com/] }),
];

function shortUrl(url: string) {
	try {
		const u = new URL(url);
		const path = u.pathname.length > 48 ? `${u.pathname.slice(0, 48)}…` : u.pathname;
		return `${u.hostname}${path}`;
	} catch {
		return url.slice(0, 60);
	}
}

export function detectTechnologies(input: DetectionInput): DetectedTech[] {
	const results = new Map<string, DetectedTech>();
	const html = input.html || '';
	const css = input.css || '';
	const js = input.js || '';
	const generator = input.meta.filter(m => /generator/i.test(m.key)).map(m => m.content).join(' | ');
	const headerText = Object.entries(input.headers).map(([k, v]) => `${k}: ${v}`).join('\n');
	const classNames = Object.entries(input.classes);

	for (const sig of SIGNATURES) {
		const evidence: string[] = [];
		let score = 0;
		const add = (weight: number, text: string) => {
			score += weight;
			if (evidence.length < 6) evidence.push(text);
		};
		const c = sig.checks;
		for (const key of c.g || []) {
			if (input.globals[key] !== undefined && input.globals[key] !== false) add(W.g, `window.${key}`);
		}
		for (const key of c.d || []) {
			const n = input.dom[key];
			if (n) add(W.d, `DOM ${key} ×${n}`);
		}
		for (const [header, re] of Object.entries(c.hd || {})) {
			const value = input.headers[header];
			if (value && re.test(value)) add(W.hd, `header ${header}: ${value.slice(0, 60)}`);
		}
		if (c.m && generator && c.m.test(generator)) add(W.m, `meta generator: ${generator.slice(0, 60)}`);
		for (const re of c.s || []) {
			const hit = input.scriptUrls.find(u => re.test(u));
			if (hit) add(W.s, `script ${shortUrl(hit)}`);
		}
		for (const re of c.r || []) {
			const hit = input.requestUrls.find(u => re.test(u));
			if (hit) add(W.r, `request ${shortUrl(hit)}`);
		}
		for (const re of c.h || []) if (re.test(html)) add(W.h, `HTML matches ${re.source.slice(0, 40)}`);
		for (const re of c.c || []) if (re.test(css)) add(W.c, `CSS matches ${re.source.slice(0, 40)}`);
		for (const re of c.j || []) if (re.test(js)) add(W.j, `JS bundle matches ${re.source.slice(0, 40)}`);
		if (c.ck) {
			const hit = input.cookies.find(n => c.ck!.test(n));
			if (hit) add(W.ck, `cookie ${hit}`);
		}
		if (c.cls) {
			const hits = classNames.filter(([cls]) => c.cls!.test(cls));
			const total = hits.reduce((s, [, n]) => s + n, 0);
			if (total >= 2) add(W.cls, `classes ${hits.slice(0, 3).map(([cls]) => cls).join(', ')} (×${total})`);
		}
		if (score < 40) continue;

		let version: string | undefined;
		if (sig.versionGlobal && typeof input.globals[sig.versionGlobal] === 'string') {
			version = String(input.globals[sig.versionGlobal]);
		}
		if (!version && sig.versionRe) {
			const src =
				sig.versionRe.from === 'html' ? html
				: sig.versionRe.from === 'js' ? js
				: sig.versionRe.from === 'css' ? css
				: sig.versionRe.from === 'headers' ? headerText
				: sig.versionRe.from === 'meta' ? generator
				: input.scriptUrls.join('\n');
			version = src.match(sig.versionRe.re)?.[1];
		}
		results.set(sig.name, {
			name: sig.name,
			category: sig.category,
			version: version && /^[\w.+-]{1,24}$/.test(version) ? version : undefined,
			confidence: Math.min(100, score),
			evidence,
			website: sig.website,
		});
	}

	for (const banner of input.cssBanners) {
		const map: Record<string, string> = {
			'Tailwind CSS': 'CSS framework',
			Bootstrap: 'CSS framework',
			Bulma: 'CSS framework',
			Foundation: 'CSS framework',
			'Animate.css': 'Animation',
			'Font Awesome': 'Icons',
			'Bootstrap Icons': 'Icons',
			'normalize.css': 'Utilities',
			Swiper: 'Carousel',
			AOS: 'Animation',
			UIkit: 'CSS framework',
			Materialize: 'CSS framework',
			'Semantic UI': 'UI library',
			'Pico CSS': 'CSS framework',
		};
		const name = banner.name === 'AOS' ? 'AOS (Animate On Scroll)' : banner.name;
		const existing = results.get(name);
		const ev = `CSS banner in ${shortUrl(banner.source)}${banner.version ? ` (v${banner.version})` : ''}`;
		if (existing) {
			existing.confidence = 100;
			existing.version = existing.version || banner.version;
			existing.evidence.unshift(ev);
		} else {
			results.set(name, { name, category: map[banner.name] || 'Utilities', version: banner.version, confidence: 95, evidence: [ev] });
		}
	}

	if (input.tailwind.likelyTailwind) {
		const ev = `${input.tailwind.tailwindLike} utility-class usages (${Math.round(input.tailwind.tailwindRatio * 100)}% of classes)`;
		const existing = results.get('Tailwind CSS');
		if (existing) {
			existing.confidence = Math.min(100, existing.confidence + 30);
			existing.evidence.push(ev);
		} else {
			results.set('Tailwind CSS', { name: 'Tailwind CSS', category: 'CSS framework', confidence: 70, evidence: [ev], website: 'https://tailwindcss.com' });
		}
	}
	const tw = results.get('Tailwind CSS');
	if (tw && !tw.version) {
		if (/@layer\s+theme\s*,\s*base/.test(css) || /--color-[a-z]+-\d{2,3}\s*:\s*oklch/.test(css)) tw.note = 'Likely Tailwind v4 (CSS-first theme layers)';
		else if (/--tw-ring-offset-shadow/.test(css)) tw.note = 'Likely Tailwind v3';
	}

	const varNames = new Set(input.cssVariables.map(v => v.name));
	const shadcnVars = ['--primary-foreground', '--card-foreground', '--muted-foreground', '--radius', '--ring', '--popover'];
	const shadcnHits = shadcnVars.filter(v => varNames.has(v));
	if (results.has('Tailwind CSS') && shadcnHits.length >= 4) {
		results.set('shadcn/ui', {
			name: 'shadcn/ui',
			category: 'UI library',
			confidence: results.has('Radix UI') ? 85 : 60,
			evidence: [`shadcn theme variables: ${shadcnHits.slice(0, 4).join(', ')}`, ...(results.has('Radix UI') ? ['Radix UI primitives in DOM'] : [])],
			website: 'https://ui.shadcn.com',
			note: 'Inferred from design tokens — shadcn/ui is copied source, not a runtime package',
		});
	}

	const next = results.get('Next.js');
	if (next) {
		if (/self\.__next_f/.test(html) || input.globals.__next_f) next.note = 'App Router (React Server Components payload detected)';
		else if (/id="__NEXT_DATA__"/.test(html) || input.globals.__NEXT_DATA__) next.note = 'Pages Router (__NEXT_DATA__ present)';
	}

	for (const sig of SIGNATURES) {
		if (!results.has(sig.name) || !sig.implies) continue;
		for (const implied of sig.implies) {
			if (results.has(implied)) continue;
			const target = SIGNATURES.find(s => s.name === implied);
			results.set(implied, {
				name: implied,
				category: target?.category || 'Framework',
				confidence: 80,
				evidence: [`implied by ${sig.name}`],
				website: target?.website,
			});
		}
	}

	return [...results.values()].sort((a, b) => a.category.localeCompare(b.category) || b.confidence - a.confidence);
}
