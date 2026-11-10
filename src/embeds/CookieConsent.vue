<script setup>
// Логика плашки куки. Источник: T123 rec2019386053 (все страницы) и rec2019389043 (копия на главной).
// Вёрстка плашки (.cookieBanner) живёт в шапке (Zero-блок), здесь только поведение.
// СОХРАНЕНО КАК НА ЖИВОМ (не менять без решения Елены, вопрос 2 в T123-INVENTORY):
//  - согласие записывается по ЛЮБОМУ клику в любом месте страницы, кроме ссылки с классом cookie-banner-link;
//  - ключи localStorage: cookieConsent = 'accepted', cookieConsentDate = ISO-дата;
//  - Метрика и Kommo стартуют независимо от согласия (см. src/lib/site-integrations.mjs).
// Отличие: обращения к localStorage в try/catch (в приватном режиме Safari они бросали бы ошибку).
import { onMounted, onBeforeUnmount } from 'vue'
import { prefersReducedMotion, safeStorage, waitForElement } from './util.mjs'

const STORAGE_KEY = 'cookieConsent'
const STORAGE_DATE_KEY = 'cookieConsentDate'

const props = defineProps({
  bannerSelector: { type: String, default: '.cookieBanner' },
  policyLinkClass: { type: String, default: 'cookie-banner-link' },
})

let wait = null
let hideTimer = 0
let showTimer = 0
let banner = null

function isPolicyLinkClick(element) {
  let current = element
  while (current && current !== document.body) {
    if (current.classList && current.classList.contains(props.policyLinkClass)) return true
    current = current.parentElement
  }
  return false
}

function hideBanner() {
  if (!banner) return
  document.removeEventListener('click', onGlobalClick, true)
  banner.classList.remove('visible')
  banner.classList.add('hidden')
  const b = banner
  hideTimer = setTimeout(() => {
    b.style.display = 'none'
  }, prefersReducedMotion() ? 0 : 400)
}

function onGlobalClick(event) {
  if (isPolicyLinkClick(event.target)) return
  safeStorage.set(STORAGE_KEY, 'accepted')
  safeStorage.set(STORAGE_DATE_KEY, new Date().toISOString())
  hideBanner()
}

onMounted(() => {
  wait = waitForElement(props.bannerSelector)
  wait.promise.then((el) => {
    if (!el) return console.warn('[embeds] CookieConsent: не найдена плашка', props.bannerSelector)
    banner = el
    if (safeStorage.get(STORAGE_KEY) === 'accepted') {
      banner.style.display = 'none'
      return
    }
    banner.style.display = 'block'
    showTimer = setTimeout(() => banner.classList.add('visible'), 10)
    document.addEventListener('click', onGlobalClick, true)
  })
})

onBeforeUnmount(() => {
  wait?.cancel()
  clearTimeout(hideTimer)
  clearTimeout(showTimer)
  document.removeEventListener('click', onGlobalClick, true)
})
</script>

<template>
  <i hidden data-embed="cookie-consent"></i>
</template>

<style>
/* Не scoped: плашка находится в другом компоненте (шапка). */
.cookie-banner-btn {
  cursor: pointer;
}
.cookieBanner.hidden {
  opacity: 0 !important;
  transform: translateY(20px) !important;
  pointer-events: none !important;
  transition: opacity 0.4s ease, transform 0.4s ease !important;
}
.cookieBanner.visible {
  opacity: 1;
  transform: translateY(0);
  transition: opacity 0.4s ease, transform 0.4s ease;
}
@media (prefers-reduced-motion: reduce) {
  .cookieBanner.hidden,
  .cookieBanner.visible {
    transition: none !important;
    transform: none !important;
  }
}
</style>
