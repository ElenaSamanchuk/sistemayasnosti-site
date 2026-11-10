// Внешние счётчики и виджеты сайта. Метрика запускается только на боевом домене, виджет чата ещё и на превью GitHub Pages.
// На других адресах (localhost, тестовые домены) ничего не грузится и в сеть не уходит.
//
// СОХРАНЕНО КАК НА ЖИВОМ (меняется только отдельным решением Елены, см. вопрос 2 в docs/T123-INVENTORY.md):
//  - Метрика и Kommo стартуют сразу, не дожидаясь согласия на куки (в исходных блоках проверки согласия нет);
//  - webvisor и clickmap включены.
// В исходнике Метрика 106581349 запускалась дважды (блок T123 rec1862707833 сразу и штатная вставка Тильды через
// 2 с). Здесь один запуск. Возможно, прежде часть хитов дублировалась: цифры «до» и «после» переноса могут
// отличаться (предположение, не проверено).

export const PRODUCTION_HOSTNAME = 'sistemayasnosti.com'
export const PREVIEW_HOSTNAME = 'elenasamanchuk.github.io'
export const METRIKA_ID = 106581349
export const METRIKA_SCRIPT_URL = `https://mc.yandex.ru/metrika/tag.js?id=${METRIKA_ID}`
// Параметры Kommo из блока rec1569554833. Hash есть в публичном коде страницы, секретом сайта не считается.
export const KOMMO = Object.freeze({
  id: '1059843',
  hash: '9098def5d0127265effcba68b03fa47c9290d1b4f86103dea391434be7484367',
  locale: 'en',
  scriptUrl: 'https://gso.kommo.com/js/button.js',
})

/** Боевой домен? Строго sistemayasnosti.com (www и поддомены сюда не входят: решить отдельно, см. README). */
export function isProductionHost(hostname) {
  const host = hostname ?? (typeof location !== 'undefined' ? location.hostname : '')
  return host === PRODUCTION_HOSTNAME
}

/** Превью на GitHub Pages. Решение Елены 10.11.2026: здесь работает виджет чата, Метрика остаётся только на боевом домене. */
export function isPreviewHost(hostname) {
  const host = hostname ?? (typeof location !== 'undefined' ? location.hostname : '')
  return host === PREVIEW_HOSTNAME
}

const state = () => {
  if (typeof window === 'undefined') return {}
  return (window.__syaIntegrations ||= {})
}

/** Яндекс.Метрика: один раз за загрузку страницы. Возвращает true, если запуск выполнен сейчас. */
export function initMetrika() {
  if (typeof window === 'undefined' || typeof document === 'undefined' || !isProductionHost()) return false
  const s = state()
  if (s.metrika) return false
  s.metrika = true

  const w = window
  w.ym =
    w.ym ||
    function () {
      ;(w.ym.a = w.ym.a || []).push(arguments)
    }
  w.ym.l = 1 * new Date()

  // Защита от повторной вставки скрипта, как в исходном блоке.
  const already = Array.from(document.scripts).some((el) => el.src === METRIKA_SCRIPT_URL)
  if (!already) {
    const first = document.getElementsByTagName('script')[0]
    const tag = document.createElement('script')
    tag.async = true
    tag.src = METRIKA_SCRIPT_URL
    if (first && first.parentNode) first.parentNode.insertBefore(tag, first)
    else document.head.appendChild(tag)
  }

  w.ym(METRIKA_ID, 'init', {
    ssr: true,
    webvisor: true,
    clickmap: true,
    ecommerce: 'dataLayer',
    referrer: document.referrer,
    url: location.href,
    accurateTrackBounce: true,
    trackLinks: true,
  })
  return true
}

/** Просмотр страницы при переходах без перезагрузки (нужно только если сайт открывает страницы клиентским роутером). */
export function trackPageView(url, options = {}) {
  if (typeof window === 'undefined' || !isProductionHost() || typeof window.ym !== 'function' || !state().metrika) return false
  window.ym(METRIKA_ID, 'hit', url || location.href, options)
  return true
}

/** Виджет чата Kommo: один раз за загрузку страницы. Повторяет исходный код: window.crm_plugin + window.crmPlugin. */
export function initKommo() {
  if (typeof window === 'undefined' || typeof document === 'undefined' || (!isProductionHost() && !isPreviewHost())) return false
  const s = state()
  if (s.kommo) return false
  s.kommo = true

  const w = window
  w.crm_plugin = {
    id: KOMMO.id,
    hash: KOMMO.hash,
    locale: KOMMO.locale,
    setMeta(p) {
      this.params = (this.params || []).concat([p])
    },
  }
  w.crmPlugin =
    w.crmPlugin ||
    function () {
      ;(w.crmPlugin.q = w.crmPlugin.q || []).push(arguments)
    }
  const el = document.createElement('script')
  el.async = true
  el.id = 'crm_plugin_script'
  el.src = KOMMO.scriptUrl
  if (document.head) document.head.appendChild(el)
  return true
}

/** Запуск всего набора. Безопасно вызывать несколько раз. */
export function initSiteIntegrations() {
  return { production: isProductionHost(), metrika: initMetrika(), kommo: initKommo() }
}

/** Для блоков реестра embeds вида { kind: 'global', name }. */
export const globals = Object.freeze({
  metrika: initMetrika,
  kommo: initKommo,
})

export function runGlobal(name) {
  const fn = globals[name]
  if (!fn) {
    console.warn('[site-integrations] неизвестная интеграция:', name)
    return false
  }
  return fn()
}
