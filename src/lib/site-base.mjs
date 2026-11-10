export function normalizeBase(raw) {
  const value = raw || '/';
  if (value === '/' || value === '') return '';
  const trimmed = value.endsWith('/') ? value.slice(0, -1) : value;
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export function siteBase() {
  const raw = import.meta.env && import.meta.env.BASE_URL;
  return normalizeBase(raw);
}

export function withBase(path, base = siteBase()) {
  if (!path || typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) return path;
  if (!base || path === base || path.startsWith(`${base}/`)) return path;
  return base + path;
}

export function stripBase(pathname, base = siteBase()) {
  let path = pathname || '/';
  if (base && (path === base || path.startsWith(`${base}/`))) path = path.slice(base.length) || '/';
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return path || '/';
}

export function prefixRootUrls(text, base = siteBase()) {
  if (text == null || text === '' || !base) return text;
  const apply = (path) => withBase(path, base);
  return String(text)
    .replace(/url\(\s*(['"]?)(\/[^)'"]+)/gi, (match, quote, path) => `url(${quote}${apply(path)}`)
    .replace(/\b(href|src|action)=(['"])(\/[^'"]*)/gi, (match, attr, quote, path) => `${attr}=${quote}${apply(path)}`);
}
