<script setup>
// Оболочка аудиоклуба. Подключает готовую сборку клуба (Vue-бандл, написанный в ~/Projects/sistema-yasnosti-club)
// из ЛОКАЛЬНЫХ файлов public/embeds/audio-club/<variant>/club.css и club.js; картинки и музыка берутся из
// public/embeds/audio-club/shared/assets/. Запросов к jsDelivr нет (адрес заменён при сборке build-month.mjs).
// Ссылки оплаты (Tribute) и бота лежат внутри club.js и не менялись.
// Известные ограничения бандла (он не рассчитан на размонтирование):
//  - он вешает глобальные обработчики (клик по якорям) и не снимает их; при переходе на другую страницу без
//    перезагрузки они остаются, поэтому аудиоклуб лучше отдавать отдельными HTML-страницами (не клиентским роутером);
//  - при уходе со страницы компонент нажимает «Пауза», если играет музыка, чтобы звук не продолжился.
import { onMounted, onBeforeUnmount } from 'vue'

const props = defineProps({
  // Папка выпуска в public/embeds/audio-club/, например '2026-11'.
  variant: { type: String, required: true },
})

const base = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) || '/'
const root = `${base}embeds/audio-club/`.replace(/\/{2,}/g, '/')
let linkEl = null
let scriptEl = null
let timer = 0

onMounted(() => {
  // Файлы из вспомогательной папки; бандл читает этот адрес как базу картинок и музыки.
  window.SYA_ASSET_BASE = `${root}shared/`
  window.SYA_SITE_BASE = base

  linkEl = document.createElement('link')
  linkEl.rel = 'stylesheet'
  linkEl.href = `${root}${props.variant}/club.css`
  linkEl.setAttribute('data-sya-club', props.variant)

  const loadScript = () => {
    if (scriptEl || !linkEl) return
    clearTimeout(timer)
    scriptEl = document.createElement('script')
    scriptEl.src = `${root}${props.variant}/club.js`
    scriptEl.async = true
    scriptEl.setAttribute('data-sya-club', props.variant)
    document.body.appendChild(scriptEl)
  }
  // Скрипт после стилей, чтобы страница не мигала без оформления; если стили не пришли за 4 с, запускаем всё равно.
  linkEl.addEventListener('load', loadScript)
  linkEl.addEventListener('error', loadScript)
  timer = setTimeout(loadScript, 4000)
  document.head.appendChild(linkEl)
})

onBeforeUnmount(() => {
  clearTimeout(timer)
  const rootEl = document.getElementById('sya-club')
  if (rootEl && rootEl.hasAttribute('data-sya-playing')) {
    const btn = rootEl.querySelector('.sya-play')
    if (btn) btn.click()
  }
  linkEl?.remove()
  scriptEl?.remove()
  linkEl = scriptEl = null
})
</script>

<template>
  <!-- v-once: внутрь #sya-club-app бандл рисует разметку сам, Vue сайта её не трогает -->
  <div id="sya-club" class="sya" v-once>
    <div id="sya-club-app"></div>
  </div>
</template>
