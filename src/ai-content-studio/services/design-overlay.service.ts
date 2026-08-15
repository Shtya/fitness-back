import { Injectable } from '@nestjs/common';

export type DesignOptions = {
  enabled: boolean;
  mode?: 'off' | 'html' | 'canvas' | 'svg' | 'custom';
  headline?: string;
  font?: string;
  fontSize?: number;
  fontWeight?: number | string;
  position?: 'top' | 'center' | 'bottom';
  alignment?: 'right' | 'center' | 'left';
  backgroundOverlay?: number;
  brandColor?: string;
  textColor?: string;
  logoUrl?: string;
};

/**
 * Server-side SVG overlay so Arabic headline can be composited without relying on
 * model text rendering. Returns an SVG data URL; the FE also offers live Canvas preview.
 */
@Injectable()
export class DesignOverlayService {
  apply(baseImageUrl: string, opts: DesignOptions & { topic?: string; content?: string }) {
    if (!opts?.enabled || opts.mode === 'off') {
      return { imageUrl: baseImageUrl, headline: opts?.headline || opts?.topic || '' };
    }
    const headline =
      opts.headline ||
      opts.topic ||
      (opts.content ? opts.content.split('\n').find((l) => l.trim())?.slice(0, 80) : '') ||
      '';
    const lines = wrapArabic(headline, 22).slice(0, 2);
    const font = opts.font || 'Tahoma, Arial, sans-serif';
    const long = headline.length > 42 || lines.length > 1;
    const fontSize = Number(opts.fontSize || 48) * (long ? 0.78 : 1);
    const fontWeight = opts.fontWeight || 700;
    const textColor = opts.textColor || '#ffffff';
    const brand = opts.brandColor || '#0f766e';
    const overlay = Math.min(Math.max(opts.backgroundOverlay ?? 0.35, 0), 0.85);
    const align = opts.alignment || 'right';
    const anchor = align === 'left' ? 'start' : align === 'center' ? 'middle' : 'end';
    const x = align === 'left' ? 64 : align === 'center' ? 512 : 960;
    const y = opts.position === 'top' ? 120 : opts.position === 'center' ? 512 : 900;
    const boxH = 72 + lines.length * Math.round(fontSize * 1.15);
    const tspans = lines
      .map((line, i) => `<tspan x="${x}" dy="${i === 0 ? 0 : Math.round(fontSize * 1.2)}">${escapeXml(line)}</tspan>`)
      .join('');

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${brand}" stop-opacity="${overlay * 0.2}"/>
      <stop offset="100%" stop-color="#000" stop-opacity="${overlay}"/>
    </linearGradient>
  </defs>
  <image href="${escapeXml(baseImageUrl)}" x="0" y="0" width="1024" height="1024" preserveAspectRatio="xMidYMid slice"/>
  <rect x="0" y="${Math.max(0, y - boxH + 24)}" width="1024" height="${boxH + 48}" fill="url(#g)"/>
  <rect x="48" y="${y - 56}" width="928" height="${boxH}" rx="24" fill="${brand}" fill-opacity="0.45"/>
  <text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${font}" font-size="${fontSize}" font-weight="${fontWeight}" fill="${textColor}" direction="rtl" xml:lang="ar">${tspans}</text>
</svg>`;

    const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
    return { imageUrl: dataUrl, headline: lines.join(' ') };
  }
}

function escapeXml(s: string) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function wrapArabic(text: string, max = 22) {
  const words = String(text || '').trim().split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > max) {
      if (cur) lines.push(cur);
      cur = w;
    } else {
      cur = (cur + ' ' + w).trim();
    }
  }
  if (cur) lines.push(cur);
  return lines;
}
