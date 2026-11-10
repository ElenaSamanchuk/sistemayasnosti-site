<script setup>
import { reveal as vReveal } from '../lib/reveal.mjs';
import { sbs as vSbs } from '../lib/sbs.mjs';
import ZeroVideo from './ZeroVideo.vue';
import ZeroForm from './ZeroForm.vue';
import { computed, inject, unref } from 'vue';
import { lazyImages } from '../lib/lazy-images.mjs';
import { deferBackground as vDeferBackground } from '../lib/defer-background.mjs';
import { prefixRootUrls } from '../lib/site-base.mjs';
import { field, localLink, linkTarget } from '../lib/scene.mjs';
const isPhysicalFlex = (fields) => !!fields?.flex && fields.flex !== 'none';
const props = defineProps({ node: Object, screen: Number, scene: String, parent: Object });
const eagerImages = inject('eagerImages', false);
const skipReveal = inject('skipReveal', false);
const eager = computed(() => unref(eagerImages) === true);
function revealOf(animation) { return unref(skipReveal) ? undefined : animation; }
const LOCAL_BACKGROUND = /(^|;)\s*background-image\s*:\s*(url\(\s*['"]?\/media\/[^'")]+['"]?\s*\))\s*(?=;|$)/gi;
const atomStyle = computed(() => {
  const style = props.node.atomStyle + (props.node.background ? `;background-image:url("${props.node.background}")` : '');
  const prepared = eager.value ? style : style.replace(LOCAL_BACKGROUND, '$1--sya-background-url:$2;background-image:var(--sya-background-visible,none)');
  return prefixRootUrls(prepared) || '';
});
const hasDeferredBackground = computed(() => atomStyle.value.includes('--sya-background-url:'));
const renderedHtml = computed(() => { const html = props.node.html || ''; return eager.value ? prefixRootUrls(html) || '' : lazyImages(html); });
const gridPctStyle = computed(() => {
  const f = props.node.fields; if (!f || props.parent) return undefined;
  if (!Object.entries(f).some(([k, v]) => k.startsWith('widthunits') && v === '%')) return undefined;
  const get = (k) => field(f, k, props.screen);
  const value = Number(get('width')); if (!(value > 0)) return undefined;
  if (get('widthunits') === 'px') return { width: `${value}px` };
  if (get('widthunits') === '%' && get('container') === 'grid') return { width: `${props.screen * value / 100}px` };
  return undefined;
});
const groupStyle = computed(() => {
  if (props.node.type !== 'group' || typeof window === 'undefined') return undefined;
  const f = props.node.fields; const get = (k) => field(f, k, props.screen); const pf = props.parent?.fields;
  const top = Number(get('top') || 0) - (pf ? Number(field(pf, 'top', props.screen) || 0) : 0);
  const left = Number(get('left') || 0) - (pf ? Number(field(pf, 'left', props.screen) || 0) : 0);
  if (isPhysicalFlex(pf)) return { top: '0px', left: '0px', position: 'relative' };
  return { top: `${top}px`, left: pf || get('container') === 'window' ? `${left}px` : `calc(50% - ${props.screen / 2}px + ${left}px)`, position: 'absolute' };
});
// Масштаб всего блока: тонкие линии при этом оставляем в исходную толщину (на Тильде 1 px остаётся 1 px)
const sceneScale = inject('sceneScale', 1);
const thinStyle = computed(() => {
  const scale = unref(sceneScale);
  if (props.node.type !== 'shape' || scale === 1) return undefined;
  const size = (key) => Number(field(props.node.fields, key, props.screen));
  const style = {};
  for (const key of ['height', 'width']) { const value = size(key); if (value > 0 && value <= 2) style[key] = `${value / scale}px`; }
  return style;
});
const href = computed(() => localLink(props.node.href));
// Ссылка-иконка без текста и без alt (соцсети в футере): без имени её не прочитает экранный диктор. Вид не меняется.
const iconLabel = computed(() => {
  const link = href.value; const html = String(props.node.html || '');
  if (!link || html.replace(/<[^>]*>/g, '').trim() || /\salt="[^"]+"/.test(html)) return undefined;
  if (/instagram\.com/.test(link)) return 'Instagram';
  if (/youtube\.com|youtu\.be/.test(link)) return 'YouTube';
  if (/^tg:|t\.me\//.test(link)) return 'Telegram';
  if (/^mailto:/.test(link)) return 'Написать на почту';
  return undefined;
});
</script>
<template>
  <div v-if="node.type === 'group'" v-reveal="revealOf(node.animation)" v-sbs="node.sbs" class="scene-group tn-group" :class="[node.classes, `tn-group__${scene}${node.id}`]" :data-node="node.id" :style="[groupStyle, gridPctStyle]">
    <div class="scene-group-inner" :class="{ 'scene-flex': isPhysicalFlex(node.fields) }" :id="`group-${node.id}`">
      <SceneNode v-for="child in node.children" :key="child.id" :node="child" :screen="screen" :scene="scene" :parent="node" />
    </div>
  </div>
  <div v-else v-defer-background="hasDeferredBackground" v-reveal="revealOf(node.animation)" v-sbs="node.sbs" :style="[gridPctStyle, thinStyle]" class="scene-node tn-elem" :class="[node.classes, `scene-${node.type}`, `tn-elem__${scene}${node.id}`, { 'scene-group-child': isPhysicalFlex(parent?.fields) }]" :data-node="node.id">
    <div v-if="node.type === 'video'" class="scene-atom tn-atom" :style="atomStyle"><ZeroVideo :node="node" :scene="scene" /></div>
    <div v-else-if="node.type === 'form'" class="scene-atom tn-atom" :style="atomStyle"><ZeroForm :node="node" :screen="screen" /></div>
    <a v-else-if="href" class="scene-atom tn-atom" :href="href" :aria-label="iconLabel" :target="linkTarget(href)" :rel="linkTarget(href) ? 'noopener noreferrer' : undefined" :style="atomStyle" v-html="renderedHtml"></a>
    <button v-else-if="node.type === 'button'" type="button" class="scene-atom tn-atom" :style="atomStyle" v-html="renderedHtml"></button>
    <h1 v-else-if="node.tag === 'h1'" class="scene-atom tn-atom" :style="atomStyle" v-html="renderedHtml"></h1>
    <div v-else class="scene-atom tn-atom" :style="atomStyle" v-html="renderedHtml"></div>
  </div>
</template>
