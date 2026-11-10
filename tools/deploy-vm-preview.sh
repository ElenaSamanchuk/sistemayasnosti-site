#!/usr/bin/env bash
# Выкладка превью на общую VM одной командой, без ИИ: https://preview.sistemayasnosti.com
#   bash tools/deploy-vm-preview.sh --dry-run vm-preview-ГГГГММДД-N   # проверить архив, доступ и соседей, без изменений
#   bash tools/deploy-vm-preview.sh vm-preview-ГГГГММДД-N             # выложить релиз и переключить current
# Берёт готовый архив из релиза GitHub. Меняет только /var/www/sistemayasnosti-preview: новый каталог релиза и ссылку current.
# nginx не перезагружает, конфиги, сертификаты и соседние сайты не трогает. Старые релизы не удаляет.
# Откат вручную: перевести ссылку current на прошлый релиз из releases/. При провале проверок откат выполняется сам.
set -euo pipefail

DRY=0
if [[ "${1:-}" == "--dry-run" ]]; then DRY=1; shift; fi
TAG="${1:?Нужен тег вида vm-preview-20261110-6}"
[[ "$TAG" =~ ^vm-preview-[0-9]{8}(-[0-9]+)?$ ]] || { echo "ОШИБКА: неверный тег $TAG" >&2; exit 2; }

REPO=ElenaSamanchuk/sistemayasnosti-site
SERVER=ubuntu@212.233.93.50
IP=212.233.93.50
DOMAIN=preview.sistemayasnosti.com
BASE=/var/www/sistemayasnosti-preview
KEY="${KEY:-$HOME/Downloads/ubuntu-STD3-8-16-200GB-M9I9y4Dw.pem}"
NAME="sistemayasnosti-$TAG.tar.gz"
NEIGHBOURS=(kochfit.ru preview.medvediva.ru medvediva.ru medvediva.kg medvediva.online preview.kineziofitness.online preview.popovichfit.ru)
ROUTES=(/ /clarity/ /mini/ /about/ /audio-club/ /audio-club-old/ /audio-club-old-old/ /taplink/ /oferta/ /privacy/ /consent/ /cookie/ /pred/ /pred_fl/)

[[ -f "$KEY" ]] || { echo "ОШИБКА: нет файла ключа" >&2; exit 2; }
# Новые соединения к этой VM обрываются через раз: одно общее соединение на всю выкладку, открытие с повторами
OPTS=(-i "$KEY" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=25 -o ServerAliveInterval=15 -o "ControlPath=/tmp/sya-%C")
WORK="$(mktemp -d "${TMPDIR:-/tmp}/sya-vm.XXXXXX")"
cleanup() { rm -rf "$WORK"; ssh "${OPTS[@]}" -O exit "$SERVER" >/dev/null 2>&1 || true; }
trap cleanup EXIT
remote() { ssh "${OPTS[@]}" -n "$SERVER" "$1"; }

status_of() { curl -sS -m 20 -o /dev/null -w '%{http_code}' --resolve "$1:443:$IP" "https://$1/" 2>/dev/null || true; }
neighbours() { local h; for h in "${NEIGHBOURS[@]}"; do echo "$h $(status_of "$h")"; done; }

echo "1/6 Архив $TAG"
gh release download "$TAG" -R "$REPO" -D "$WORK" -p "$NAME" -p "$NAME.sha256"
(cd "$WORK" && shasum -a 256 -c "$NAME.sha256" >/dev/null)
SHA=$(cut -d' ' -f1 "$WORK/$NAME.sha256")
mkdir "$WORK/x" && tar xzf "$WORK/$NAME" -C "$WORK/x"
[[ -s "$WORK/x/index.html" && -s "$WORK/x/clarity/index.html" ]] || { echo "ОШИБКА: архив неполный" >&2; exit 1; }
FILES=$(find "$WORK/x" -type f | wc -l | tr -d ' ')
INDEX_SHA=$(shasum -a 256 "$WORK/x/index.html" | cut -d' ' -f1)
echo "Файлов: $FILES, SHA-256 архива: $SHA"

echo "2/6 Соединение"
ok=0
for i in 1 2 3 4 5 6 7 8; do
  if ssh "${OPTS[@]}" -O check "$SERVER" >/dev/null 2>&1; then ok=1; break; fi
  ssh "${OPTS[@]}" -o ControlMaster=yes -o ControlPersist=20m -fN "$SERVER" 2>/dev/null || true
  if ssh "${OPTS[@]}" -O check "$SERVER" >/dev/null 2>&1; then ok=1; echo "Соединение открыто, попытка $i"; break; fi
  echo "Попытка $i не удалась, повтор через 20 с"; sleep 20
done
[[ $ok == 1 ]] || { echo "ОШИБКА: SSH не открылся. Не повторять сразу, подождать 5–10 минут, проверить VPN" >&2; exit 255; }

