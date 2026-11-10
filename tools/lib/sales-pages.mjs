// Переключатель страниц продаж (/pred, /pred_fl): открыты на время продаж, иначе временное перенаправление.
import fs from 'node:fs';

const PATH_RE = /^\/[A-Za-z0-9_\-/]*[A-Za-z0-9_-]$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{12,}$/;

export function loadSalesConfig(file) {
  if (!fs.existsSync(file)) return { pages: {} };
  return validateSalesConfig(JSON.parse(fs.readFileSync(file, 'utf8')));
}

export function validateSalesConfig(cfg) {
  if (!cfg || typeof cfg.pages !== 'object') throw new Error('sales-pages.json: нужен объект pages');
  for (const [p, v] of Object.entries(cfg.pages)) {
    if (!PATH_RE.test(p) || p.includes('//')) throw new Error(`sales-pages.json: недопустимый адрес ${p}`);
    if (typeof v.open !== 'boolean') throw new Error(`sales-pages.json: ${p}: open должен быть true или false`);
    if (typeof v.redirectTo !== 'string' || !PATH_RE.test(v.redirectTo) && v.redirectTo !== '/') throw new Error(`sales-pages.json: ${p}: redirectTo должен быть адресом сайта вида /clarity без ? и #`);
    if (v.redirectTo === p) throw new Error(`sales-pages.json: ${p}: перенаправление на самого себя`);
    if (cfg.pages[v.redirectTo] && !cfg.pages[v.redirectTo].open) throw new Error(`sales-pages.json: ${p}: цель ${v.redirectTo} тоже закрыта, получится цепочка`);
  }
  return cfg;
}

export function tokenUsable(token) { return typeof token === 'string' && TOKEN_RE.test(token); }

// routePaths: адреса, для которых есть исходник страницы (public/content/routes.json)
export function planSales(cfg, { routePaths, token }) {
  const have = new Set(routePaths);
  const warnings = [];
  const entries = Object.entries(cfg.pages).map(([path, v]) => {
    const hasSource = have.has(path);
    let mode = 'page';
    let previewPath = null;
    if (!hasSource) {
      mode = 'redirect';
      warnings.push(`${path}: исходника страницы нет, сделано перенаправление на ${v.redirectTo}${v.open ? ' (в конфиге open=true)' : ''}`);
    } else if (!v.open) {
      mode = 'redirect';
      if (tokenUsable(token)) previewPath = `${path}-preview-${token}`;
      else warnings.push(`${path}: закрыта, секретная ссылка не создана (нужна SALES_PREVIEW_TOKEN, 12+ символов: буквы, цифры, - и _)`);
    }
    return { path, open: v.open, redirectTo: v.redirectTo, hasSource, mode, previewPath };
  });
  return { entries, warnings };
}

const jsString = (s) => JSON.stringify(s).replace(/</g, '\\u003c');
const attr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// target уже с учётом SITE_BASE. Query и hash переносим скриптом; meta refresh — запасной вариант без query.
export function redirectHtml(target) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Переход на другую страницу</title><script>location.replace(${jsString(target)}+location.search+location.hash)</script><meta http-equiv="refresh" content="0;url=${attr(target)}"></head><body><p><a href="${attr(target)}">Перейти</a></p></body></html>\n`;
}

// Временное перенаправление 302 с query. Только для закрытых страниц; точное совпадение адреса, секретные ссылки не затрагиваются.
export function nginxSnippet(entries) {
  const closed = entries.filter((e) => e.mode === 'redirect');
  const head = '# Сгенерировано tools/build-site.mjs из sources/sales-pages.json. Не править руками.\n# Подключить внутри server { include .../nginx-sales-redirects.conf; }\n';
  if (!closed.length) return `${head}# Все страницы продаж открыты: перенаправлений нет.\n`;
  const rules = closed.flatMap((e) => [e.path, `${e.path}/`].map((p) => `location = ${p} {\n    absolute_redirect off;\n    return 302 ${e.redirectTo}$is_args$args;\n}`));
  return `${head}${rules.join('\n')}\n`;
}
