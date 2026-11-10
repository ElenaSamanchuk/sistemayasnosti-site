# Система ясности: исходники сайта

Перенос sistemayasnosti.com с Тильды на Vue 3 + Vite. Статическая сборка, 12 страниц.

- Превью: https://elenasamanchuk.github.io/sistemayasnosti-site/
- Готовые архивы для сервера: раздел Releases этого репозитория, теги `vm-preview-*`
- Ветка `main` содержит только собранную статику для GitHub Pages, ветка `source` содержит исходники

## Запуск

Нужен Node.js 20 или новее.

```bash
npm ci
npm run dev
```

## Сборка

```bash
npm run build:site
npm test
```

Результат в `dist/`. По умолчанию сборка закрыта от индексации. Боевая сборка: `SITE_ENV=production npm run build:site`. Подробности в `deploy/README.md`.

## Где что лежит

- `public/content/*.json` и `*.css`: содержимое страниц
- `public/media`: картинки и видео
- `src/components`: отрисовка блоков, меню, подвал
- `src/embeds`: виджеты и интерактив
- `src/style.css`: общие правки
- `src/block-spacing.css`: создаётся командой `node tools/block-spacing.mjs`, вручную не менять

## Важно

- `npm run normalize` не запускать: команда пересоберёт содержимое из снимка Тильды и сотрёт ручные правки и оптимизацию картинок.
- Формы показывают посетителю успех, но заявки пока никуда не отправляются: получатель не подключён.
- Скриптам проверки в `tools` нужен Playwright: `npm i -D playwright`.
