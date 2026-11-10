// Общие мелочи для встроенных компонентов. Без зависимостей, без обращений к window на уровне модуля
// (файл можно импортировать при сборке/prerender).

/** Как в скриптах Тильды: Safari без Chrome и Android. В исходном коде блоков переменная не объявлена. */
export function detectSafari() {
  if (typeof navigator === 'undefined') return false
  return /^((?!chrome|android).)*safari/i.test(navigator.userAgent)
}

export function prefersReducedMotion() {
  return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Ждёт появления элемента (блоки страницы могут дорисоваться после компонента).
 * Возвращает { promise, cancel }. По таймауту promise даёт null, ошибок не бросает.
 */
export function waitForElement(selector, { root = document, timeout = 8000, interval = 100 } = {}) {
  let timer = 0
  let stopped = false
  const promise = new Promise((resolve) => {
    const started = Date.now()
    const tick = () => {
      if (stopped) return resolve(null)
      let el = null
      try {
        el = root.querySelector(selector)
      } catch {
        return resolve(null)
      }
      if (el) return resolve(el)
      if (Date.now() - started >= timeout) return resolve(null)
      timer = setTimeout(tick, interval)
    }
    tick()
  })
  return {
    promise,
    cancel() {
      stopped = true
      clearTimeout(timer)
    },
  }
}

/** Безопасная работа с localStorage (Safari в приватном режиме и блокировка данных бросают исключения). */
export const safeStorage = {
  get(key) {
    try {
      return window.localStorage.getItem(key)
    } catch {
      return null
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem(key, value)
      return true
    } catch {
      return false
    }
  },
}
