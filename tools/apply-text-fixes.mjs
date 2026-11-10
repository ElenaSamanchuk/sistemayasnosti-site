#!/usr/bin/env node
// Точечные правки текстов и ссылок поверх контента. Пересборка из снимка Тильды их стирает, поэтому они живут отдельно.
//   node tools/apply-text-fixes.mjs           применить sources/text-fixes.json
//   node tools/apply-text-fixes.mjs --check   только проверить; код 1, если остались неисправленные строки
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const check = process.argv.includes('--check');
const fixes = JSON.parse(readFileSync('sources/text-fixes.json', 'utf8'));
const content = readdirSync('public/content').filter((f) => f.endsWith('.json')).map((f) => join('public/content', f));
const club = readdirSync('public/embeds/audio-club', { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => join('public/embeds/audio-club', d.name, 'club.js')).filter(existsSync);
const files = [...content, ...club];
let left = 0, changed = 0;
for (const file of files) {
  const before = readFileSync(file, 'utf8');
  let text = before;
  for (const fix of fixes) {
    if (fix.only && !file.endsWith(fix.only)) continue;
    const re = new RegExp(fix.from, 'gu');
    const hits = text.match(re)?.length || 0;
    if (!hits) continue;
    if (check) { left += hits; console.log(`ОСТАЛОСЬ ${file}: ${fix.note} (${hits})`); continue; }
    text = text.replace(re, fix.to);
    changed += hits;
    console.log(`${file}: ${fix.note} (${hits})`);
  }
  if (!check && text !== before) writeFileSync(file, text);
}
if (check && left) { console.error(`Не применено правок: ${left}. Запустите node tools/apply-text-fixes.mjs`); process.exit(1); }
console.log(check ? 'Все правки на месте' : `Применено замен: ${changed}`);
