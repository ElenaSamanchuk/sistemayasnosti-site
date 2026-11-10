#!/usr/bin/env node
// Сборка локальной копии выпуска аудиоклуба из блоков Тильды (T123): CSS, JS и картинки/аудио.
// Только строки и копирование файлов: код из блоков НЕ выполняется.
//
// Пример (из корня проекта):
//   node src/embeds/audio-club/build-month.mjs --name 2026-11 \
//     --css sources/live/2026-11-09/t123/audio-club__rec5543946903.html \
//     --js  sources/live/2026-11-09/t123/audio-club__rec5543947103.html \
//     --assets ~/Projects/sistema-yasnosti-club/assets
//
// Результат: public/embeds/audio-club/<name>/club.css, club.js, build.json
//            public/embeds/audio-club/shared/assets/{img,audio}/… (общие для всех выпусков)
// Нужны те же блоки, что вставляют в Тильду: `tilda/1-css.html` и `tilda/3-js.html` из репозитория клуба
// или файлы снимка `sources/live/<дата>/t123/audio-club*__rec…`.
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, join, basename } from 'node:path'

const OLD_BASE = 'https://cdn.jsdelivr.net/gh/ElenaSamanchuk/sistema-yasnosti-club@main/'
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]])
    return acc
  }, [])
)
const fail = (msg) => {
  console.error('ОШИБКА: ' + msg)
  process.exit(1)
}
for (const k of ['name', 'css', 'js', 'assets']) if (!args[k]) fail(`нет параметра --${k}`)
if (!/^[\w.-]+$/.test(args.name)) fail('--name: только буквы, цифры, точка, дефис')

const outRoot = resolve(args.out || 'public/embeds/audio-club')
const sharedBase = args.base || '/embeds/audio-club/shared/'
const read = (p) => readFileSync(resolve(p.replace(/^~/, process.env.HOME || '~')), 'utf8')
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16)

function inner(html) {
  const a = html.indexOf('<!-- nominify begin -->')
  const b = html.indexOf('<!-- nominify end -->')
  if (a < 0 || b < a) fail('в файле нет меток nominify begin/end, это не блок T123')
  return html.slice(a + '<!-- nominify begin -->'.length, b)
}

const cssHtml = inner(read(args.css))
const jsHtml = inner(read(args.js))

const styles = [...cssHtml.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1])
if (!styles.length) fail('в CSS-блоке нет <style>')
let css = styles.join('\n')

const scripts = [...jsHtml.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1])
if (scripts.length !== 1) fail(`в JS-блоке ожидался один <script>, найдено ${scripts.length}`)
let js = scripts[0]

// Шрифты Forum/Inter и preload-ссылки в компонент не берём: шрифты подключает общий слой сайта.
const dropped = [...cssHtml.matchAll(/<link[^>]+>/g)].map((m) => m[0])

// Какие файлы из репозитория клуба нужны (по именам в CSS, JS и preload-ссылках).
const refs = new Set()
for (const text of [css, js, cssHtml]) {
  for (const m of text.matchAll(/assets\/((?:img|audio)\/[\w.-]+\.(?:webp|png|jpe?g|mp3|svg))/g)) refs.add(m[1])
}

js = js.split(OLD_BASE).join(sharedBase)
css = css.split(OLD_BASE).join(sharedBase)
// Навигация внутри выпуска должна вести в текущую сборку, включая превью в подпапке.
js = js.replace(/"https?:\/\/(?:www\.)?sistemayasnosti\.com(\/[^"\\]*)?"/g,
  (_, route) => `((window.SYA_SITE_BASE||"/")+${JSON.stringify((route || '/').slice(1))})`)

const leftovers = [css, js].filter((t) => /jsdelivr/i.test(t)).length
if (leftovers) fail('в результате остались ссылки на jsDelivr: другой формат блока, проверить вручную')

const assetsDir = resolve(args.assets.replace(/^~/, process.env.HOME || '~'))
const copied = []
const missing = []
for (const rel of refs) {
  const src = join(assetsDir, rel)
  const dst = join(outRoot, 'shared', 'assets', rel)
  if (!existsSync(src)) {
    if (existsSync(dst)) continue // уже скопирован раньше
    missing.push(rel)
    continue
  }
  mkdirSync(join(dst, '..'), { recursive: true })
  copyFileSync(src, dst)
  copied.push(`${rel} (${Math.round(statSync(dst).size / 1024)} КБ)`)
}
if (missing.length) fail('нет файлов в --assets и в shared: ' + missing.join(', '))

const dir = join(outRoot, args.name)
mkdirSync(dir, { recursive: true })
writeFileSync(join(dir, 'club.css'), css)
writeFileSync(join(dir, 'club.js'), js)
writeFileSync(
  join(dir, 'build.json'),
  JSON.stringify(
    {
      name: args.name,
      cssSource: basename(args.css),
      jsSource: basename(args.js),
      cssSha: sha(css),
      jsSha: sha(js),
      assets: [...refs].sort(),
      droppedLinks: dropped,
      assetBase: sharedBase,
    },
    null,
    2
  ) + '\n'
)

console.log(`Готово: ${join(dir, 'club.css')} (${css.length} б), club.js (${js.length} б)`)
console.log(`Файлов скопировано: ${copied.length}`)
for (const c of copied) console.log('  ' + c)
const hosts = new Set([...(css + js).matchAll(/https?:\/\/([\w.-]+)/g)].map((m) => m[1]))
console.log('Внешние адреса, оставшиеся в коде (ссылки/метки, проверить глазами):', [...hosts].join(', '))
