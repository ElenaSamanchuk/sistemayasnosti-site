<script setup>
import { computed, provide } from 'vue';
import SceneNode from './SceneNode.vue';
import { field, screenFor } from '../lib/scene.mjs';
const server = typeof window === 'undefined';
const props = defineProps({ scene: Object, width: Number, eager: Boolean, skipReveal: Boolean });
provide('eagerImages', computed(() => !!props.eager));
provide('skipReveal', computed(() => !!props.skipReveal));
const visible = computed(() => {
  const min = Number.parseFloat(props.scene.min), max = Number.parseFloat(props.scene.max);
  // Как t-screenmin/t-screenmax Тильды: min скрывает при ширине ≤ min, max скрывает при ширине > max
  return server || ((!Number.isFinite(min) || props.width > min) && (!Number.isFinite(max) || props.width <= max));
});
const screen = computed(() => screenFor(props.width, (props.scene.board.screens || '320,480,640,960,1200').split(',').map(Number)));
const scale = computed(() => (field(props.scene.board, 'upscale', screen.value, true) === 'window' ? Number((props.width / screen.value).toFixed(3)) : 1));
provide('sceneScale', scale);
// Масштаб блока как в Медведевой: transform на весь блок. Исключение: блок с position:fixed в анимации прокрутки (/clarity), внутри transform fixed не работает
const keepsZoom = computed(() => scale.value !== 1 && JSON.stringify(props.scene.nodes).includes('"fi":"fixed"'));
const scrollable = computed(() => field(props.scene.board, 'ovrflw', screen.value, true) === 'auto' && props.scene.board.pos !== 'fixed');
const height = computed(() => {
  const design = Number(field(props.scene.board, 'height', screen.value, true) || 0);
  const vh = Number(field(props.scene.board, 'height_vh', screen.value, true) || 0);
  return vh ? Math.max(design, ((server ? 1000 : innerHeight) / scale.value) * vh / 100) : design;
});
// Тильда центрирует элементы на экране, когда артборд выше макета (попапы на 100vh). На ширине 1200 это уже заложено в CSS через calc(50vh…)
const verticalShift = computed(() => {
  if (server || screen.value >= 1200 || props.scene.board.valign !== 'center') return 0;
  return Math.max(0, (height.value - Number(field(props.scene.board, 'height', screen.value, true) || 0)) / 2);
});
</script>
<template>
  <!-- id записи и классы t396 нужны компонентам из src/embeds, они ищут блоки по этим селекторам -->
  <div v-show="visible" class="scene-rec r" :id="`rec${scene.id}`">
    <section class="scene-section" :class="{ 'scene-section--overflow-visible': scene.board.ovrflw === 'visible' }" :id="`scene-${scene.id}`" :data-scene="scene.id" :style="server ? undefined : { height: Math.floor(scene.board.pos === 'fixed' ? height : height * scale) + 'px', '--scene-scale': scale }">
      <div class="scene-canvas t396__artboard" :class="{ 'scene-canvas--scrollable': scrollable }" :tabindex="scrollable ? 0 : undefined" :style="server ? { width: '100%' } : { width: width / scale + 'px', height: height + 'px', ...(scale === 1 ? {} : keepsZoom ? { zoom: scale } : { transform: `scale(${scale})` }), ...(verticalShift ? { top: (keepsZoom ? verticalShift : verticalShift * scale) + 'px' } : {}) }">
        <div class="scene-background t396__carrier"></div><div class="scene-filter t396__filter"></div>
        <SceneNode v-for="node in scene.nodes" :key="node.id" :node="node" :screen="screen" :scene="scene.id" />
      </div>
    </section>
  </div>
</template>
