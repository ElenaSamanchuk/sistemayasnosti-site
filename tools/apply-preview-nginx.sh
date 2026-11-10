#!/usr/bin/env bash
# Применяет deploy/nginx-preview.conf на превью: сжатие и кэш только сайта preview.sistemayasnosti.com, без ИИ.
#   bash tools/apply-preview-nginx.sh --dry-run   # соединение, текущее состояние и разница, без изменений
#   bash tools/apply-preview-nginx.sh             # копия для отката, nginx -t, мягкая перезагрузка, проверка
# Другие конфиги не трогает. При любой ошибке проверки сам возвращает прошлый файл.
# Новые SSH-соединения к этой VM обрываются через раз; после серии отказов подождать 5–10 минут.
set -uo pipefail

DRY=0; [[ "${1:-}" == "--dry-run" ]] && DRY=1
SRV=ubuntu@212.233.93.50
IP=212.233.93.50
D=https://preview.sistemayasnosti.com
CONF=/etc/nginx/sites-available/sistemayasnosti-preview
BACKDIR=/var/www/sistemayasnosti-preview
LOCAL=deploy/nginx-preview.conf
KEY="${KEY:-$HOME/Downloads/ubuntu-STD3-8-16-200GB-M9I9y4Dw.pem}"
OTHER='/etc/nginx/nginx.conf /etc/nginx/sites-available/kochfit /etc/nginx/sites-available/medvediva'
MEDIA=/media/78db92dafda00cf551870c18.mp4
NEIGHBOURS=(kochfit.ru preview.medvediva.ru medvediva.ru medvediva.kg medvediva.online preview.kineziofitness.online preview.popovichfit.ru)
ROUTES=(/ /clarity/ /about /about/ /mini/ /taplink/ /audio-club/ /audio-club-old/ /audio-club-old-old/ /oferta/ /privacy/ /consent/ /cookie/ /pred/ /pred_fl/)

