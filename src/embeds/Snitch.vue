<script setup>
// Золотой снитч на главной: плавное появление и «парение». Источник: T123 rec1795637143 (картинка .snitch).
// Как на живом: старт при попадании в экран на 30 %, появление 1,5 с, затем парение 10 с по кругу.
// Искры (createSparkles) в живом коде были отключены, не переносятся. При prefers-reduced-motion картинка просто видна.
import { onMounted, onBeforeUnmount } from 'vue'
import { prefersReducedMotion, waitForElement } from './util.mjs'

const props = defineProps({
  selector: { type: String, default: '.snitch' },
  threshold: { type: Number, default: 0.3 },
})

let wait = null
let io = null
let img = null
let timer = 0

onMounted(() => {
  if (prefersReducedMotion()) return
  wait = waitForElement(props.selector)
  wait.promise.then((el) => {
    // В снимке 09.11 элемента .snitch нет ни на одной странице, на живом этот блок тоже ничего не делает
    if (!el) return
    img = el
    const parent = el.parentElement
    if (parent && getComputedStyle(parent).position === 'static') parent.style.position = 'relative'
    el.classList.add('sya-snitch-pending')
    if (!('IntersectionObserver' in window)) {
      el.classList.replace('sya-snitch-pending', 'sya-snitch-live')
      return
    }
    io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return
        io.disconnect()
        timer = setTimeout(() => {
          el.classList.remove('sya-snitch-pending')
          el.classList.add('sya-snitch-live')
        }, 100)
      },
      { threshold: props.threshold }
    )
    io.observe(el)
  })
})

onBeforeUnmount(() => {
  wait?.cancel()
  io?.disconnect()
  clearTimeout(timer)
  img?.classList.remove('sya-snitch-pending', 'sya-snitch-live')
})
</script>

<template>
  <i hidden data-embed="snitch"></i>
</template>

<style>
/* Не scoped: картинка лежит в другом блоке страницы. */
.sya-snitch-pending {
  opacity: 0;
  position: relative;
  display: inline-block;
}
.sya-snitch-live {
  position: relative;
  display: inline-block;
  opacity: 0;
  animation: sya-snitch-fade-in 1.5s ease-out forwards, sya-snitch-float 10s ease-in-out 1.5s infinite;
}
@keyframes sya-snitch-fade-in {
  0% {
    opacity: 0;
    transform: scale(0.8);
  }
  100% {
    opacity: 1;
    transform: scale(1);
  }
}
@keyframes sya-snitch-float {
  0%,
  100% {
    transform: translateY(0) rotate(0deg);
    filter: drop-shadow(0 0 5px rgba(255, 215, 0, 0.4));
  }
  25% {
    transform: translateY(-10px) rotate(2deg);
    filter: drop-shadow(0 0 10px rgba(255, 215, 0, 0.5));
  }
  50% {
    transform: translateY(-5px) rotate(-1deg);
    filter: drop-shadow(0 0 20px rgba(255, 215, 0, 0.7));
  }
  75% {
    transform: translateY(-12px) rotate(1deg);
    filter: drop-shadow(0 0 15px rgba(255, 215, 0, 0.6));
  }
}
@media (prefers-reduced-motion: reduce) {
  .sya-snitch-pending,
  .sya-snitch-live {
    opacity: 1;
    animation: none;
  }
}
</style>
