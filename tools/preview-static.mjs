// Локальный просмотр собранной статики: только 127.0.0.1, только GET и HEAD, формы не принимает.
import http from 'node:http';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
export const PREVIEW_PORT = 4186;
const root = path.resolve('dist');
const mime = { '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.gif': 'image/gif', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg' };
function byteRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header);
  if (!match || (!match[1] && !match[2]) || !size) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start <= end ? { start, end } : null;
}
export function startPreview(port = PREVIEW_PORT) {
  const server = http.createServer(async (req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return; }
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
      let file = path.resolve(root, '.' + pathname); let status = 200;
      if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(400); res.end(); return; }
      let info = await fs.stat(file).catch(() => null);
      if (info?.isDirectory()) { file = path.join(file, 'index.html'); info = await fs.stat(file).catch(() => null); }
      if (!info?.isFile()) { file = path.join(root, '404.html'); info = await fs.stat(file); status = 404; }
      const headers = { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Content-Length': info.size, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' };
      let range;
      if (status === 200 && /^(audio|video)\//.test(headers['Content-Type'])) {
        headers['Accept-Ranges'] = 'bytes';
        const requested = req.headers.range;
        // Диапазон обслуживаем для GET. У превью нет валидатора, с которым мог бы совпасть If-Range.
        if (req.method === 'GET' && /^bytes=/i.test(requested || '') && !req.headers['if-range']) {
          range = byteRange(requested, info.size);
          if (!range) { res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); res.end(); return; }
          status = 206;
          headers['Content-Range'] = `bytes ${range.start}-${range.end}/${info.size}`;
          headers['Content-Length'] = range.end - range.start + 1;
        }
      }
      res.writeHead(status, headers);
      if (req.method === 'HEAD') { res.end(); return; }
      const stream = createReadStream(file, range);
      res.on('close', () => stream.destroy());
      stream.on('error', () => res.destroy());
      stream.pipe(res);
    } catch {
      if (res.headersSent) res.destroy();
      else { res.writeHead(400); res.end(); }
    }
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => resolve(server)); });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) { await startPreview(); console.log(`Статика: http://127.0.0.1:${PREVIEW_PORT}/ (локально, noindex, только GET/HEAD)`); }