[[ -s "$LOCAL" && -f "$KEY" ]] || { echo "ОШИБКА: нет $LOCAL или файла ключа" >&2; exit 2; }
OPTS=(-i "$KEY" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=25 -o ServerAliveInterval=15 -o "ControlPath=/tmp/sya-%C")
trap 'ssh "${OPTS[@]}" -O exit "$SRV" >/dev/null 2>&1 || true' EXIT
remote() { ssh "${OPTS[@]}" -n "$SRV" "$1"; }
neigh() { local h; for h in "${NEIGHBOURS[@]}"; do echo "$h $(curl -sS -m 20 -o /dev/null -w '%{http_code}' --resolve "$h:443:$IP" "https://$h/" 2>/dev/null || true)"; done; }
head_of() { curl -sS -m 25 -o /dev/null -D - -H 'Accept-Encoding: gzip' "$D$1" | tr -d '\r'; }

ok=0
for i in 1 2 3 4 5 6; do
  if ssh "${OPTS[@]}" -O check "$SRV" >/dev/null 2>&1; then ok=1; break; fi
  ssh "${OPTS[@]}" -o ControlMaster=yes -o ControlPersist=20m -fN "$SRV" 2>/dev/null || true
  if ssh "${OPTS[@]}" -O check "$SRV" >/dev/null 2>&1; then ok=1; echo "Соединение открыто, попытка $i"; break; fi
  echo "Попытка $i не удалась, повтор через 40 с"; sleep 40
done
[[ $ok == 1 ]] || { echo "ОШИБКА: SSH не открылся, на сервере ничего не менялось. Подождать 5–10 минут" >&2; exit 255; }

CURRENT=$(remote "sudo cat $CONF")
if [[ "$CURRENT" == "$(cat "$LOCAL")" ]]; then echo "Настройки уже применены"; [[ $DRY == 1 ]] && exit 0; fi
if (( DRY )); then diff <(echo "$CURRENT") "$LOCAL" | head -60; echo "Проверка без изменений"; exit 0; fi

TS=$(date +%Y%m%d-%H%M%S); BACK="$BACKDIR/nginx-backup-$TS.conf"
N1=$(remote "sudo sha256sum $OTHER"); B=$(neigh)
scp -q "${OPTS[@]}" "$LOCAL" "$SRV:/tmp/sya-nginx-after.conf" || { echo "ОШИБКА: файл не загружен, ничего не менялось" >&2; exit 1; }
R=$(remote "sudo cp -p $CONF $BACK; sudo install -m 644 -o root -g root /tmp/sya-nginx-after.conf $CONF; rm -f /tmp/sya-nginx-after.conf; if ! sudo nginx -t 2>&1; then sudo cp -p $BACK $CONF; echo TEST-FAILED; exit 0; fi; sudo systemctl reload nginx && echo RELOADED" 2>&1)
echo "$R" | tail -3
grep -q RELOADED <<<"$R" || { echo "ОШИБКА: nginx -t не прошёл, файл возвращён, nginx не перезагружался" >&2; exit 1; }
sleep 3

fail=0
need() { grep -qi "$3" <<<"$2" || { echo "ОШИБКА $1: нет «$3»"; fail=1; }; }
HTML=$(curl -s "$D/"); CSS=$(grep -o '/assets/[^"]*\.css' <<<"$HTML" | head -1); JS=$(grep -o '/assets/[^"]*\.js' <<<"$HTML" | head -1)
H=$(head_of "$CSS"); need CSS "$H" 'content-encoding: gzip'; need CSS "$H" 'immutable'; need CSS "$H" 'x-robots-tag: noindex'
H=$(head_of "$JS"); need JS "$H" 'content-encoding: gzip'
H=$(head_of /content/routes.json); need JSON "$H" 'content-encoding: gzip'; need JSON "$H" 'no-cache'
H=$(head_of /); need HTML "$H" 'no-cache'; need HTML "$H" 'x-robots-tag: noindex'; need HTML "$H" 'content-encoding: gzip'
H=$(head_of "$MEDIA"); need Видео "$H" 'max-age=2592000'
code=$(curl -sS -m 25 -o /dev/null -w '%{http_code}' -H 'Range: bytes=0-1' "$D$MEDIA"); [[ $code == 206 ]] || { echo "ОШИБКА Range: $code"; fail=1; }
code=$(curl -sS -m 20 -o /dev/null -w '%{http_code}' "$D/no-such-page-check/"); [[ $code == 404 ]] || { echo "ОШИБКА 404: $code"; fail=1; }
for p in "${ROUTES[@]}"; do code=$(curl -sS -m 25 -o /dev/null -w '%{http_code}' "$D$p"); [[ $code == 200 ]] || { echo "ОШИБКА $p: $code"; fail=1; }; done
A=$(neigh); [[ "$A" == "$B" ]] || { echo "ОШИБКА: ответы соседей изменились"; echo "$A"; fail=1; }
N2=$(remote "sudo sha256sum $OTHER"); [[ "$N1" == "$N2" ]] || { echo "ОШИБКА: другие конфиги изменились"; fail=1; }

if (( fail )); then
  remote "sudo cp -p $BACK $CONF && sudo nginx -t 2>&1 | tail -1 && sudo systemctl reload nginx && echo ROLLED-BACK" | tail -2
  echo "Проверка не пройдена, настройки возвращены" >&2; exit 1
fi
echo "Соседи: $(grep -c ' 200$' <<<"$A") из ${#NEIGHBOURS[@]} отвечают 200, другие конфиги без изменений"
for u in "$CSS" "$JS"; do echo "$u: сжато $(curl -s -H 'Accept-Encoding: gzip' "$D$u" | wc -c | tr -d ' ') байт, без сжатия $(curl -s "$D$u" | wc -c | tr -d ' ')"; done
echo "Готово. Копия для отката: $BACK"
