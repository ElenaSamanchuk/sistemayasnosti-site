// Собирает только локальные файлы. Без выгрузки, DNS и сторонних скриптов.
import { compileLayouts } from './compile-layout.mjs';
import { normalizeBase, withBase } from '../src/lib/site-base.mjs';
import { build } from 'vite';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { isProduction, loadInventory, seoFields, seoHead, applyRobots, publicSitemapPaths, sitemapXml, robotsTxt, h1Report } from './lib/seo.mjs';
import { loadSalesConfig, planSales, redirectHtml, nginxSnippet } from './lib/sales-pages.mjs';
import { notFoundPage } from './lib/not-found.mjs';
const root = process.cwd(); const dist = path.join(root, 'dist');
const base = normalizeBase(process.env.SITE_BASE || '/');
const asset = (target) => withBase(target, base);
const SITE = 'https://sistemayasnosti.com';
const escape = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const json = (s) => JSON.stringify(s).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
if (!fsSync.existsSync('public/content/routes.json')) { console.error('Нет public/content/routes.json: сначала npm run normalize'); process.exit(1); }
async function loadRegistry() {
  const file = path.join(root, 'src/embeds/registry.mjs');
  if (!fsSync.existsSync(file)) return { embeds: null };
  return import(pathToFileURL(file).href);
}
const { shared: layout } = compileLayouts();
await build();
const shell = await fs.readFile(path.join(dist, 'index.html'), 'utf8');
const routes = JSON.parse(await fs.readFile('public/content/routes.json', 'utf8'));
await build({ publicDir: false, build: { ssr: 'src/entry-server.js', outDir: '.ssr', emptyOutDir: true } });
const { embeds: registry } = await loadRegistry();
const written = [];
const report = [];
// SEO и страницы продаж: tools/lib/seo.mjs, tools/lib/sales-pages.mjs
const production = isProduction();
const inventory = loadInventory('sources/live/2026-11-09/inventory.json');
const mediaMap = JSON.parse(fsSync.readFileSync('sources/local-media.json', 'utf8'));
const mediaExists = (p) => fsSync.existsSync(path.join(root, 'public', p));
const sales = planSales(loadSalesConfig('sources/sales-pages.json'), { routePaths: routes.map((r) => r.path), token: process.env.SALES_PREVIEW_TOKEN });
const salesBy = new Map(sales.entries.map((e) => [e.path, e]));
const jobs = routes.flatMap((route) => {
  const plan = salesBy.get(route.path);
  if (!plan || plan.mode === 'page') return [{ route, outPath: route.path, noindex: false }];
  return plan.previewPath ? [{ route, outPath: plan.previewPath, noindex: true }] : []; // закрыто: настоящая страница только по секретной ссылке
});
// Юридические документы школы написаны по-испански (решение Елены 09.11.2026)
const SPANISH_ROUTES = new Set(['/oferta', '/privacy', '/consent', '/cookie']);
const pageHtmls = [];
try {
  const { render } = await import(pathToFileURL(path.join(root, '.ssr/entry-server.js')).href);
  for (const { route, outPath, noindex } of jobs) {
    const page = JSON.parse(await fs.readFile(`public/content/${route.page}.json`, 'utf8'));
    const body = await render(page, layout);
    const head = [
      seoHead({ routePath: route.path, page, entry: inventory.get(route.path), production, noindex, mediaMap, exists: mediaExists, canonical: !noindex }),
      page.icon?.startsWith('/media/') ? `<link rel="icon" href="${asset(page.icon)}">` : '',
      ...(page.structuredData || []).map((d) => `<script type="application/ld+json">${json(d)}</script>`),
      ...['inter-latin', 'inter-cyrillic'].map((f) => `<link rel="preload" as="font" type="font/woff2" href="${asset(`/fonts/${f}.woff2`)}" crossorigin>`),
      ...['shared-layout.css', 'shared-layout-layout.css', `${route.page}.css`, `${route.page}-layout.css`].map((f) => `<link rel="stylesheet" href="${asset(`/content/${f}`)}">`),
    ].join('');
    let html = shell.replace(/<title>.*?<\/title>/s, `<title>${escape(seoFields(page, inventory.get(route.path)).title)}</title>`).replace('<meta name="description" content="">', `<meta name="description" content="${escape(seoFields(page, inventory.get(route.path)).description)}">`).replace('</head>', head + '</head>');
    if (page.shell?.background) html = html.replace('<body>', `<body style="background-color:${escape(page.shell.background)}">`);
    html = html.replace('<div id="app"></div>', () => `<div id="app">${body}</div><script type="application/json" id="site-page">${json(page)}</script><script type="application/json" id="site-layout">${json(layout)}</script>`);
    if (SPANISH_ROUTES.has(route.path)) html = html.replace('<html lang="ru">', '<html lang="es">'); // шапка и подвал несут lang="ru" в своих шаблонах: приложение пересоздаёт их после загрузки
    html = applyRobots(html, { production, noindex });
    const filename = outPath === '/' ? 'index.html' : `${outPath.slice(1)}/index.html`;
    const target = path.resolve(dist, filename);
    if (!target.startsWith(dist + path.sep)) throw new Error('Недопустимый путь: ' + route.path);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, html);
    written.push(route.path);
    pageHtmls.push({ path: outPath, html });
    const embeds = { component: [], global: [], skip: [], missing: [] };
    for (const rec of route.embeds) {
      const entry = registry?.[rec];
      if (!entry) embeds.missing.push(rec);
      else if (entry.kind === 'component') embeds.component.push(rec);
      else if (entry.kind === 'global') embeds.global.push({ rec, name: entry.name });
      else embeds.skip.push({ rec, reason: entry.reason });
    }
    report.push({ path: route.path, embeds, unsupported: route.unsupported.map((u) => u.type), unsupportedNodes: route.unsupportedNodes, unsupportedAnimations: route.unsupportedAnimations, popupsNotRendered: route.popupsNotRendered });
  }
  // 404 в оформлении сайта: шапка, футер и куки берутся у страницы /privacy
  const privacy = routes.find((r) => r.path === '/privacy') || routes[0];
  const notFound = notFoundPage(JSON.parse(await fs.readFile(`public/content/${privacy.page}.json`, 'utf8')));
  const body404 = await render(notFound, layout);
  let html404 = shell.replace(/<title>.*?<\/title>/s, `<title>${escape(notFound.title)}</title>`)
    .replace('</head>', ['inter-latin', 'inter-cyrillic'].map((f) => `<link rel="preload" as="font" type="font/woff2" href="${asset(`/fonts/${f}.woff2`)}" crossorigin>`).join('') + ['shared-layout.css', 'shared-layout-layout.css', `${privacy.page}.css`, `${privacy.page}-layout.css`].map((f) => `<link rel="stylesheet" href="${asset(`/content/${f}`)}">`).join('') + '</head>');
  if (notFound.shell?.background) html404 = html404.replace('<body>', `<body style="background-color:${escape(notFound.shell.background)}">`);
  html404 = applyRobots(html404, { production, noindex: true }).replace('<div id="app"></div>', () => `<div id="app">${body404}</div><script type="application/json" id="site-page">${json(notFound)}</script><script type="application/json" id="site-layout">${json(layout)}</script>`);
  await fs.writeFile(path.join(dist, '404.html'), html404);
  pageHtmls.push({ path: '/404', html: html404 });
  // Страницы продаж, закрытые или без исходника: временное перенаправление с сохранением query
  for (const e of sales.entries.filter((x) => x.mode === 'redirect')) {
    const dir = path.resolve(dist, e.path.slice(1));
    if (!dir.startsWith(dist + path.sep)) throw new Error('Недопустимый путь: ' + e.path);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'index.html'), redirectHtml(asset(e.redirectTo)));
  }
  await fs.mkdir('deploy', { recursive: true });
  await fs.writeFile('deploy/nginx-sales-redirects.conf', nginxSnippet(sales.entries));
  for (const w of sales.warnings) console.warn(`ВНИМАНИЕ, страницы продаж: ${w}`);
  const salesPaths = sales.entries.map((e) => e.path); // в sitemap не входят, пока страница не опубликована
  await fs.writeFile(path.join(dist, 'robots.txt'), robotsTxt({ production }));
  await fs.writeFile(path.join(dist, 'sitemap.xml'), sitemapXml(publicSitemapPaths(routes, inventory, { excluded: salesPaths }), inventory));
  const h1 = h1Report(pageHtmls);
  for (const r of h1.filter((x) => !x.ok)) console.warn(`SEO: на ${r.path} h1 = ${r.h1} (нужен один)`);
  await fs.writeFile('docs/static-build.json', JSON.stringify({ at: new Date().toISOString(), mode: production ? 'production, индексация разрешена' : 'превью, noindex', count: written.length, salesPages: sales.entries.map(({ path, open, mode }) => ({ path, open, mode })), h1: h1.map(({ path, h1 }) => ({ path, h1 })), routes: report }, null, 1));
  const missing = report.flatMap((r) => r.embeds.missing.map((rec) => `${r.path}:${rec}`));
  console.log(`Собрано страниц: ${written.length}. Блоков T123 без записи в реестре: ${missing.length}${missing.length ? ' (' + missing.join(', ') + ')' : ''}. Выкладка не выполнялась.`);
} finally { await fs.rm(path.join(root, '.ssr'), { recursive: true, force: true }); }
