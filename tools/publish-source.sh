#!/bin/zsh
# Исходники для разработчика в открытую ветку source. Без ИИ. Ветку main (превью Pages), боевой сайт, DNS и VM не затрагивает.
#   zsh tools/publish-source.sh --dry-run "описание"   # собрать набор, проверить сборку и тесты с нуля, без отправки
#   zsh tools/publish-source.sh "описание"             # то же и отправить
# Передаётся всё, кроме проверочных скринов docs/screens (429 МБ, это не часть сайта). Решение Елены 10.11: разработчику передаём весь сайт.
set -euo pipefail

DRY=0
if [[ "${1:-}" == "--dry-run" ]]; then DRY=1; shift; fi
MESSAGE="${1:-Обновление исходников}"
ROOT="${0:A:h:h}"
REPO="https://github.com/ElenaSamanchuk/sistemayasnosti-site.git"
BRANCH=source
WORK="$(mktemp -d "${TMPDIR:-/tmp}/sya-source.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

echo "1/5 Набор файлов"
rsync -a --exclude .git --exclude node_modules --exclude dist --exclude .ssr --exclude .DS_Store --exclude '.env' --exclude '.env.*' \
  --exclude '/docs/screens' --exclude '/.lazycheck*' \
  "$ROOT/" "$WORK/tree/"
find "$WORK/tree/tools" -type f -name '*.mjs' -exec perl -pi -e "s{/Users/[^'\"]*/node_modules/playwright/index\.mjs}{playwright}g" {} +
grep -rIl --exclude=publish-source.sh '/Users/elena' "$WORK/tree" | while read -r f; do perl -pi -e 's{/Users/elena/Projects/sistemayasnosti-site/?}{./}g; s{/Users/elena}{~}g' "$f"; done

echo "2/5 Проверка на секреты и личные пути"
HITS=$(grep -rIlE --exclude=publish-source.sh "/Users/elena|PRIVATE KEY|\bghp_[A-Za-z0-9]{36}\b|\bsk-[A-Za-z0-9]{32,}\b|\bAKIA[0-9A-Z]{16}\b|\bxox[bp]-[0-9]" "$WORK/tree" || true)
[[ -z "$HITS" ]] || { echo "ОШИБКА: найдено недопустимое:" >&2; echo "$HITS" >&2; exit 1; }
BIG=$(find "$WORK/tree" -type f -size +95M)
[[ -z "$BIG" ]] || { echo "ОШИБКА: файлы больше лимита GitHub: $BIG" >&2; exit 1; }

echo "3/5 Установка, сборка и тесты с нуля"
cp -R "$WORK/tree" "$WORK/check"
(cd "$WORK/check" && nice npm ci --silent --no-audit --no-fund && nice npm run --silent build:site | tail -1 && nice npm test --silent 2>&1 | grep -E '^ℹ (pass|fail)')
(cd "$WORK/check" && nice node --test tests/*.test.mjs >/dev/null 2>&1) || { echo "ОШИБКА: тесты не прошли" >&2; exit 1; }
[[ -s "$WORK/check/dist/index.html" && -s "$WORK/check/dist/clarity/index.html" ]] || { echo "ОШИБКА: сборка неполная" >&2; exit 1; }

echo "4/5 Сравнение с веткой"
if git ls-remote --exit-code --heads "$REPO" "$BRANCH" >/dev/null; then
  git clone --quiet --depth 1 --branch "$BRANCH" "$REPO" "$WORK/repo"
else
  git init --quiet -b "$BRANCH" "$WORK/repo"
  git -C "$WORK/repo" remote add origin "$REPO"
fi
rsync -a --delete --exclude .git "$WORK/tree/" "$WORK/repo/"
cd "$WORK/repo"
git add -A
git diff --cached --quiet && [[ -n "$(git log -1 --oneline 2>/dev/null)" ]] && { echo "Изменений нет, отправлять нечего"; exit 0; }
echo "Файлов в ветке: $(git ls-files | wc -l | tr -d ' '), размер: $(du -sh --exclude=.git . 2>/dev/null | cut -f1 || true)"
git ls-files | cut -d/ -f1 | sort | uniq -c
if (( DRY )); then echo "Проверка без изменений: коммита и отправки не было"; exit 0; fi

echo "5/5 Коммит и отправка"
git -c user.name="Elena Samanchuk" -c user.email="elenasamanchuk@gmail.com" commit --quiet \
  -m "$MESSAGE" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git -c credential.helper= -c credential.helper='!gh auth git-credential' push --quiet origin "$BRANCH"
echo "Отправлено: $(git rev-parse --short HEAD)"
echo "Адрес: https://github.com/ElenaSamanchuk/sistemayasnosti-site/tree/$BRANCH"
