// Стык с реестром встроенных блоков (src/embeds/registry.mjs). Реестра может не быть: тогда блоки просто пропускаются,
// сборка перечисляет их в docs/static-build.json.
const modules = import.meta.glob('../embeds/registry.mjs', { eager: true });
export const registry = Object.values(modules)[0]?.embeds || {};

// Записи kind:'global' здесь не запускаются (интеграции подключаются отдельным шагом), kind:'skip' не рисуются.
// Один компонент на страницу: одинаковые загрузчик и props монтируем один раз (правило реестра).
export function resolveEmbeds(blocks) {
  const seen = new Set();
  const result = [];
  for (const block of blocks || []) {
    if (block.kind !== 'embed') continue;
    const entry = registry[block.rec];
    if (entry?.kind !== 'component') continue;
    const key = String(entry.load) + JSON.stringify(entry.props || {});
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ rec: block.rec, zone: block.zone, entry });
  }
  return result;
}
