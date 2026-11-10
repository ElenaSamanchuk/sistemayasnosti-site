import {prefixRootUrls} from './site-base.mjs';

export function lazyImages(html) {
  const source = prefixRootUrls(html || '') || '';
  if (!source || !/<img\b/i.test(source)) return source;
  return source.replace(/<img\b([^>]*?)\/?>/gi, (full, attrs) => {
    if (/\bloading\s*=/i.test(attrs)) return full;
    const body = attrs.replace(/\s*\/\s*$/, '');
    const decoding = /\bdecoding\s*=/i.test(body) ? '' : ' decoding="async"';
    return `<img${body}${decoding} loading="lazy">`;
  });
}
