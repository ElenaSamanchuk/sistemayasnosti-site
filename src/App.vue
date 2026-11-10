<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import SceneBlock from './components/SceneBlock.vue';
import SiteMenu from './components/SiteMenu.vue';
import EmbedBlock from './components/EmbedBlock.vue';
import { lazyImages } from './lib/lazy-images.mjs';
import { prefixRootUrls, stripBase } from './lib/site-base.mjs';
import { resolveEmbeds } from './lib/embeds.mjs';
import { initSiteIntegrations } from './lib/site-integrations.mjs';
const props = defineProps({ initialPage: Object, initialLayout: Object });
const client = typeof window !== 'undefined';
const page = ref(props.initialPage || null);
const shared = ref(props.initialLayout || null);
const error = ref('');
// Ширина без полосы прокрутки, как у Тильды: иначе при видимой полосе вся сетка уезжает вправо на половину её ширины
const viewportWidth = () => document.documentElement.clientWidth || innerWidth;
const width = ref(client ? viewportWidth() : 1200);
const scrolled = ref(false);
const showTop = ref(false);
const progress = ref(0);
const shell = computed(() => page.value?.shell || {});
const sceneId = (id) => String(id).replace(/^rec/, '');
// Сцена страницы важнее общей: на /audio-club плашка куки чуть отличается от /header
const scene = (id) => page.value?.scenes.find((s) => s.id === sceneId(id)) || shared.value?.scenes.find((s) => s.id === sceneId(id));
const popupScenes = computed(() => (page.value?.popups || []).flatMap((p) => (p.scenes || []).map(sceneId)));
const blocks = computed(() => (page.value?.blocks || []).filter((b) => (b.kind !== 'embed' || embedByRec.value[b.rec]) && !popupScenes.value.includes(b.id)));
const firstScene = computed(() => blocks.value.find((block) => block.kind === 'scene')?.id);
const footerScene = computed(() => (shell.value.footer ? scene(shell.value.footer) : null));
const cookieScene = computed(() => (shell.value.cookie ? scene(shell.value.cookie) : null));
const embeds = computed(() => resolveEmbeds(page.value?.blocks));
// Компоненты встают на своё место в порядке страницы (важно для аудиоклуба, у него есть разметка)
const embedByRec = computed(() => Object.fromEntries(embeds.value.filter((e) => e.zone !== 'footer').map((e) => [e.rec, e])));
const footerEmbeds = computed(() => embeds.value.filter((e) => e.zone === 'footer'));
const backTop = computed(() => shell.value.backTop);
const backTopStyle = computed(() => (backTop.value ? { left: backTop.value.left, bottom: backTop.value.bottom, boxShadow: backTop.value.shadow, '--back-top-hover': backTop.value.hover } : undefined));
function articleHtml(html) { return lazyImages(prefixRootUrls(html || '')); }
const reducedMotion = () => client && matchMedia('(prefers-reduced-motion: reduce)').matches;
const popup = ref(null);
const popupDuration = computed(() => (reducedMotion() ? 0 : { enter: 600, leave: 350 }));
const dialogScenes = computed(() => (popup.value?.scenes || []).map((id) => scene(id)).filter(Boolean));
const findPopup = (hash) => (page.value?.popups || []).find((p) => p.hook === hash);
// Попап без содержимого (у #zeropopupmain записи в снимке нет) не показываем, кнопка остаётся без действия
const popupReady = (item) => !!item && (item.scenes || []).some((id) => scene(id));
let previousFocus = null;
let keyboardFocus = false;
function closeButton() { return document.querySelector('.popup-close'); }
function openPopup(item) {
  previousFocus = document.activeElement;
  popup.value = item;
  document.body.style.overflow = 'hidden';
  nextTick(() => closeButton()?.focus({ preventScroll: true, focusVisible: keyboardFocus }));
}
function resetPopup() {
  popup.value = null;
  document.body.style.overflow = '';
  previousFocus?.focus?.({ preventScroll: true, focusVisible: keyboardFocus });
  previousFocus = null;
}
function closePopup() {
  if (!popup.value) return;
  const owned = history.state?.syaPopup;
  resetPopup();
  if (owned) history.back();
  else if (findPopup(location.hash)) history.replaceState(history.state, '', location.pathname + location.search);
}
function modalClick(event) {
  if (event.target.closest('.scene-node,.scene-group,.popup-close')) return;
  closePopup();
}
function onKey(event) {
  if (event.key === 'Tab') keyboardFocus = true;
  if (!popup.value) return;
  if (event.key === 'Escape') { closePopup(); return; }
  if (event.key !== 'Tab') return;
  const root = document.querySelector('.native-modal');
  const items = [...root.querySelectorAll('button,a[href],input,textarea,select')].filter((x) => !x.disabled && x.getClientRects().length);
  if (!items.length) return;
  const first = items[0], last = items[items.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
function onPopState() {
  const item = findPopup(location.hash);
  if (popup.value && !item) resetPopup();
  else if (!popup.value && popupReady(item)) openPopup(item);
}
function onScroll() {
  const y = window.scrollY;
  scrolled.value = y > 20;
  // На телефоне у самого низа стрелка закрывала бы ссылки документов в футере; справа нельзя, там кнопка чата Kommo
  const atFooterEnd = innerWidth <= 640 && y + innerHeight >= document.documentElement.scrollHeight - 140;
  showTop.value = y > innerHeight && !atFooterEnd;
  const total = document.body.clientHeight - innerHeight;
  progress.value = total > 0 ? Math.min(100, (y / total) * 100) : 0;
}
function onResize() { width.value = viewportWidth(); onScroll(); }
// Полоса прокрутки появляется после загрузки контента, событие resize окна при этом не приходит
let widthObserver = null;
function watchViewportWidth() {
  if (typeof ResizeObserver === 'undefined') return;
  widthObserver = new ResizeObserver(() => { if (width.value !== viewportWidth()) width.value = viewportWidth(); });
  widthObserver.observe(document.documentElement);
}
function toTop() { window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); }
function anchorTarget(hash) {
  const anchor = page.value?.anchors?.find((a) => `#${a.name}` === hash);
  let id; try { id = decodeURIComponent(hash.slice(1)); } catch { id = hash.slice(1); }
  return document.getElementById(anchor ? `rec${anchor.scene}` : id);
}
function scrollToAnchor(target, behavior) {
  const top = target.getBoundingClientRect().top + window.scrollY - (shell.value.anchorOffset || 0);
  window.scrollTo({ top: Math.max(0, top), behavior });
}
function click(event) {
  const a = event.target.closest('a[href]');
  if (!a) return;
  const href = a.getAttribute('href');
  if (!href.startsWith('#') || href.length < 2) return;
  const item = findPopup(href);
  if (item) {
    event.preventDefault();
    if (!popupReady(item)) return;
    if (location.hash !== href) history.pushState({ ...history.state, syaPopup: true }, '', href);
    openPopup(item);
    return;
  }
  const target = anchorTarget(href);
  if (target) {
    event.preventDefault();
    history.pushState(null, '', href);
    scrollToAnchor(target, matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth');
  }
}
onMounted(async () => {
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onResize);
  addEventListener('keydown', onKey);
  addEventListener('popstate', onPopState);
  onResize();
  watchViewportWidth();
  if (!page.value) {
    // Режим разработки (vite): готовой статики нет, модель берём из public/content
    try {
      const here = stripBase(location.pathname);
      const routes = await fetch('/content/routes.json').then((r) => r.json());
      const route = routes.find((r) => r.path === here);
      if (!route) { error.value = 'Страница не найдена'; return; }
      for (const file of ['shared-layout.css', 'shared-layout-layout.css', `${route.page}.css`, `${route.page}-layout.css`]) {
        const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = `/content/${file}`; document.head.append(link);
      }
      shared.value = await fetch('/content/shared-layout.json').then((r) => r.json());
      page.value = await fetch(`/content/${route.page}.json`).then((r) => r.json());
      document.title = page.value.title;
      if (page.value.shell?.background) document.body.style.backgroundColor = page.value.shell.background;
    } catch (e) { error.value = 'Не удалось загрузить страницу'; console.error(e); return; }
  }
  initSiteIntegrations();
  if (location.hash.length > 1) {
    const item = findPopup(location.hash);
    if (popupReady(item)) openPopup(item);
    else if (!item) { const target = anchorTarget(location.hash); if (target) scrollToAnchor(target, 'instant'); }
  }
});
onUnmounted(() => { removeEventListener('scroll', onScroll); removeEventListener('resize', onResize); removeEventListener('keydown', onKey); removeEventListener('popstate', onPopState); });
</script>
<template>
  <div v-if="error" class="p-10"><h1>{{ error }}</h1><a href="/">На главную</a></div>
  <div v-else-if="page" @click="click">
    <div v-if="shell.scrollIndicator" class="scroll-indicator" :style="{ width: `${progress}%`, background: shell.scrollIndicator.color }"></div>
    <SiteMenu v-if="shell.menu" :menu="shell.menu" :path="page.path" :scrolled="scrolled" />
    <main>
      <!-- Заголовок страницы, который рисует подключаемый компонент (аудиоклуб): в статической странице стоит скрытый h1 для поисковиков, в браузере остаётся один h1 компонента -->
      <h1 v-if="page.h1Embedded && !client" class="visually-hidden">{{ page.h1Embedded }}</h1>
      <template v-for="block in blocks" :key="block.id">
        <SceneBlock v-if="block.kind === 'scene' && scene(block.id)" :scene="scene(block.id)" :width="width" :eager="block.id === firstScene" />
        <article v-else-if="block.kind === 'article'" class="native-article" :id="`rec${block.id}`" :style="block.style"><div v-html="articleHtml(block.html)"></div></article>
        <div v-else-if="block.kind === 'spacer'" class="native-spacer" :id="`rec${block.id}`" :style="block.style" aria-hidden="true"></div>
        <span v-else-if="block.kind === 'anchor'" :id="`rec${block.id}`"></span>
        <EmbedBlock v-else-if="block.kind === 'embed'" :entry="embedByRec[block.rec].entry" :rec="block.rec" />
      </template>
    </main>
    <footer v-if="footerScene" lang="ru"><SceneBlock :scene="footerScene" :width="width" /></footer>
    <aside v-if="cookieScene" class="native-cookie"><SceneBlock :scene="cookieScene" :width="width" eager skip-reveal /></aside>
    <EmbedBlock v-for="item in footerEmbeds" :key="item.rec" :entry="item.entry" :rec="item.rec" />
    <Transition name="soft-fade"><button v-if="backTop && showTop" type="button" class="back-top" aria-label="Вернуться к началу страницы" :style="backTopStyle" @click="toTop" v-html="backTop.svg"></button></Transition>
    <Transition name="popup-rise" :duration="popupDuration">
      <div v-if="popup" class="native-modal" @click="modalClick">
        <div class="native-modal__bg" aria-hidden="true"></div>
        <section class="native-dialog" role="dialog" aria-modal="true" aria-label="Форма" :data-popup-hook="popup.hook">
          <SceneBlock v-for="item in dialogScenes" :key="item.id" :scene="item" :width="width" eager skip-reveal />
        </section>
        <button type="button" class="popup-close" aria-label="Закрыть диалоговое окно" @click="closePopup">
          <svg width="23" height="23" viewBox="0 0 23 23" role="presentation" xmlns="http://www.w3.org/2000/svg"><g fill="#1d1d1d" fill-rule="evenodd"><rect transform="translate(11.313708, 11.313708) rotate(-45) translate(-11.313708, -11.313708)" x="10.3137085" y="-3.6862915" width="2" height="30"></rect><rect transform="translate(11.313708, 11.313708) rotate(-315) translate(-11.313708, -11.313708)" x="10.3137085" y="-3.6862915" width="2" height="30"></rect></g></svg>
        </button>
      </div>
    </Transition>
  </div>
</template>
