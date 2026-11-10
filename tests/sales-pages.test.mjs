import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSalesConfig, planSales, redirectHtml, nginxSnippet, tokenUsable } from '../tools/lib/sales-pages.mjs';
import { notFoundPage } from '../tools/lib/not-found.mjs';

const cfg = () => validateSalesConfig({ pages: { '/pred': { open: false, redirectTo: '/clarity' }, '/pred_fl': { open: false, redirectTo: '/clarity' } } });
const TOKEN = 'abcDEF123456xyz';

test('конфиг: проверки', () => {
  assert.throws(() => validateSalesConfig({ pages: { '/pred': { open: 'no', redirectTo: '/c' } } }), /open/);
  assert.throws(() => validateSalesConfig({ pages: { '/pred': { open: false, redirectTo: '/pred' } } }), /самого себя/);
  assert.throws(() => validateSalesConfig({ pages: { '/pred': { open: false, redirectTo: 'https://x.ru' } } }), /redirectTo/);
  assert.throws(() => validateSalesConfig({ pages: { '/pred': { open: false, redirectTo: '/clarity?a=1' } } }), /redirectTo/);
  assert.throws(() => validateSalesConfig({ pages: { '/../x': { open: false, redirectTo: '/c' } } }), /адрес/);
  assert.throws(() => validateSalesConfig({ pages: { '/a': { open: false, redirectTo: '/b' }, '/b': { open: false, redirectTo: '/c' } } }), /цепочка/);
});

test('нет исходников: перенаправление и предупреждение, без падения', () => {
  const { entries, warnings } = planSales(cfg(), { routePaths: ['/', '/clarity'], token: TOKEN });
  assert.deepEqual(entries.map((e) => [e.mode, e.previewPath, e.hasSource]), [['redirect', null, false], ['redirect', null, false]]);
  assert.equal(warnings.length, 2);
});

test('закрыто, исходник есть: перенаправление и секретный адрес', () => {
  const { entries, warnings } = planSales(cfg(), { routePaths: ['/pred', '/pred_fl'], token: TOKEN });
  assert.equal(entries[0].mode, 'redirect');
  assert.equal(entries[0].previewPath, `/pred-preview-${TOKEN}`);
  assert.equal(entries[1].previewPath, `/pred_fl-preview-${TOKEN}`);
  assert.equal(warnings.length, 0);
});

test('токен: нет или слабый, предупреждение не содержит токена', () => {
  const weak = 'short';
  const { entries, warnings } = planSales(cfg(), { routePaths: ['/pred'], token: weak });
  assert.equal(entries[0].previewPath, null);
  assert.ok(warnings.length >= 1 && !warnings.join().includes(weak));
  assert.equal(tokenUsable(undefined), false);
  assert.equal(tokenUsable(TOKEN), true);
});

test('открыто: страница на своём адресе; без исходника всё равно перенаправление', () => {
  const open = validateSalesConfig({ pages: { '/pred': { open: true, redirectTo: '/clarity' }, '/pred_fl': { open: true, redirectTo: '/clarity' } } });
  const { entries, warnings } = planSales(open, { routePaths: ['/pred'], token: '' });
  assert.equal(entries[0].mode, 'page');
  assert.equal(entries[1].mode, 'redirect');
  assert.equal(warnings.length, 1);
  assert.match(nginxSnippet([entries[0]]), /перенаправлений нет/);
});

test('страница-перенаправление: query, hash, noindex', () => {
  const html = redirectHtml('/clarity');
  assert.match(html, /location\.replace\("\/clarity"\+location\.search\+location\.hash\)/);
  assert.match(html, /http-equiv="refresh" content="0;url=\/clarity"/);
  assert.match(html, /noindex/);
});

test('nginx: 302 с query, точные адреса, без секретных ссылок', () => {
  const { entries } = planSales(cfg(), { routePaths: ['/pred'], token: TOKEN });
  const conf = nginxSnippet(entries);
  assert.match(conf, /location = \/pred \{[^}]*return 302 \/clarity\$is_args\$args;/);
  assert.match(conf, /location = \/pred\/ \{/);
  assert.match(conf, /location = \/pred_fl \{/);
  assert.ok(!conf.includes(TOKEN) && !conf.includes('preview'));
});

test('404: шапка и футер сохранены, один h1', () => {
  const base = { path: '/privacy', title: 'x', blocks: [{ kind: 'embed', rec: '1', zone: 'header' }, { kind: 'article', id: '2', html: 'doc' }, { kind: 'embed', rec: '3', zone: 'footer' }], shell: { menu: {} } };
  const p = notFoundPage(base);
  assert.deepEqual(p.blocks.map((b) => b.kind), ['embed', 'article', 'embed']);
  assert.equal(p.blocks[1].html.match(/<h1/g).length, 1);
  assert.match(p.blocks[1].html, /href="\/clarity"/);
  assert.equal(p.shell, base.shell);
});
