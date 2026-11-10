<script setup>
// Меню T228: панель на десктопе, бургер на телефоне. Данные — из записи 257 (normalize_export.menu_model).
import { computed, ref, watch } from 'vue';
import { localLink, linkTarget } from '../lib/scene.mjs';
import { withBase } from '../lib/site-base.mjs';
const props = defineProps({ menu: Object, path: String, scrolled: Boolean });
const open = ref(false);
const vars = computed(() => ({
  '--menu-height': `${props.menu.height}px`,
  '--menu-item-size': props.menu.itemStyle.fontSize,
  '--menu-item-color': props.menu.itemStyle.color,
  '--menu-item-weight': props.menu.itemStyle.fontWeight,
  '--menu-item-hover': props.menu.itemStyle.hoverColor || props.menu.itemStyle.color,
  '--menu-burger': props.menu.burgerColor,
}));
const barStyle = computed(() => ({ backgroundColor: props.scrolled ? props.menu.backgroundScrolled : props.menu.background }));
const button = computed(() => props.menu.button);
const buttonStyle = computed(() => (button.value ? { color: button.value.color, backgroundImage: button.value.background, borderRadius: button.value.radius, fontWeight: button.value.fontWeight, fontSize: button.value.fontSize } : undefined));
// На главной пункт ведёт на якорь #home страницы, поэтому сравнение адресов его не находит (на живом он тоже активен)
const isActive = (href) => localLink(href) === withBase(props.path) || (href === '#home' && props.path === '/');
function close() { open.value = false; }
function onKey(event) { if (event.key === 'Escape') close(); }
if (typeof window !== 'undefined') watch(open, (value) => { if (value) addEventListener('keydown', onKey); else removeEventListener('keydown', onKey); });
</script>
<template>
  <header lang="ru" class="site-header" :id="`rec${menu.rec}`" :style="vars">
    <div class="site-bar">
      <a class="site-bar__logo" :href="withBase(menu.logo.href)" aria-label="На главную"><img :src="withBase(menu.logo.src)" alt="" :style="{ width: `${menu.logo.width}px` }" /></a>
      <button type="button" class="site-burger" :class="{ 'is-open': open }" :aria-expanded="open" aria-label="Навигационное меню" @click="open = !open"><span></span><span></span><span></span><span></span></button>
    </div>
    <div class="site-nav" :id="`nav${menu.rec}`" :class="{ 'is-open': open, 'site-nav--home': path === '/' }" :style="barStyle">
      <div class="site-nav__inner">
        <a class="site-nav__logo" :href="withBase(menu.logo.href)" aria-label="На главную"><img :src="withBase(menu.logo.src)" alt="" :style="{ width: `${menu.logo.width}px`, minWidth: `${menu.logo.width}px` }" /></a>
        <nav class="site-nav__center" aria-label="Основное меню">
          <ul class="site-nav__list" role="list">
            <li v-for="item in menu.items" :key="item.href + item.text"><a class="site-nav__link" :class="{ 'is-active': isActive(item.href) }" :aria-current="isActive(item.href) ? 'page' : undefined" :href="localLink(item.href)" :target="linkTarget(item.href)" :rel="linkTarget(item.href) ? 'noopener noreferrer' : undefined" @click="close">{{ item.text }}</a></li>
          </ul>
        </nav>
        <div v-if="button" class="site-nav__right"><a class="site-nav__button" :href="localLink(button.href)" :target="linkTarget(button.href)" :rel="linkTarget(button.href) ? 'noopener noreferrer' : undefined" :style="buttonStyle" @click="close">{{ button.text }}</a></div>
      </div>
    </div>
  </header>
