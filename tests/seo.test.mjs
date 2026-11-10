import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalUrl, cleanText, seoFields, seoHead, applyRobots, publicSitemapPaths, sitemapXml, robotsTxt, countH1, h1Report, isProduction, localOgImage } from '../tools/lib/seo.mjs';

const inv = new Map([
  ['/', { path: '/', title: 'Система Ясности', description: 'Д', canonical: 'http://sistemayasnosti.com', ogImage: 'https://t/1.png' }],
  ['/about', { path: '/about', title: 'О создателе', description: 'того,' + String.fromCharCode(0x2028) + 'как', canonical: 'http://sistemayasnosti.com/about', ogImage: 'https://t/2.png' }],
  ['/audio-club-old-old', { path: '/audio-club-old-old', canonical: 'http://sistemayasnosti.com/audio-club' }],
  ['/header', { path: '/header', canonical: 'http://sistemayasnosti.com/header' }],
  ['/oferta', { path: '/oferta', title: 'Договор', description: null, canonical: 'http://sistemayasnosti.com/oferta', ogImage: null }],
]);

test('canonical: https, главная со слэшем, остальные без', () => {
  assert.equal(canonicalUrl('/', inv.get('/')), 'https://sistemayasnosti.com/');
  assert.equal(canonicalUrl('/about', inv.get('/about')), 'https://sistemayasnosti.com/about');
  assert.equal(canonicalUrl('/x', undefined), 'https://sistemayasnosti.com/x');
  assert.equal(canonicalUrl('/audio-club-old-old', inv.get('/audio-club-old-old')), 'https://sistemayasnosti.com/audio-club');
  assert.ok(!canonicalUrl('/about', { canonical: 'http://evil.example/about' }).includes('evil'));
});

test('тексты: разделители строк Тильды убираются', () => {
  assert.equal(cleanText('ясности ' + String.fromCharCode(0x2028) + '— школа'), 'ясности — школа');
  assert.equal(seoFields({}, inv.get('/about')).description, 'того, как');
  assert.equal(seoFields({ description: 'из модели' }, inv.get('/oferta')).description, 'из модели');
});

test('og: локальная картинка, без внешних адресов', () => {
  const media = { 'https://t/1.png': '/media/a.png' };
  assert.equal(localOgImage(inv.get('/'), {}, media), '/media/a.png');
  assert.equal(localOgImage(inv.get('/about'), {}, media), null);
  assert.equal(localOgImage(inv.get('/'), {}, media, () => false), null);
  const head = seoHead({ routePath: '/', page: {}, entry: inv.get('/'), production: true, mediaMap: media });
  assert.match(head, /og:image" content="https:\/\/sistemayasnosti\.com\/media\/a\.png"/);
  assert.match(head, /rel="canonical" href="https:\/\/sistemayasnosti\.com\/"/);
  assert.ok(!/tildacdn|http:\/\//.test(head));
});

test('robots: превью noindex, production индексируется, noindex страницы сильнее', () => {
  const html = '<head><meta name="robots" content="noindex,nofollow"></head>';
  assert.match(applyRobots(html, { production: true }), /index,follow/);
  assert.match(applyRobots(html, { production: true, noindex: true }), /noindex,nofollow/);
  assert.match(applyRobots(html, { production: false }), /noindex,nofollow/);
  assert.match(applyRobots('<head></head>', { production: false }), /noindex/);
  assert.equal(isProduction({ SITE_ENV: 'production' }), true);
  assert.equal(isProduction({}), false);
  assert.match(robotsTxt({ production: false }), /Disallow: \/\n/);
  assert.match(robotsTxt({ production: true }), /Sitemap: https:\/\/sistemayasnosti\.com\/sitemap\.xml/);
});

test('sitemap: нет служебных, дублей по canonical, неопубликованных и закрытых продаж', () => {
  const routes = [{ path: '/' }, { path: '/about' }, { path: '/audio-club-old-old' }, { path: '/header' }, { path: '/pred' }, { path: '/oferta' }];
  const paths = publicSitemapPaths(routes, inv, { excluded: ['/oferta'] });
  assert.deepEqual(paths, ['/', '/about']);
  const xml = sitemapXml(paths, inv);
  assert.match(xml, /<loc>https:\/\/sistemayasnosti\.com\/<\/loc>/);
  assert.ok(!/pred|header|<loc>http:/.test(xml));
});

test('h1: считается вне скриптов', () => {
  assert.equal(countH1('<h1>a</h1><script>"<h1>"</script>'), 1);
  assert.equal(countH1('<div></div>'), 0);
  assert.deepEqual(h1Report([{ path: '/a', html: '<h1 class=x>1</h1><h1>2</h1>' }]), [{ path: '/a', h1: 2, ok: false }]);
});
