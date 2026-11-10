#!/bin/zsh
# Архив превью для разработчика одной командой, без ИИ. Боевой сайт, DNS и VM не затрагивает.
#   zsh tools/publish-vm-archive.sh --dry-run vm-preview-ГГГГММДД-N "что нового"   # собрать и проверить, без публикации
#   zsh tools/publish-vm-archive.sh vm-preview-ГГГГММДД-N "что нового"             # собрать, проверить, выпустить релиз
# Сборка от корня / в режиме noindex, во временной копии: локальный dist и идущие проверки не трогает.
set -euo pipefail

DRY=0
if [[ "${1:-}" == "--dry-run" ]]; then DRY=1; shift; fi
TAG="${1:?Нужен тег вида vm-preview-20261110-4}"
NOTES="${2:?Нужно описание отличий}"
[[ "$TAG" == vm-preview-* ]] || { echo "ОШИБКА: тег должен начинаться с vm-preview-" >&2; exit 1; }
ROOT="${0:A:h:h}"
REPO="ElenaSamanchuk/sistemayasnosti-site"
NAME="sistemayasnosti-$TAG.tar.gz"
if gh release view "$TAG" -R "$REPO" >/dev/null 2>&1; then echo "ОШИБКА: релиз $TAG уже есть, повторно не создаю" >&2; exit 1; fi
WORK="$(mktemp -d "${TMPDIR:-/tmp}/sya-archive.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

echo "1/4 Сборка от корня, режим превью"
rsync -a --exclude node_modules --exclude dist --exclude .ssr --exclude docs/screens --exclude sources/live/2026-11-09/assets "$ROOT/" "$WORK/build/"
mkdir -p "$WORK/build/sources/live/2026-11-09"
ln -s "$ROOT/node_modules" "$WORK/build/node_modules"
(cd "$WORK/build" && env -u SITE_BASE -u SITE_ENV nice npm run --silent build:site | tail -1)
DIST="$WORK/build/dist"

echo "2/4 Проверка сборки"
for f in index.html clarity/index.html mini/index.html about/index.html taplink/index.html 404.html robots.txt; do
  [[ -s "$DIST/$f" ]] || { echo "ОШИБКА: в сборке нет $f" >&2; exit 1; }
done
grep -qi 'name="robots" content="noindex' "$DIST/index.html" || { echo "ОШИБКА: на главной нет noindex" >&2; exit 1; }
if grep -rl 'sistemayasnosti-site/' "$DIST" --include='*.html' | grep -q .; then echo "ОШИБКА: в HTML остался путь Pages, сборка не от корня" >&2; exit 1; fi

echo "3/4 Архив"
COPYFILE_DISABLE=1 tar --no-xattrs -czf "$WORK/$NAME" -C "$DIST" .
(cd "$WORK" && shasum -a 256 "$NAME" > "$NAME.sha256" && shasum -a 256 -c "$NAME.sha256" >/dev/null)
SIZE=$(stat -f %z "$WORK/$NAME"); SHA=$(cut -d' ' -f1 "$WORK/$NAME.sha256")
echo "Файлов: $(tar tzf "$WORK/$NAME" | grep -vc '/$'), размер: $SIZE, SHA-256: $SHA"
if (( DRY )); then
  tar tzf "$WORK/$NAME" | sort > "${TMPDIR:-/tmp}/sya-archive-list.txt"
  echo "Проверка без изменений: релиз не создан. Список файлов: ${TMPDIR:-/tmp}/sya-archive-list.txt"
  exit 0
fi

echo "4/4 Релиз"
gh release create "$TAG" -R "$REPO" --title "Архив для VM, $TAG" --notes "Сборка от корня /, индексация закрыта. $NOTES" "$WORK/$NAME" "$WORK/$NAME.sha256" >/dev/null
REMOTE=$(gh release view "$TAG" -R "$REPO" --json assets -q ".assets[] | select(.name==\"$NAME\") | .size")
[[ "$REMOTE" == "$SIZE" ]] || { echo "ОШИБКА: размер на GitHub $REMOTE, локально $SIZE" >&2; exit 1; }
perl -pi -e "s/vm-preview-[0-9]{8}(-[0-9]+)?/$TAG/g" "$ROOT/deploy/ADMIN-PREVIEW.md"
echo "Готово: https://github.com/$REPO/releases/tag/$TAG"
echo "Размер $SIZE совпал с GitHub, SHA-256 $SHA"
