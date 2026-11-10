<script setup>
// Эффект печатной машинки. Источник: T123 rec1490588213 (главная, элемент tn-elem__1485551813176157991652187570).
// Текст остаётся в HTML (поисковики, выключенный JS); компонент стирает его и печатает по буквам
// при появлении на экране (порог 0,5, 50 мс на букву) как на живом. При prefers-reduced-motion текст не трогается.
// Стили элемента (шрифт Inter, 18/16/10 px, цвет #4B3C25, line-height 1.2) в компонент НЕ входят: см. README, список для компилятора.
// Курсор в живом коде фактически не появлялся (класс только снимался), здесь его нет.
import { onMounted, onBeforeUnmount } from 'vue'
import { prefersReducedMotion, waitForElement } from './util.mjs'

const props = defineProps({
  targets: { type: Array, default: () => ['.tn-elem__1485551813176157991652187570'] },
  intervalMs: { type: Number, default: 50 },
  threshold: { type: Number, default: 0.5 },
  rootMargin: { type: String, default: '0px 0px -50px 0px' },
})

const items = []
let io = null
const waits = []

function restore() {
  items.forEach((it) => {
    clearTimeout(it.timer)
    it.el.textContent = it.text
  })
  items.length = 0
}

function type(it) {
  const chars = Array.from(it.text)
  let i = 0
  const tick = () => {
    if (i < chars.length) {
      it.el.textContent += chars[i++]
      it.timer = setTimeout(tick, props.intervalMs)
    }
  }
  tick()
}

onMounted(() => {
  if (prefersReducedMotion() || !('IntersectionObserver' in window)) return
  io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return
        const it = items.find((x) => x.el === entry.target)
        io.unobserve(entry.target)
        if (it) type(it)
      })
    },
    { threshold: props.threshold, rootMargin: props.rootMargin }
  )
  props.targets.forEach((sel) => {
    const w = waitForElement(sel)
    waits.push(w)
    w.promise.then((el) => {
      if (!el) return console.warn('[embeds] Typewriter: не найден', sel)
      const it = { el, text: el.textContent, timer: 0 }
      items.push(it)
      el.textContent = ''
      io.observe(el)
    })
  })
})

onBeforeUnmount(() => {
  waits.forEach((w) => w.cancel())
  io?.disconnect()
  restore()
})
</script>

<template>
  <i hidden data-embed="typewriter"></i>
</template>
