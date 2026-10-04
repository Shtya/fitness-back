export interface Rgba {
	r: number;
	g: number;
	b: number;
	a: number;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const toByte = (n: number) => Math.round(clamp01(n) * 255);

function linearToSrgb(c: number) {
	return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

function parseNum(token: string, percentScale = 1) {
	const t = token.trim();
	if (t === 'none') return 0;
	if (t.endsWith('%')) return (parseFloat(t) / 100) * percentScale;
	return parseFloat(t);
}

function parseAlpha(token?: string) {
	if (token === undefined) return 1;
	const t = token.trim();
	return t.endsWith('%') ? parseFloat(t) / 100 : parseFloat(t);
}

function oklabToRgb(L: number, a: number, b: number) {
	const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
	const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
	const s_ = L - 0.0894841775 * a - 1.291485548 * b;
	const l = l_ ** 3;
	const m = m_ ** 3;
	const s = s_ ** 3;
	return {
		r: linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
		g: linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
		b: linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
	};
}

function labToRgb(L: number, A: number, B: number) {
	const fy = (L + 16) / 116;
	const fx = fy + A / 500;
	const fz = fy - B / 200;
	const e = 216 / 24389;
	const k = 24389 / 27;
	const x = (fx ** 3 > e ? fx ** 3 : (116 * fx - 16) / k) * 0.96422;
	const y = L > k * e ? fy ** 3 : L / k;
	const z = (fz ** 3 > e ? fz ** 3 : (116 * fz - 16) / k) * 0.82521;
	const lr = 3.1338561 * x - 1.6168667 * y - 0.4906146 * z;
	const lg = -0.9787684 * x + 1.9161415 * y + 0.033454 * z;
	const lb = 0.0719453 * x - 0.2289914 * y + 1.4052427 * z;
	return { r: linearToSrgb(lr), g: linearToSrgb(lg), b: linearToSrgb(lb) };
}

function hslToRgb(h: number, s: number, l: number) {
	const k = (n: number) => (n + h / 30) % 12;
	const a = s * Math.min(l, 1 - l);
	const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
	return { r: f(0), g: f(8), b: f(4) };
}

/** Parses the color formats Chrome returns from getComputedStyle plus common authored forms. */
export function parseColor(input: string): Rgba | null {
	const value = String(input || '').trim().toLowerCase();
	if (!value || value === 'transparent' || value === 'currentcolor' || value === 'inherit') return null;
	const hex = value.match(/^#([0-9a-f]{3,8})$/);
	if (hex) {
		let h = hex[1];
		if (h.length === 3 || h.length === 4) h = h.split('').map(c => c + c).join('');
		if (h.length !== 6 && h.length !== 8) return null;
		return {
			r: parseInt(h.slice(0, 2), 16),
			g: parseInt(h.slice(2, 4), 16),
			b: parseInt(h.slice(4, 6), 16),
			a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
		};
	}
	const fn = value.match(/^([a-z]+)\((.*)\)$/);
	if (!fn) return null;
	const name = fn[1];
	const [main, alphaPart] = fn[2].split('/');
	const parts = main.replace(/,/g, ' ').trim().split(/\s+/);
	const alpha = parseAlpha(alphaPart ?? (parts.length === 4 ? parts[3] : undefined));

	if (name === 'rgb' || name === 'rgba') {
		const [r, g, b] = parts.slice(0, 3).map(p => parseNum(p, 255));
		return { r: Math.round(r), g: Math.round(g), b: Math.round(b), a: alpha };
	}
	if (name === 'hsl' || name === 'hsla') {
		const h = parseFloat(parts[0]);
		const s = parseNum(parts[1]);
		const l = parseNum(parts[2]);
		const rgb = hslToRgb(h, s > 1 ? s / 100 : s, l > 1 ? l / 100 : l);
		return { r: toByte(rgb.r), g: toByte(rgb.g), b: toByte(rgb.b), a: alpha };
	}
	if (name === 'oklch' || name === 'oklab') {
		const L = parseNum(parts[0]);
		let a: number;
		let b: number;
		if (name === 'oklch') {
			const C = parseNum(parts[1], 0.4);
			const H = (parseFloat(parts[2]) || 0) * (Math.PI / 180);
			a = C * Math.cos(H);
			b = C * Math.sin(H);
		} else {
			a = parseNum(parts[1], 0.4);
			b = parseNum(parts[2], 0.4);
		}
		const rgb = oklabToRgb(L, a, b);
		return { r: toByte(rgb.r), g: toByte(rgb.g), b: toByte(rgb.b), a: alpha };
	}
	if (name === 'lab' || name === 'lch') {
		const L = parseNum(parts[0], 100);
		let A: number;
		let B: number;
		if (name === 'lch') {
			const C = parseNum(parts[1], 150);
			const H = (parseFloat(parts[2]) || 0) * (Math.PI / 180);
			A = C * Math.cos(H);
			B = C * Math.sin(H);
		} else {
			A = parseNum(parts[1], 125);
			B = parseNum(parts[2], 125);
		}
		const rgb = labToRgb(L, A, B);
		return { r: toByte(rgb.r), g: toByte(rgb.g), b: toByte(rgb.b), a: alpha };
	}
	if (name === 'color') {
		const [space, ...rest] = parts;
		if (space === 'srgb' || space === 'display-p3') {
			const [r, g, b] = rest.slice(0, 3).map(p => parseNum(p));
			return { r: toByte(r), g: toByte(g), b: toByte(b), a: parseAlpha(alphaPart) };
		}
	}
	return null;
}

export function toHex({ r, g, b, a }: Rgba) {
	const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
	return `#${h(r)}${h(g)}${h(b)}${a < 1 ? h(a * 255) : ''}`;
}

export function normalizeColor(input: string): string | null {
	const rgba = parseColor(input);
	if (!rgba || rgba.a === 0) return null;
	return toHex(rgba);
}

export function colorSaturation(hex: string) {
	const c = parseColor(hex);
	if (!c) return 0;
	const max = Math.max(c.r, c.g, c.b) / 255;
	const min = Math.min(c.r, c.g, c.b) / 255;
	if (max === 0) return 0;
	return (max - min) / max;
}

export function colorLuminance(hex: string) {
	const c = parseColor(hex);
	if (!c) return 0;
	const lin = (v: number) => {
		const s = v / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}
