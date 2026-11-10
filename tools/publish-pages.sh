#!/bin/zsh
# Выкладка превью на GitHub Pages одной командой, без ИИ. Боевой сайт, DNS и VM не затрагивает.
#   zsh tools/publish-pages.sh --dry-run "описание"   # собрать и показать, какие файлы изменятся
#   zsh tools/publish-pages.sh "описание"             # собрать, закоммитить, отправить
# Собирает во временной копии, поэтому локальный dist и идущие проверки не трогает.
set -euo pipefail

DRY=0
if [[ "${1:-}" == "--dry-run" ]]; then DRY=1; shift; fi
MESSAGE="${1:-Обновление превью}"
ROOT="${0:A:h:h}"
REPO="https://github.com/ElenaSamanchuk/sistemayasnosti-site.git"
PAGES_URL="https://elenasamanchuk.github.io/sistemayasnosti-site/"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/sya-publish.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

echo "1/4 Копия проекта и сборка с базой Pages"
rsync -a --exclude node_modules --exclude dist --exclude .ssr --exclude docs/screens --exclude sources/live/2026-11-09/assets "$ROOT/" "$WORK/build/"
mkdir -p "$WORK/build/sources/live/2026-11-09"
ln -s "$ROOT/node_modules" "$WORK/build/node_modules"
(cd "$WORK/build" && SITE_BASE=/sistemayasnosti-site/ nice npm run --silent build:site)
for f in index.html clarity/index.html mini/index.html 404.html; do
  [[ -s "$WORK/build/dist/$f" ]] || { echo "ОШИБКА: в сборке нет $f" >&2; exit 1; }
done

echo "2/4 Клон репозитория Pages"
git clone --quiet --depth 1 --branch main "$REPO" "$WORK/pages"

echo "3/4 Сравнение"
rsync -a --delete --exclude .git --exclude .github --exclude .nojekyll "$WORK/build/dist/" "$WORK/pages/"
cd "$WORK/pages"
git add -A
git diff --cached --stat | tail -25
if git diff --cached --quiet; then echo "Изменений нет, выкладывать нечего"; exit 0; fi
DELETED=$(git diff --cached --name-status | grep -c '^D' || true)
echo "Удаляемых файлов: $DELETED"
if (( DRY )); then echo "Проверка без изменений: коммита и отправки не было"; exit 0; fi

echo "4/4 Коммит и отправка"
git -c user.name="Elena Samanchuk" -c user.email="elenasamanchuk@gmail.com" commit --quiet \
  -m "$MESSAGE" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git -c credential.helper= -c credential.helper='!gh auth git-credential' push --quiet origin main
echo "Отправлено: $(git rev-parse --short HEAD)"
echo "Адрес: $PAGES_URL"
