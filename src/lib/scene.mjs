import { withBase } from './site-base.mjs';
export const screens = [1200, 960, 640, 480, 320];
export function screenFor(width, points = screens) { return [...points].sort((a, b) => b - a).find((s) => width >= s) || Math.min(...points); }
export function field(fields, key, screen, board = false) {
  let value = fields[board ? key : `${key}-value`] ?? fields[key];
  const points = [...new Set(Object.keys(fields).flatMap((k) => { const m = k.match(/-res-(\d+)/); return m ? [Number(m[1])] : []; }))].sort((a, b) => b - a);
  for (const point of points) {
    if (point < screen) break;
    const override = fields[board ? `${key}-res-${point}` : `${key}-res-${point}-value`] ?? fields[`${key}-res-${point}`];
    if (override !== undefined) value = override;
  }
  return value;
}
const SITE_HOSTS = ['sistemayasnosti.com', 'www.sistemayasnosti.com'];
export function localLink(href) {
  if (!href) return undefined;
  if (href.startsWith('#')) return href;
  let url;
  try { url = new URL(href, typeof location === 'undefined' ? 'https://sistemayasnosti.com' : location.origin); } catch { return href; }
  if (!['http:', 'https:', 'mailto:', 'tel:', 'tg:', 'whatsapp:', 'viber:'].includes(url.protocol)) return undefined;
  if (SITE_HOSTS.includes(url.hostname) || (typeof location !== 'undefined' && url.origin === location.origin)) return withBase(`${url.pathname}${url.search}${url.hash}`);
  return href;
}
export function linkTarget(href) { return /^https?:\/\//i.test(localLink(href) || '') ? '_blank' : undefined; }