</template>
<style>
.site-header{position:relative;z-index:2000}
.site-bar{display:none}
.site-nav{position:fixed;top:0;left:0;width:100%;height:var(--menu-height);z-index:2000;transition:background-color .3s linear;-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}
.site-nav__inner{box-sizing:border-box;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;max-width:1200px;height:100%;margin:0 auto;padding:0 20px}
.site-nav__logo img{display:block;height:auto;margin-right:30px}
/* На живом T228 логотип и пункты стоят выше геометрического центра панели */
.site-nav__logo{position:relative;top:-2px}
.site-nav__center{position:relative;top:-1px}
.site-nav__center{text-align:center}
.site-nav__list{display:inline-flex;gap:30px;margin:0;padding:0;list-style:none}
.site-nav__link{font-family:var(--font-ui),Arial,sans-serif;font-size:var(--menu-item-size);font-weight:var(--menu-item-weight);color:var(--menu-item-color);white-space:nowrap;text-decoration:none;transition:color .3s ease-in-out,opacity .3s ease-in-out}
.site-nav__link.is-active{color:var(--menu-item-hover)}
/* Прозрачность пунктов как на живом (замер 10.11, ширины 981–1440): на главной остальные 0,9, на других страницах активный 0,7 */
@media (min-width:981px){.site-nav--home .site-nav__link:not(.is-active){opacity:.9}.site-nav:not(.site-nav--home) .site-nav__link.is-active{opacity:.7}}
.site-nav__link:focus-visible{color:var(--menu-item-hover)}
@media (hover:hover){.site-nav__link:hover{color:var(--menu-item-hover)}}
.site-nav__logo{justify-self:start}
.site-nav__right{justify-self:end;margin-left:25px}
.site-nav__button{display:inline-flex;align-items:center;justify-content:center;height:40px;box-sizing:border-box;padding:0 30px;font-family:var(--font-ui),Arial,sans-serif;line-height:1.4;white-space:nowrap;text-decoration:none;transition:opacity .2s ease-in-out}
@media (hover:hover){.site-nav__button:hover{opacity:.85}}
.site-burger{position:relative;flex-shrink:0;width:22px;height:14px;padding:0;border:0;background:transparent;cursor:pointer}
.site-burger span{position:absolute;left:0;display:block;width:100%;height:2px;background-color:var(--menu-burger);transition:.25s ease-in-out}
.site-burger span:nth-child(1){top:0}
.site-burger span:nth-child(2),.site-burger span:nth-child(3){top:6px}
.site-burger span:nth-child(4){top:12px}
.site-burger.is-open span:nth-child(1),.site-burger.is-open span:nth-child(4){top:6px;width:0;left:50%}
.site-burger.is-open span:nth-child(2){transform:rotate(45deg)}
.site-burger.is-open span:nth-child(3){transform:rotate(-45deg)}
@media screen and (max-width:1200px){.site-nav__logo img{margin-right:15px}.site-nav__button{padding:0 25px}}
@media screen and (max-width:980px){
  .site-bar{position:fixed;top:0;left:0;width:100%;z-index:2001;box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;min-height:64px;padding:20px;background-color:#f5f4f2}
  .site-bar__logo img{display:block;height:auto}
  .site-nav{top:64px;height:auto;visibility:hidden;opacity:0;pointer-events:none;text-align:center;transition:opacity .3s ease-in-out,visibility 0s linear .3s}
  .site-nav.is-open{visibility:visible;opacity:1;pointer-events:auto;transition:opacity .3s ease-in-out}
  .site-nav__inner{display:block;height:auto;max-width:none;padding:0}
  .site-nav__logo{display:none}
  .site-nav__center{padding:20px 0}
  .site-nav__list{display:block}
  /* Открытый бургер как на живом T228 (замер 390 и 360): пункт 35 px, блок кнопки 80 px, поля кнопки 20 px */
  .site-nav__list li{padding:10px;white-space:normal;line-height:15px}
  .site-nav__link{display:inline-block;vertical-align:top;white-space:normal;line-height:15px}
  .site-nav__right{justify-self:auto;margin:0;padding:20px}
  .site-nav__button{padding:0 20px}
  .site-nav__logo,.site-nav__center{top:0}
}
/* Прозрачная панель с размытием до 960 px: T123 rec1491047173 (rec1488865263 на главной) */
@media (max-width:960px){
  .site-bar{min-height:50px;height:50px;padding:10px 15px;background:#f5f4f280;-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}
  .site-bar__logo img{width:25px!important;height:25px}
  .site-nav{top:50px;background:#f5f4f280!important}
}
@media (prefers-reduced-motion:reduce){.site-nav,.site-nav.is-open,.site-burger span,.site-nav__link{transition:none}}
</style>
