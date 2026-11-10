<script setup>
// Горизонтальная прокрутка Zero-блока перетаскиванием (мышь) и касанием.
// Источник: T123 rec1488855793 (/), rec2098149263 (/about), rec2426973863 (/clarity), код во всех трёх одинаковый.
// Поведение как на живом сайте: колесо мыши блок НЕ крутит (в исходнике функция колеса не подключена).
// Колесо можно включить пропсом wheel, по умолчанию выключено.
import { onMounted, onBeforeUnmount } from 'vue'
import { detectSafari, prefersReducedMotion, waitForElement } from './util.mjs'

const props = defineProps({
  // Селекторы блоков, например ['#rec1487844433']. Внутри каждого ищется artboardSelector.
  targets: { type: Array, required: true },
  artboardSelector: { type: String, default: '.t396__artboard' },
  carrierSelector: { type: String, default: '.t396__carrier' },
  // Тильда делает несущий слой sticky; нужно, пока верстка Zero-блока остаётся как у Тильды.
  carrierSticky: { type: Boolean, default: true },
  wheel: { type: Boolean, default: false },
})

const isSafari = detectSafari()
const cleanups = []
const waits = []

function setup(elem) {
  const undo = []
  const on = (target, type, fn, opts) => {
    target.addEventListener(type, fn, opts)
    undo.push(() => target.removeEventListener(type, fn, opts))
  }
  const prevStyle = elem.getAttribute('style')
  undo.push(() => (prevStyle === null ? elem.removeAttribute('style') : elem.setAttribute('style', prevStyle)))

  const img = elem.querySelector('img')
  if (img) {
    const prevDrag = img.ondragstart
    img.ondragstart = () => false
    undo.push(() => (img.ondragstart = prevDrag))
  }

  const notTrueSafari = !(isSafari && window.innerWidth < 960)
  if (notTrueSafari) elem.style.setProperty('overflow-x', 'auto', 'important')
  elem.style.overflowY = 'hidden'
  elem.style.webkitOverflowScrolling = 'touch'

  const carrier = props.carrierSelector ? elem.querySelector(props.carrierSelector) : null
  if (carrier && props.carrierSticky) {
    const prevPos = carrier.style.position
    carrier.style.position = 'sticky'
    undo.push(() => (carrier.style.position = prevPos))
  }
  elem.style.cursor = 'grab'

  let pos = { left: 0, x: 0 }
  let targetScrollLeft = elem.scrollLeft
  let raf = 0
  const maxLeft = () => elem.scrollWidth - elem.clientWidth

  const setLeft = (value) => {
    if (value >= 0 && value <= maxLeft()) elem.scrollLeft = value
  }

  const onMouseMove = (e) => setLeft(pos.left - (e.clientX - pos.x))
  const onMouseUp = () => {
    elem.style.cursor = 'grab'
    elem.style.removeProperty('user-select')
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
  }
  const onMouseDown = (e) => {
    elem.style.cursor = 'grabbing'
    elem.style.userSelect = 'none'
    pos = { left: elem.scrollLeft, x: e.clientX }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }
  on(elem, 'mousedown', onMouseDown)
  undo.push(onMouseUp)

  if (notTrueSafari) {
    on(
      elem,
      'touchstart',
      (e) => {
        pos = { left: elem.scrollLeft, x: e.touches[0].clientX }
      },
      { passive: true }
    )
    on(
      elem,
      'touchmove',
      (e) => {
        setLeft(pos.left - (e.touches[0].clientX - pos.x))
      },
      { passive: true }
    )
  } else {
    elem.style.overflowX = 'scroll'
  }

  if (props.wheel) {
    const centered = () => {
      const rect = elem.getBoundingClientRect()
      const center = (rect.top + rect.bottom) / 2
      return Math.abs(center - window.innerHeight / 2) < window.innerHeight / 5
    }
    const step = () => {
      const distance = targetScrollLeft - elem.scrollLeft
      if (Math.abs(distance) < 1) {
        elem.scrollLeft = targetScrollLeft
        raf = 0
        return
      }
      setLeft(elem.scrollLeft + distance * 0.1)
      raf = requestAnimationFrame(step)
    }
    const onWheel = (e) => {
      if (!centered()) return
      const max = maxLeft()
      if (max <= 0) return
      const delta = e.deltaY > 0 ? 1 : -1
      const atLeft = elem.scrollLeft - 20 <= 0.5 && delta < 0
      const atRight = elem.scrollLeft + 20 >= max - 0.5 && delta > 0
      if (atLeft || atRight) return // на краях отдаём прокрутку странице
      e.preventDefault()
      targetScrollLeft = Math.min(Math.max(0, elem.scrollLeft + delta * Math.max(20, Math.round(elem.offsetWidth / 10))), max)
      if (prefersReducedMotion()) elem.scrollLeft = targetScrollLeft
      else if (!raf) raf = requestAnimationFrame(step)
    }
    on(window, 'wheel', onWheel, { passive: false })
    undo.push(() => raf && cancelAnimationFrame(raf))
  }

  // Полосу прокрутки прячем стилем, как в исходном блоке.
  const style = document.createElement('style')
  style.setAttribute('data-embed', 'horizontal-drag-scroll')
  elem.setAttribute('data-hscroll', '')
  style.textContent = '[data-hscroll]::-webkit-scrollbar{display:none}[data-hscroll]{scrollbar-width:none}'
  document.head.appendChild(style)
  undo.push(() => {
    style.remove()
    elem.removeAttribute('data-hscroll')
  })

  return () => undo.reverse().forEach((fn) => fn())
}

onMounted(() => {
  props.targets.forEach((target) => {
    const w = waitForElement(`${target} ${props.artboardSelector}`)
    waits.push(w)
    w.promise.then((elem) => {
      if (elem) cleanups.push(setup(elem))
      else console.warn('[embeds] HorizontalDragScroll: не найден', target, props.artboardSelector)
    })
  })
})

onBeforeUnmount(() => {
  waits.forEach((w) => w.cancel())
  cleanups.splice(0).forEach((fn) => fn())
})
</script>

<template>
  <i hidden data-embed="horizontal-drag-scroll"></i>
</template>
