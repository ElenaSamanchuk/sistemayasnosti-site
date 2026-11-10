<script setup>
// Автопрокрутка полосы туда-обратно на /clarity. Источник: T123 rec2426973883 (блок #rec2426973703).
// Как на живом сайте, автопрокрутка не останавливается насовсем (правка заказчика 10.11: раньше колесо мыши над полосой выключало её).
// Пока полосу двигают пальцем, мышью или горизонтальной прокруткой, она ждёт, через 1,5 с продолжает с текущего места.
// Обычная вертикальная прокрутка страницы и наведение курсора на полосу не влияют.
// Скорость как на живом (2 px за 35 мс, около 57 px/с), старт через 1,5 с. Работает только пока полоса на экране
// и вкладка видна; при prefers-reduced-motion автопрокрутки нет.
import { onMounted, onBeforeUnmount } from 'vue'
import { waitForElement } from './util.mjs'

const props = defineProps({
  target: { type: String, default: '#rec2426973703' },
  artboardSelector: { type: String, default: '.t396__artboard' },
  speed: { type: Number, default: 2 / 0.035 }, // px в секунду
  startDelayMs: { type: Number, default: 1500 },
})

let wait = null
let teardown = null

function setup(elem) {
  const undo = []
  const on = (target, type, fn, opts) => {
    target.addEventListener(type, fn, opts)
    undo.push(() => target.removeEventListener(type, fn, opts))
  }
  const prevStyle = elem.getAttribute('style')
  undo.push(() => (prevStyle === null ? elem.removeAttribute('style') : elem.setAttribute('style', prevStyle)))

  elem.querySelectorAll('img').forEach((img) => {
    const prev = img.ondragstart
    img.ondragstart = () => false
    img.style.webkitTouchCallout = 'none'
    undo.push(() => (img.ondragstart = prev))
  })
  elem.style.overflowX = 'auto'
  elem.style.overflowY = 'hidden'
  elem.style.webkitOverflowScrolling = 'touch'

  const style = document.createElement('style')
  elem.setAttribute('data-autoscroll', '')
  style.textContent = '[data-autoscroll]::-webkit-scrollbar{display:none}[data-autoscroll]{scrollbar-width:none}'
  document.head.appendChild(style)
  undo.push(() => {
    style.remove()
    elem.removeAttribute('data-autoscroll')
  })

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')
  let pausedByUser = false
  let resumeTimer = 0
  let visible = false
  let ready = false
  let raf = 0
  let last = 0
  let pos = 0
  let dir = 1

  const shouldRun = () => ready && !pausedByUser && visible && !document.hidden && !reduce.matches

  const frame = (t) => {
    raf = 0
    if (!shouldRun()) return
    if (last) {
      const dt = Math.min(t - last, 100)
      const max = elem.scrollWidth - elem.clientWidth
      if (max > 0) {
        if (pos >= max - 5 && dir === 1) dir = -1
        else if (pos <= 5 && dir === -1) dir = 1
        pos = Math.min(max, Math.max(0, pos + (dir * props.speed * dt) / 1000))
        elem.scrollLeft = pos
      }
    }
    last = t
    raf = requestAnimationFrame(frame)
  }
  const update = () => {
    if (shouldRun()) {
      if (!raf) {
        pos = elem.scrollLeft // подхватываем положение, если полосу двигали руками
        last = 0
        raf = requestAnimationFrame(frame)
      }
    } else if (raf) {
      cancelAnimationFrame(raf)
      raf = 0
    }
  }
  undo.push(() => raf && cancelAnimationFrame(raf))

  const holdWhileMoved = () => {
    clearTimeout(resumeTimer)
    pausedByUser = true
    update()
  }
  const resumeSoon = () => {
    clearTimeout(resumeTimer)
    resumeTimer = setTimeout(() => {
      pausedByUser = false
      update()
    }, 1500)
  }
  undo.push(() => clearTimeout(resumeTimer))
  on(elem, 'pointerdown', holdWhileMoved, { passive: true })
  on(elem, 'touchstart', holdWhileMoved, { passive: true })
  on(window, 'pointerup', () => pausedByUser && resumeSoon(), { passive: true })
  on(window, 'pointercancel', () => pausedByUser && resumeSoon(), { passive: true })
  on(window, 'touchend', () => pausedByUser && resumeSoon(), { passive: true })
  on(window, 'touchcancel', () => pausedByUser && resumeSoon(), { passive: true })
  on(elem, 'wheel', (event) => {
    if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return
    holdWhileMoved()
    resumeSoon()
  }, { passive: true })
  on(document, 'visibilitychange', update)
  on(window, 'resize', update)
  reduce.addEventListener?.('change', update)
  undo.push(() => reduce.removeEventListener?.('change', update))

  let io = null
  if ('IntersectionObserver' in window) {
    io = new IntersectionObserver((entries) => {
      visible = entries[entries.length - 1].isIntersecting
      update()
    })
    io.observe(elem)
    undo.push(() => io.disconnect())
  } else {
    visible = true
  }
  const startTimer = setTimeout(() => {
    ready = true
    update()
  }, props.startDelayMs)
  undo.push(() => clearTimeout(startTimer))

  return () => undo.reverse().forEach((fn) => fn())
}

onMounted(() => {
  wait = waitForElement(`${props.target} ${props.artboardSelector}`)
  wait.promise.then((elem) => {
    if (elem) teardown = setup(elem)
    else console.warn('[embeds] AutoScrollStrip: не найден', props.target)
  })
})

onBeforeUnmount(() => {
  wait?.cancel()
  teardown?.()
})
</script>

<template>
  <i hidden data-embed="auto-scroll-strip"></i>
</template>
