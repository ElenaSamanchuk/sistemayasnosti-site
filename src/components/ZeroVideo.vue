<script setup>
// Видео-элемент Zero: локальный mp4 без звука, по кругу. Загрузка и воспроизведение только рядом с экраном.
// При prefers-reduced-motion показывается первый кадр без движения.
import { inject, onBeforeUnmount, onMounted, ref, unref } from 'vue';
import { withBase } from '../lib/site-base.mjs';
const props = defineProps({ node: Object, scene: String });
const video = ref(null);
const eager = inject('eagerImages', false);
const domId = `html-video-${props.scene}-${props.node.id}`;
let observer = null;
let near = false;
let reduced = false;
function removeGestureListener() {
  document.removeEventListener('click', onGesture, true);
  document.removeEventListener('keydown', onGesture, true);
}
function onGesture(event) {
  if (!event.isTrusted) return;
  removeGestureListener();
  if (near && !reduced) start();
}
function start() {
  const el = video.value;
  if (!el) return;
  el.play()?.catch((error) => {
    if (error.name !== 'NotAllowedError' || !near || reduced || !video.value) return;
    document.addEventListener('click', onGesture, true);
    document.addEventListener('keydown', onGesture, true);
  });
}
function updateVisibility(visible) {
  const el = video.value;
  if (!el) return;
  near = visible;
  if (!near) {
    removeGestureListener();
    el.autoplay = false;
    el.pause();
    return;
  }
  if (props.node.video.poster && !el.getAttribute('poster')) el.poster = withBase(props.node.video.poster);
  if (reduced && props.node.video.poster) return;
  el.muted = true;
  el.defaultMuted = true;
  el.preload = 'metadata';
  el.autoplay = !reduced;
  if (!el.getAttribute('src')) el.src = withBase(props.node.video.src);
  if (!reduced) start();
}
onMounted(() => {
  reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (typeof IntersectionObserver === 'undefined') { updateVisibility(true); return; }
  observer = new IntersectionObserver((entries) => updateVisibility(entries.at(-1).isIntersecting), { rootMargin: '300px 0px' });
  observer.observe(video.value);
});
onBeforeUnmount(() => {
  observer?.disconnect();
  updateVisibility(false);
});
</script>
<template>
  <video ref="video" :id="domId" class="scene-video-file" :style="{ objectFit: node.video.fit }"
    :poster="unref(eager) ? withBase(node.video.poster) : undefined" muted loop playsinline disablepictureinpicture preload="none" tabindex="-1" aria-hidden="true"></video>
</template>
