import { BadRequestException } from '@nestjs/common';
import axios from 'axios';
import * as dns from 'dns';
import * as http from 'http';
import * as https from 'https';
import * as net from 'net';

const ALLOWED_PORTS = new Set(['', '80', '443', '8080', '8443']);
const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa', '.lan', '.intranet', '.corp'];
const BLOCKED_HOSTS = new Set(['localhost', 'metadata.google.internal', 'metadata']);

export const BROWSER_UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function ipv4ToInt(ip: string) {
	return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function inV4Range(ip: string, cidr: string) {
	const [base, bitsRaw] = cidr.split('/');
	const bits = Number(bitsRaw);
	const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
	return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

const BLOCKED_V4 = [
	'0.0.0.0/8',
	'10.0.0.0/8',
	'100.64.0.0/10',
	'127.0.0.0/8',
	'169.254.0.0/16',
	'172.16.0.0/12',
	'192.0.0.0/24',
	'192.0.2.0/24',
	'192.88.99.0/24',
	'192.168.0.0/16',
	'198.18.0.0/15',
	'198.51.100.0/24',
	'203.0.113.0/24',
	'224.0.0.0/4',
	'240.0.0.0/4',
];

function expandIpv6(ip: string): number[] | null {
	let addr = ip.toLowerCase().split('%')[0];
	const v4 = addr.match(/^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
	if (v4) {
		const p = v4.slice(2, 6).map(Number);
		if (p.some(n => n > 255)) return null;
		addr = `${v4[1]}${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
	}
	const halves = addr.split('::');
	if (halves.length > 2) return null;
	const head = halves[0] ? halves[0].split(':') : [];
	const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
	const missing = 8 - head.length - tail.length;
	if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
	const groups = [...head, ...(halves.length === 2 ? Array(missing).fill('0') : []), ...tail].map(g =>
		/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN,
	);
	if (groups.length !== 8 || groups.some(Number.isNaN)) return null;
	return groups;
}

/** True when the IP is loopback, private, link-local, multicast, reserved or otherwise non-public. */
export function isBlockedIp(ip: string): boolean {
	const family = net.isIP(ip);
	if (family === 4) return BLOCKED_V4.some(cidr => inV4Range(ip, cidr)) || ip === '255.255.255.255';
	if (family !== 6) return true;
	const g = expandIpv6(ip);
	if (!g || g.length !== 8) return true;
	if (g.every(x => x === 0)) return true;
	if (g.slice(0, 7).every(x => x === 0) && g[7] === 1) return true;
	const embeddedV4 = () => `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
	if (g.slice(0, 5).every(x => x === 0) && g[5] === 0xffff) return isBlockedIp(embeddedV4());
	if (g[0] === 0x64 && g[1] === 0xff9b) return isBlockedIp(embeddedV4());
	if ((g[0] & 0xfe00) === 0xfc00) return true;
	if ((g[0] & 0xffc0) === 0xfe80) return true;
	if ((g[0] & 0xff00) === 0xff00) return true;
	if (g[0] === 0x2001 && g[1] === 0x0db8) return true;
	if (g[0] === 0x0100 && g.slice(1, 4).every(x => x === 0)) return true;
	return false;
}

export function isBlockedHostname(hostname: string) {
	const host = hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
	if (!host) return true;
	if (BLOCKED_HOSTS.has(host)) return true;
	if (BLOCKED_HOST_SUFFIXES.some(s => host.endsWith(s))) return true;
	if (net.isIP(host)) return isBlockedIp(host);
	if (!host.includes('.')) return true;
	return false;
}

/** Normalizes user input to an absolute http(s) URL and rejects obviously unsafe targets. */
export function parsePublicUrl(raw: string): URL {
	let value = String(raw || '').trim();
	if (!value) throw new BadRequestException('URL is required');
	if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `https://${value}`;
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new BadRequestException('Invalid URL');
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new BadRequestException('Only http and https URLs are supported');
	}
	if (url.username || url.password) throw new BadRequestException('URLs with credentials are not allowed');
	if (!ALLOWED_PORTS.has(url.port)) throw new BadRequestException('Only standard web ports are allowed');
	if (isBlockedHostname(url.hostname)) {
		throw new BadRequestException('This address is private or not publicly reachable');
	}
	url.hash = '';
	return url;
}

export async function resolvePublicHost(hostname: string): Promise<string[]> {
	const host = hostname.replace(/^\[|\]$/g, '');
	if (net.isIP(host)) {
		if (isBlockedIp(host)) throw new BadRequestException('This address is private or not publicly reachable');
		return [host];
	}
	let records: dns.LookupAddress[];
	try {
		records = await dns.promises.lookup(host, { all: true, verbatim: true });
	} catch {
		throw new BadRequestException(`Could not resolve ${host}`);
	}
	if (!records.length || records.some(r => isBlockedIp(r.address))) {
		throw new BadRequestException('This address is private or not publicly reachable');
	}
	return records.map(r => r.address);
}

/** DNS lookup used at socket-connect time so a rebinding answer cannot reach private networks. */
function safeLookup(hostname: string, options: any, callback: any) {
	const opts = typeof options === 'function' ? {} : options || {};
	const cb = typeof options === 'function' ? options : callback;
	dns.lookup(hostname, { ...opts, all: true, verbatim: true }, (err, addresses: any) => {
		if (err) return cb(err);
		const list: dns.LookupAddress[] = Array.isArray(addresses) ? addresses : [];
		if (!list.length || list.some(a => isBlockedIp(a.address))) {
			const blocked = new Error(`Blocked non-public address for ${hostname}`) as NodeJS.ErrnoException;
			blocked.code = 'EBLOCKED';
			return cb(blocked);
		}
		if (opts.all) return cb(null, list);
		return cb(null, list[0].address, list[0].family);
	});
}

const httpAgent = new http.Agent({ lookup: safeLookup as any, keepAlive: false });
const httpsAgent = new https.Agent({ lookup: safeLookup as any, keepAlive: false });

export interface SafeFetchResult {
	url: string;
	status: number;
	headers: Record<string, string>;
	body: string;
	bytes: number;
	redirects: string[];
	contentType: string;
}

export async function safeFetch(
	rawUrl: string,
	{
		maxBytes = 3_000_000,
		timeoutMs = 15_000,
		accept = 'text/html,application/xhtml+xml,*/*;q=0.8',
		maxRedirects = 5,
	}: { maxBytes?: number; timeoutMs?: number; accept?: string; maxRedirects?: number } = {},
): Promise<SafeFetchResult> {
	let current = parsePublicUrl(rawUrl);
	const redirects: string[] = [];
	for (let hop = 0; hop <= maxRedirects; hop++) {
		await resolvePublicHost(current.hostname);
		const res = await axios.get<ArrayBuffer>(current.toString(), {
			responseType: 'arraybuffer',
			maxRedirects: 0,
			validateStatus: () => true,
			timeout: timeoutMs,
			maxContentLength: maxBytes,
			maxBodyLength: maxBytes,
			httpAgent,
			httpsAgent,
			proxy: false,
			headers: {
				'User-Agent': BROWSER_UA,
				Accept: accept,
				'Accept-Language': 'en-US,en;q=0.9',
			},
		});
		const headers: Record<string, string> = {};
		for (const [k, v] of Object.entries(res.headers || {})) {
			headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v ?? '');
		}
		if (res.status >= 300 && res.status < 400 && headers.location) {
			redirects.push(current.toString());
			current = parsePublicUrl(new URL(headers.location, current).toString());
			continue;
		}
		const buffer = Buffer.from(res.data || new ArrayBuffer(0));
		return {
			url: current.toString(),
			status: res.status,
			headers,
			body: buffer.toString('utf8'),
			bytes: buffer.length,
			redirects,
			contentType: headers['content-type'] || '',
		};
	}
	throw new BadRequestException('Too many redirects');
}
