// SEO: title, description, canonical, Open Graph, robots, sitemap. Только чистые функции, без обращения к сети.
import fs from 'node:fs';

export const SITE = 'https://sistemayasnosti.com';
// Служебные страницы Тильды: в новом сайте отдельных адресов нет
const SERVICE_PATHS = new Set(['/header', '/footer']);

export const isProduction = (env = process.env) => env.SITE_ENV === 'production';

export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Тильда оставляет в текстах разделители строк U+2028/2029: в title и description они ни к чему
const SPACES_RE = new RegExp('[ \\t' + String.fromCharCode(0x2028, 0x2029) + ']+', 'g');
export function cleanText(value) {
  if (value == null) return '';
  return String(value).replace(SPACES_RE, ' ').trim();
}

export function loadInventory(file) {
  const list = JSON.parse(fs.readFileSync(file, 'utf8'));
  return new Map(list.map((entry) => [entry.path, entry]));
}

// Canonical как в исходнике, но с https и без лишних вариантов хоста
export function canonicalUrl(routePath, entry, site = SITE) {
  const own = routePath === '/' ? `${site}/` : `${site}${routePath}`;
  if (!entry?.canonical) return own;
  let url;
  try { url = new URL(entry.canonical); } catch { return own; }
  if (url.hostname !== new URL(site).hostname) return own;
  const pathname = url.pathname === '/' ? '/' : url.pathname.replace(/\/+$/, '');
  return `${site}${pathname}`;
}

// Поля страницы: данные снимка важнее, запасной источник — модель страницы
export function seoFields(page, entry) {
  const title = cleanText(entry?.title) || cleanText(page?.title);
  const description = cleanText(entry?.description) || cleanText(page?.description);
  return {
    title,
    description,
    ogTitle: cleanText(entry?.ogTitle) || title,
    ogDescription: cleanText(entry?.ogDescription) || description,
  };
}

// Картинка og: только из локальных файлов (sources/local-media.json: адрес Тильды -> /media/…)
export function localOgImage(entry, page, mediaMap = {}, exists = () => true) {
  const candidates = [entry?.ogImage && mediaMap[entry.ogImage], page?.image].filter((p) => typeof p === 'string' && p.startsWith('/media/'));
  return candidates.find((p) => exists(p)) || null;
}

export function robotsContent({ production, noindex = false }) {
  return production && !noindex ? 'index,follow' : 'noindex,nofollow';
}

// Заменяет robots, заданный в оболочке (index.html), и добавляет его, если там нет
export function applyRobots(html, opts) {
  const tag = `<meta name="robots" content="${robotsContent(opts)}">`;
  return /<meta name="robots"[^>]*>/.test(html) ? html.replace(/<meta name="robots"[^>]*>/, tag) : html.replace('</head>', `${tag}</head>`);
}

export function seoHead({ routePath, page, entry, production, noindex = false, mediaMap, exists, site = SITE, canonical = true }) {
  const f = seoFields(page, entry);
  const url = canonicalUrl(routePath, entry, site);
  const image = localOgImage(entry, page, mediaMap, exists);
  return [
    canonical ? `<link rel="canonical" href="${escapeHtml(url)}">` : '',
    '<meta property="og:type" content="website">',
    '<meta property="og:locale" content="ru_RU">',
    '<meta property="og:site_name" content="Система Ясности">',
    `<meta property="og:title" content="${escapeHtml(f.ogTitle)}">`,
    f.ogDescription ? `<meta property="og:description" content="${escapeHtml(f.ogDescription)}">` : '',
    canonical ? `<meta property="og:url" content="${escapeHtml(url)}">` : '',
    image ? `<meta property="og:image" content="${escapeHtml(site + image)}">` : '',
    `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">`,
    `<meta name="twitter:title" content="${escapeHtml(f.ogTitle)}">`,
    image ? `<meta name="twitter:image" content="${escapeHtml(site + image)}">` : '',
  ].join('');
}

// Публичные маршруты для sitemap: только то, что есть в снимке опубликованных страниц и ссылается само на себя
export function publicSitemapPaths(routes, inventory, { excluded = [] } = {}) {
  const skip = new Set(excluded);
  return routes.map((r) => r.path).filter((p) => {
    if (SERVICE_PATHS.has(p) || skip.has(p)) return false;
    const entry = inventory.get(p);
    if (!entry) return false; // в снимке нет: адрес не опубликован
    if (/noindex/i.test(entry.robots || '')) return false;
    return canonicalUrl(p, entry) === canonicalUrl(p, null);
  });
}

export function sitemapXml(paths, inventory, site = SITE) {
  const urls = paths.map((p) => `  <url><loc>${escapeHtml(canonicalUrl(p, inventory.get(p), site))}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export function robotsTxt({ production, site = SITE }) {
  if (!production) return 'User-agent: *\nDisallow: /\n';
  // Закрытые продажи и их секретные ссылки не индексируются; сами адреса секретных ссылок сюда не попадают
  return `User-agent: *\nAllow: /\nDisallow: /*-preview-\nSitemap: ${site}/sitemap.xml\n`;
}

export function countH1(html) {
  return (String(html).replace(/<script[\s\S]*?<\/script>/gi, '').match(/<h1[\s>]/gi) || []).length;
}

// Задача для отчёта: на странице должен быть один h1
export function h1Report(pages) {
  return pages.map(({ path, html }) => ({ path, h1: countH1(html) })).map((r) => ({ ...r, ok: r.h1 === 1 }));
}
