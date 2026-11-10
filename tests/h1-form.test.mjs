// Без браузера: карта h1 покрывает все страницы, статическая выдача содержит один h1, маска телефона по странам
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { byIso, parsePhone, phoneProblem, placeholderFor, countries } from '../src/lib/phone-countries.mjs';

const map = JSON.parse(fs.readFileSync('sources/h1-map.json', 'utf8'));
const routes = JSON.parse(fs.readFileSync('public/content/routes.json', 'utf8'));

test('h1-map: запись есть у каждой страницы, тип явный', () => {
  for (const r of routes) {
    const entry = map[r.path];
    assert.ok(entry, `нет записи для ${r.path}`);
    assert.equal(Object.keys(entry).length, 1);
    assert.ok(['node', 'article', 'embedded'].includes(Object.keys(entry)[0]));
  }
});

test('h1 в модели: Zero-узел помечен тегом, статья содержит один h1', () => {
  for (const r of routes) {
    const page = JSON.parse(fs.readFileSync(`public/content/${r.page}.json`, 'utf8'));
    const entry = map[r.path];
    if (entry.node) {
      const tagged = JSON.stringify(page.scenes).match(/"tag":"h1"/g) || [];
      assert.equal(tagged.length, 1, r.path);
    } else if (entry.article) {
      const html = page.blocks.filter((b) => b.kind === 'article').map((b) => b.html).join('');
      assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, r.path);
    } else assert.equal(page.h1Embedded, entry.embedded.text);
  }
});

test('телефон: Россия по умолчанию и прежний формат', () => {
  const ru = byIso(undefined);
  assert.equal(ru.iso, 'RU');
  assert.equal(placeholderFor(ru), '+7 (000) 000-00-00');
  assert.equal(parsePhone('9001234567', ru).text, '+7 (900) 123-45-67');
  assert.equal(parsePhone('89001234567', ru).text, '+7 (900) 123-45-67');
});

test('телефон: код страны определяется по «+», маска и проверка длины', () => {
  const ru = byIso('RU');
  const es = parsePhone('+34600123456', ru);
  assert.equal(es.country.iso, 'ES');
  assert.equal(es.text, '+34 600 12 34 56');
  assert.equal(phoneProblem(es.country, es.text), false);
  assert.equal(phoneProblem(es.country, '+34 600 12'), true);
  assert.equal(parsePhone('+', ru).text, '+');
  assert.equal(parsePhone('+7', ru).text, '+7');
});

test('телефон: страны без повторов ISO, у всех есть флаг и маска', () => {
  assert.equal(new Set(countries.map((c) => c.iso)).size, countries.length);
  for (const c of countries) { assert.match(c.flag, /^\p{Regional_Indicator}{2}$/u); assert.ok(c.max >= c.min && c.min > 5, c.iso); }
});
