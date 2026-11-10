# Превью «Системы ясности» на общей VM

Для просмотра есть [GitHub Pages](https://elenasamanchuk.github.io/sistemayasnosti-site/). Для установки на VM использовать [архив сборки от корня](https://github.com/ElenaSamanchuk/sistemayasnosti-site/releases/tag/vm-preview-20261110-10) и приложенную SHA-256. Архив содержит только статические файлы сайта в режиме `noindex`.

**Состояние 10.11.2026:** превью установлено админом, адрес https://preview.sistemayasnosti.com. Обновление версии: `bash tools/deploy-vm-preview.sh <тег релиза>`, настройки nginx не меняются.

## До настройки

- Поддомен `preview.sistemayasnosti.com` направить A-записью на `212.233.93.50`. На 09.11.2026 A/AAAA отсутствовали. Боевой домен и ЛК остаются отдельными адресами.
- Сверить действующие виртуальные хосты и их статусы, сохранить контрольные суммы существующих конфигов. При осмотре активны `kochfit`, `medvediva`, `medvediva-kg`, `medvediva-online`, `medvediva-prod`.
- В новом пустом каталоге `/var/www/sistemayasnosti-preview/releases/<тег>` распаковать архив после `sha256sum -c sistemayasnosti-vm-preview-20261110-10.tar.gz.sha256`. Корень нового виртуального хоста — `/var/www/sistemayasnosti-preview/current`, ссылка на этот релиз.

## Изолированное подключение nginx

1. Добавить отдельный `sites-available/sistemayasnosti-preview` и его ссылку. Указать точный `server_name preview.sistemayasnosti.com`, свой webroot, `index index.html`, `try_files $uri $uri/index.html =404` и `error_page 404 /404.html`. Включить `X-Robots-Tag: noindex, nofollow` для превью. Роль `default_server` принадлежит текущему Kochfit.
2. Выпустить отдельный сертификат через webroot для нового имени по принятому на VM порядку. Проверить `nginx -t` перед каждым штатным reload. Для текущих виртуальных хостов использовать их существующие конфиги, сертификаты и каталоги.
3. Сверить HTTP/HTTPS нового хоста через `curl --resolve`, затем повторить контроль всех действующих хостов. Для MP4 и MP3 проверить одиночный `Range: bytes=0-1` и ответ `206`. Главная и `/clarity/` должны отвечать 200, произвольный неизвестный путь — 404. Для `/clarity` возможен штатный редирект на адрес со слэшем.
4. Для отката переключить только `/var/www/sistemayasnosti-preview/current` на предыдущий релиз. При проблеме первого подключения снять только ссылку нового виртуального хоста, выполнить `nginx -t` и reload, повторить контроль соседних хостов.

Текущие `/pred` и `/pred_fl` на превью ведут на `/clarity` через HTML-перенаправление. При необходимости настоящий 302 можно подключить отдельными location в конфиге нового хоста после согласования адреса назначения. Форма консультации в этой сборке работает без доставки. Метрика и Kommo включаются по условию боевого hostname.

[Состояние общей VM](~/Projects/agent-setup/docs/ADMIN.md:60)