echo "3/6 Состояние до выкладки"
BEFORE_REL=$(remote "readlink $BASE/current")
[[ "$BEFORE_REL" == releases/* ]] || { echo "ОШИБКА: current не ссылка на релиз: $BEFORE_REL" >&2; exit 1; }
CONF_BEFORE=$(remote 'sudo sha256sum /etc/nginx/sites-available/sistemayasnosti-preview /etc/nginx/nginx.conf /etc/nginx/sites-available/kochfit /etc/nginx/sites-available/medvediva')
NEIGH_BEFORE=$(neighbours)
echo "$NEIGH_BEFORE"
echo "Сейчас активен: $BEFORE_REL"
[[ "$BEFORE_REL" == "releases/$TAG" ]] && { echo "Этот релиз уже активен, выкладывать нечего"; exit 0; }
remote "test ! -e $BASE/releases/$TAG" || { echo "ОШИБКА: каталог releases/$TAG уже есть, но не активен. Разобраться вручную" >&2; exit 1; }
if (( DRY )); then echo "Проверка без изменений: на сервере ничего не менялось"; exit 0; fi

echo "4/6 Загрузка и распаковка в новый каталог"
scp -q "${OPTS[@]}" -l 24000 "$WORK/$NAME" "$SERVER:/tmp/$NAME"
remote "set -e; echo '$SHA  /tmp/$NAME' | sha256sum -c --quiet -; sudo mkdir $BASE/releases/$TAG; sudo tar xzf /tmp/$NAME --no-same-owner -C $BASE/releases/$TAG; sudo chown -R root:root $BASE/releases/$TAG; sudo chmod -R a+rX $BASE/releases/$TAG; rm -f /tmp/$NAME"
REMOTE_FILES=$(remote "sudo find $BASE/releases/$TAG -type f | wc -l")
[[ "$REMOTE_FILES" == "$FILES" ]] || { echo "ОШИБКА: на сервере файлов $REMOTE_FILES, в архиве $FILES. Ссылка current не менялась" >&2; exit 1; }

echo "5/6 Переключение ссылки current"
switch_to() { remote "cd $BASE && sudo ln -s '$1' current.new && sudo mv -T current.new current"; }
switch_to "releases/$TAG"

echo "6/6 Проверка"
fail=0
check_all() {
  local r code body
  for r in "${ROUTES[@]}"; do
    code=$(curl -sS -m 25 -o /dev/null -w '%{http_code}' "https://$DOMAIN$r" || true)
    [[ "$code" == 200 ]] || { echo "ОШИБКА: $r ответ $code"; fail=1; }
  done
  code=$(curl -sS -m 20 -o /dev/null -w '%{http_code}' "https://$DOMAIN/no-such-page-check/" || true)
  [[ "$code" == 404 ]] || { echo "ОШИБКА: неизвестный адрес ответил $code"; fail=1; }
  body=$(curl -sS -m 25 "https://$DOMAIN/" | shasum -a 256 | cut -d' ' -f1)
  [[ "$body" == "$INDEX_SHA" ]] || { echo "ОШИБКА: главная не совпала с архивом"; fail=1; }
  curl -sSI -m 20 "https://$DOMAIN/" | grep -qi '^x-robots-tag: noindex' || { echo "ОШИБКА: нет запрета индексации"; fail=1; }
  local media
  media=$(cd "$WORK/x" && find media -type f \( -name '*.mp4' -o -name '*.mp3' \) | head -1)
  if [[ -n "$media" ]]; then
    code=$(curl -sS -m 25 -o /dev/null -w '%{http_code}' -H 'Range: bytes=0-1' "https://$DOMAIN/$media" || true)
    [[ "$code" == 206 ]] || { echo "ОШИБКА: видео или аудио ответило $code вместо 206"; fail=1; }
  fi
  return 0
}
check_all
if (( fail )); then
  echo "Проверка не пройдена, возвращаю $BEFORE_REL" >&2
  switch_to "$BEFORE_REL"
  exit 1
fi

CONF_AFTER=$(remote 'sudo sha256sum /etc/nginx/sites-available/sistemayasnosti-preview /etc/nginx/nginx.conf /etc/nginx/sites-available/kochfit /etc/nginx/sites-available/medvediva')
[[ "$CONF_BEFORE" == "$CONF_AFTER" ]] || { echo "ОШИБКА: конфиги nginx изменились за время выкладки, разобраться" >&2; exit 1; }
NEIGH_AFTER=$(neighbours)
echo "Соседние сайты после выкладки:"
echo "$NEIGH_AFTER"
[[ "$NEIGH_BEFORE" == "$NEIGH_AFTER" ]] || { echo "ВНИМАНИЕ: ответы соседей изменились, сравнить с таблицей выше" >&2; exit 1; }
echo "Готово: https://$DOMAIN активен $TAG, прошлый релиз $BEFORE_REL сохранён для отката"
