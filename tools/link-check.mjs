// Обход ссылок опубликованной сборки: внутренние адреса, якоря, файлы и внешние ссылки.
// Запуск: node tools/link-check.mjs [адрес превью]. Код 1, если есть битые. Только GET, формы и оплаты не выполняются.
const base = (process.argv[2] || 'https://elenasamanchuk.github.io/sistemayasnosti-site').replace(/\/$/, '');
const pages = ['/', '/taplink', '/mini', '/about', '/clarity', '/audio-club', '/audio-club-old', '/audio-club-old-old', '/oferta', '/privacy', '/consent', '/cookie', '/pred', '/pred_fl'];
const POPUP_ANCHORS = new Set(['#zeropopup', '#zeropopupmain', '#home', '#top', '#']);
const agent = { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131 Safari/537.36' };
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&#x2F;/g, '/');
const pageHtml = new Map();
const links = new Map(); // адрес -> страницы, где встречается
const add = (url, page) => { if (!links.has(url)) links.set(url, new Set()); links.get(url).add(page); };
const anchors = [];

async function get(url) {
  for (let i = 0; i < 2; i += 1) {
    try {
      const r = await fetch(url, { redirect: 'follow', headers: agent, signal: AbortSignal.timeout(25000) });
      await r.body?.cancel();
      return { status: r.status, final: r.url };
    } catch (e) { if (i) return { status: 0, final: String(e.cause?.code || e.message) }; }
  }
  return { status: 0, final: 'нет ответа' };
}

for (const path of pages) {
  const r = await fetch(`${base}${path === '/' ? '/' : `${path}/`}`, { headers: agent });
  const html = await r.text();
  pageHtml.set(path, html);
  if (r.status !== 200) add(`${base}${path}/`, path);
  const seen = new Set();
  for (const m of html.matchAll(/<(?:a|img|source|video|link|script)\b[^>]*?\b(?:href|src|poster)="([^"]+)"/g)) seen.add(decode(m[1]));
  for (const m of html.matchAll(/"(?:href|link|url|src|poster|buttonhref)"\s*:\s*"([^"]+)"/g)) seen.add(decode(m[1].replace(/\\\//g, '/')));
  for (const u of seen) {
    if (/^(mailto:|tel:|data:|blob:|javascript:)/i.test(u) || !u) continue;
    if (u.startsWith('#')) { if (!POPUP_ANCHORS.has(u)) anchors.push({ page: path, id: u.slice(1) }); continue; }
    if (u.startsWith('//')) add(`https:${u}`, path);
    else if (/^https?:/i.test(u)) add(u, path);
    else if (u.startsWith('/')) add(u.startsWith('/sistemayasnosti-site') ? new URL(base).origin + u : base + u, path);
  }
}
// Адреса внутри загружаемых частей приложения (аудиоклуб и другие блоки без статической разметки)
const html = pageHtml.get('/audio-club');
const chunks = new Set([...html.matchAll(/\/assets\/[\w.-]+\.js/g)].map((m) => m[0]));
const home = await fetch(`${new URL(base).origin}${new URL(base).pathname}${[...chunks][0] || ''}`, { headers: agent }).then((r) => r.text()).catch(() => '');
for (const m of home.matchAll(/[\w.-]+\.js/g)) if (/^(AudioClub|Typewriter|Snitch|CookieConsent)/.test(m[0])) chunks.add(`/assets/${m[0]}`);
for (const c of chunks) {
  const text = await fetch(`${base}${c.startsWith('/sistemayasnosti-site') ? c.slice('/sistemayasnosti-site'.length) : c}`, { headers: agent }).then((r) => r.text()).catch(() => '');
  for (const m of text.matchAll(/https:\/\/(?:t\.me|lk\.sistemayasnosti\.com)\/[^"'`\s\\)]+/g)) add(m[0], `приложение (${c.split('/').pop().split('-')[0]})`);
}

const broken = [], limited = [], ok = [];
const queue = [...links.keys()].filter((u) => !/\/\/(fonts\.|www\.w3\.org)/.test(u));
for (const url of queue) {
  const res = await get(url);
  const where = [...links.get(url)].slice(0, 3).join(', ');
  const external = !url.startsWith(new URL(base).origin);
  const socialBlock = external && /instagram\.com|youtube\.com|t\.me/.test(url) && (res.status === 429 || res.status === 403 || res.status === 0);
  if (res.status >= 200 && res.status < 400) ok.push({ url, ...res });
  else if (socialBlock) limited.push({ url, ...res, where });
  else broken.push({ url, ...res, where });
}
const missing = anchors.filter(({ page, id }) => !new RegExp(`(?:id|name|data-anchor)="${id}"`).test(pageHtml.get(page)) && !pageHtml.get(page).includes(`"${id}"`));
const uniq = [...new Map(missing.map((a) => [`${a.page}#${a.id}`, a])).values()];
const external = ok.filter((x) => !x.url.startsWith(new URL(base).origin));
console.log(`Проверено адресов: ${queue.length}. Рабочих: ${ok.length}, из них внешних: ${external.length}. Сайт ограничил проверку: ${limited.length}. Битых: ${broken.length}. Якорей без цели: ${uniq.length}`);
for (const x of external) console.log(`ВНЕШНЯЯ ${x.status} ${x.url.slice(0, 90)}${x.final !== x.url ? ` -> ${x.final.slice(0, 70)}` : ''}`);
for (const x of limited) console.log(`ОГРАНИЧЕНО ${x.status} ${x.url.slice(0, 90)} [${x.where}]`);
for (const x of broken) console.log(`БИТАЯ ${x.status} ${x.url.slice(0, 110)} [${x.where}]`);
for (const a of uniq) console.log(`ЯКОРЬ БЕЗ ЦЕЛИ ${a.page}#${a.id}`);
process.exit(broken.length || uniq.length ? 1 : 0);
