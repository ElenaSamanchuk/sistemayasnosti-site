#!/usr/bin/env bash
# Проверка заголовков боевого домена. Только GET/HEAD через curl, ничего не меняет.
# Запуск: bash tools/check-production-headers.sh [домен]   (по умолчанию sistemayasnosti.com)
# Код выхода: 0 - всё в порядке, 1 - есть отказы, 2 - не хватает curl или домен недоступен.
set -u

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,4p' "$0"
  echo "Проверяет: http->https 301, www->без www 301, нет noindex на главной, gzip у CSS и JS,"
  echo "cache-control у ассета и HTML, X-Frame-Options, Range 206 на mp4."
  exit 0
fi

DOMAIN="${1:-sistemayasnosti.com}"
command -v curl >/dev/null 2>&1 || { echo "Нужен curl"; exit 2; }
CURL=(curl -sS --max-time 20)
FAILS=0
ok()   { echo "  ОК   $1"; }
fail() { echo "  ОТКАЗ $1"; FAILS=$((FAILS+1)); }

# Заголовок (в нижнем регистре значение) из текста заголовков: hdr "<текст>" имя
hdr() { printf '%s\n' "$1" | tr -d '\r' | awk -v k="$(printf '%s' "$2" | tr 'A-Z' 'a-z')" 'BEGIN{FS=": "} tolower($1)==k {sub(/^[^:]*: */,""); print tolower($0)}' | tail -1; }
status() { printf '%s\n' "$1" | tr -d '\r' | awk '/^HTTP/{s=$2} END{print s}'; }

echo "Проверка https://$DOMAIN"

echo "1. Переадресации"
H=$("${CURL[@]}" -I "http://$DOMAIN/about?x=1" 2>&1) || { echo "  Домен не отвечает: $H"; exit 2; }
loc=$(hdr "$H" location)
if [ "$(status "$H")" = "301" ] && [ "$loc" = "https://$DOMAIN/about?x=1" ]; then ok "http -> https 301 с сохранением пути и query"
else fail "http -> https: статус $(status "$H"), location '$loc' (ожидалось 301 на https://$DOMAIN/about?x=1)"; fi

H=$("${CURL[@]}" -I "https://www.$DOMAIN/about" 2>&1) || H=""
loc=$(hdr "$H" location)
if [ "$(status "$H")" = "301" ] && [ "$loc" = "https://$DOMAIN/about" ]; then ok "www -> без www 301"
else fail "www -> без www: статус '$(status "$H")', location '$loc' (ожидалось 301 на https://$DOMAIN/about)"; fi

echo "2. Главная"
HTML=$(mktemp)
trap 'rm -f "$HTML"' EXIT
H=$("${CURL[@]}" -D - -o "$HTML" "https://$DOMAIN/" 2>&1) || { echo "  Главная не открылась: $H"; exit 2; }
[ "$(status "$H")" = "200" ] && ok "главная 200" || fail "главная: статус $(status "$H")"
xr=$(hdr "$H" x-robots-tag)
case "$xr" in *noindex*) fail "X-Robots-Tag содержит noindex: '$xr' (это заголовок превью, на бою его быть не должно)";; *) ok "нет X-Robots-Tag noindex";; esac
if grep -qiE '<meta[^>]+name="robots"[^>]+noindex' "$HTML"; then fail "в HTML главной meta robots noindex (собрано без SITE_ENV=production?)"; else ok "в HTML нет meta robots noindex"; fi
xf=$(hdr "$H" x-frame-options)
[ "$xf" = "sameorigin" ] && ok "X-Frame-Options: SAMEORIGIN у HTML" || fail "X-Frame-Options у HTML: '${xf:-нет}'"
cc=$(hdr "$H" cache-control)
case "$cc" in *no-cache*) ok "HTML cache-control: $cc";; *) fail "HTML cache-control: '${cc:-нет}' (ожидалось no-cache)";; esac

echo "3. Ассеты (имена из HTML главной)"
CSS=$(grep -oE '/assets/[^"]+\.css' "$HTML" | head -1)
JS=$(grep -oE '/assets/[^"]+\.js' "$HTML" | head -1)
MP4=$(grep -oE '/media/[A-Za-z0-9._-]+\.mp4' "$HTML" | head -1)
for f in "$CSS" "$JS"; do
  if [ -z "$f" ]; then fail "в HTML главной не найден ассет ${f:-css/js} (проверьте, что отдан сайт, а не Тильда)"; continue; fi
  A=$("${CURL[@]}" -D - -o /dev/null -H 'Accept-Encoding: gzip' "https://$DOMAIN$f" 2>&1) || A=""
  [ "$(status "$A")" = "200" ] || { fail "$f: статус '$(status "$A")'"; continue; }
  ce=$(hdr "$A" content-encoding)
  [ "$ce" = "gzip" ] && ok "$f: content-encoding gzip" || fail "$f: content-encoding '${ce:-нет}' (ожидалось gzip)"
  cc=$(hdr "$A" cache-control)
  case "$cc" in *max-age=31536000*immutable*) ok "$f: $cc";; *) fail "$f: cache-control '${cc:-нет}' (ожидалось max-age=31536000, immutable)";; esac
  xf=$(hdr "$A" x-frame-options)
  [ "$xf" = "sameorigin" ] && ok "$f: X-Frame-Options есть" || fail "$f: нет X-Frame-Options (add_header в location отменил заголовки server?)"
done

echo "4. Range для mp4"
if [ -z "$MP4" ]; then
  fail "в HTML главной нет ссылки на mp4, Range не проверен (укажите вручную: curl -r 0-99 -I https://$DOMAIN/media/<файл>.mp4)"
else
  R=$("${CURL[@]}" -D - -o /dev/null -H 'Range: bytes=0-99' "https://$DOMAIN$MP4" 2>&1) || R=""
  cr=$(hdr "$R" content-range)
  [ "$(status "$R")" = "206" ] && ok "$MP4: 206" || fail "$MP4: статус '$(status "$R")' (ожидалось 206)"
  case "$cr" in bytes\ 0-99/*) ok "Content-Range: $cr";; *) fail "Content-Range '${cr:-нет}'";; esac
fi

echo
if [ "$FAILS" -eq 0 ]; then echo "ИТОГ: всё в порядке"; exit 0; fi
echo "ИТОГ: отказов $FAILS"; exit 1
