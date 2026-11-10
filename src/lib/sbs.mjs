// Покадровые анимации Zero (scroll и blockintoview). Данные из снимка, логика расчёта повторяет поведение Тильды:
// до нужной ширины подбираются свои кадры, при scroll элемент закрепляется на экране на заданную дистанцию.
// При prefers-reduced-motion ничего не запускается: элементы остаются на своих местах.
import { screenFor } from './scene.mjs';

const items = new Set();
let frame = 0;
let listening = false;

function reducedMotion() { return matchMedia('(prefers-reduced-motion: reduce)').matches; }
function currentRes() { return screenFor(innerWidth); }
const BREAKPOINTS = [320, 480, 640, 960];

// Как t_animationSBS__getAnimOptions: на верхней ширине — основное значение, ниже — своё, затем ближайшее большее, затем основное.
export function pickForRes(map, res, mobile) {
  if (!map) return undefined;
  if (res >= 1200) return map.base;
  if (!mobile) return undefined;
  if (map[res] !== undefined) return map[res];
  for (const point of BREAKPOINTS) if (point > res && map[point] !== undefined) return map[point];
  return map.base;
}

const num = (value, fallback = 0) => { const n = Number(value); return Number.isFinite(n) ? n : fallback; };

// Стили кадра для прокрутки: pos — положение прокрутки с учётом смещения триггера
export function scrollFrame(steps, pos, zoom) {
  const r = { opacity: 1, fix: false, fixedShiftY: 0, translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotate: 0, prevUnfixedDist: 0 };
  const apply = (step, progress, started) => {
    if (step.fixed && started) { r.fix = true; r.fixedShiftY = 0; }
    if (step.fixed && !started) { r.fix = false; r.fixedShiftY += step.dist / zoom; }
    r.opacity += progress * (step.op - r.opacity);
    r.translateX += progress * step.mx;
    r.translateY += progress * step.my;
    r.scaleX += progress * (step.sx - r.scaleX);
    r.scaleY += progress * (step.sy - r.scaleY);
    r.rotate += progress * step.ro;
  };
  for (const step of steps) {
    if (pos >= step.end) apply(step, 1, false);
    else if (pos >= step.start) { r.prevUnfixedDist = step.prevUnfixedDist; apply(step, step.dist === 0 ? 1 : (pos - step.start) / step.dist, true); }
  }
  return r;
}

function targetOf(element) { return element.querySelector(':scope > .scene-group-inner, :scope > .scene-atom'); }
function localTop(element, canvas) {
  let sum = 0;
  for (let node = element; node && node !== canvas; node = node.parentElement) {
    if (node.dataset?.node === undefined) continue;
    const value = parseFloat(getComputedStyle(node).top);
    if (Number.isFinite(value)) sum += value;
  }
  return sum;
}
function clearScroll(item) {
  const s = item.target.style;
  s.position = ''; s.top = ''; s.width = ''; s.height = ''; s.opacity = ''; s.transform = ''; s.willChange = '';
  item.fixed = false;
}
function measure(item) {
  const canvas = item.element.closest('.scene-canvas');
  item.steps = null;
  if (!canvas || !canvas.getClientRects().length) return;
  const res = currentRes();
  const raw = pickForRes(item.value.opts, res, item.value.mobile);
  if (!Array.isArray(raw)) return;
  const zoom = parseFloat(getComputedStyle(canvas).getPropertyValue('--scene-scale')) || 1;
  const top = canvas.getBoundingClientRect().top + scrollY + localTop(item.element, canvas) * zoom;
  const offset = num(pickForRes(item.value.offset, res, item.value.mobile)) * zoom;
  const trigger = item.value.trigger;
  item.zoom = zoom;
  item.triggerOffset = offset + (trigger === 0.5 || trigger === 1 ? innerHeight * trigger : 0);
  const style = getComputedStyle(item.element);
  item.width = style.width; item.height = style.height;
  let unfixed = 0, cursor = top;
  item.steps = raw.map((step) => {
    const dist = num(step.di) * zoom, fixed = step.fi === 'fixed';
    const model = { start: cursor, end: cursor + dist, dist, fixed, prevUnfixedDist: unfixed, op: num(step.op, 1), mx: num(step.mx), my: num(step.my), sx: num(step.sx, 1), sy: num(step.sy, 1), ro: num(step.ro) };
    if (!fixed) unfixed += dist;
    cursor = model.end;
    return model;
  });
}
function paint(item) {
  if (!item.steps) { if (item.fixed || item.target.style.opacity) clearScroll(item); return; }
  const f = scrollFrame(item.steps, scrollY + item.triggerOffset, item.zoom);
  const s = item.target.style;
  if (f.fix && !item.fixed) {
    s.top = `${(item.triggerOffset - f.prevUnfixedDist) / item.zoom}px`;
    s.width = item.width; s.height = item.height; s.position = 'fixed'; s.willChange = 'transform';
    item.fixed = true;
  } else if (!f.fix && item.fixed) {
    s.position = ''; s.top = ''; s.width = ''; s.height = ''; s.willChange = '';
    item.fixed = false;
  }
  s.opacity = String(f.opacity);
  let transform = '';
  if (f.translateX) transform += `translateX(${f.translateX.toFixed(2)}px)`;
  if (f.translateY || f.fixedShiftY) transform += `translateY(${(f.translateY + f.fixedShiftY).toFixed(2)}px)`;
  if (f.scaleX !== 1 || f.scaleY !== 1) transform += `scale(${f.scaleX},${f.scaleY})`;
  if (f.rotate) transform += `rotate(${f.rotate}deg)`;
  s.transform = transform;
}

function timedFrames(steps) {
  let time = 0;
  const points = [];
  const state = (step) => ({ opacity: num(step.op, 1), transform: `translate(${num(step.mx)}px,${num(step.my)}px) scale(${num(step.sx, 1)},${num(step.sy, 1)}) rotate(${num(step.ro)}deg)` });
  steps.forEach((step, index) => {
    const delay = num(step.dt), duration = num(step.ti);
    if (delay && index) { time += delay; points.push({ time, ...state(steps[index - 1]) }); }
    time += duration;
    points.push({ time, ...state(step) });
  });
  const total = time;
  if (!(total > 0)) return null;
  return { duration: total, frames: points.map(({ time: t, ...rest }) => ({ ...rest, offset: t / total, easing: 'linear' })) };
}
function stopTimed(item) { item.observer?.disconnect(); item.observer = null; item.animation?.cancel(); item.animation = null; }
function startTimed(item) {
  stopTimed(item);
  const raw = pickForRes(item.value.opts, currentRes(), item.value.mobile);
  if (!Array.isArray(raw) || !item.element.getClientRects().length) return;
  const timed = timedFrames(raw);
  if (!timed) return;
  const loop = String(item.value.loop || '').includes('loop');
  item.animation = item.target.animate(timed.frames, { duration: timed.duration, iterations: loop ? Infinity : 1, fill: loop ? 'none' : 'both' });
  item.animation.pause();
  const block = item.element.closest('.scene-rec') || item.element;
  item.observer = new IntersectionObserver((entries) => {
    const visible = entries.some((entry) => entry.isIntersecting);
    if (visible) item.animation?.play(); else item.animation?.pause();
  }, { threshold: 0 });
  item.observer.observe(block);
}

function schedule() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    for (const item of items) if (item.value.event === 'scroll') paint(item);
  });
}
function refresh() {
  for (const item of items) {
    if (item.value.event === 'scroll') { const wasFixed = item.fixed; if (wasFixed) clearScroll(item); measure(item); paint(item); }
    else startTimed(item);
  }
}
function listen() {
  if (listening) return;
  listening = true;
  addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', refresh);
  addEventListener('load', refresh);
}

export const sbs = {
  mounted(element, { value }) {
    if (!value || reducedMotion() || typeof element.animate !== 'function' || typeof IntersectionObserver === 'undefined') return;
    const target = targetOf(element);
    if (!target) return;
    const item = { element, target, value, fixed: false, steps: null, zoom: 1, triggerOffset: 0, animation: null, observer: null };
    items.add(item);
    element.__sbs = item;
    listen();
    if (value.event === 'scroll') { measure(item); paint(item); }
    else startTimed(item);
  },
  unmounted(element) {
    const item = element.__sbs;
    if (!item) return;
    items.delete(item);
    stopTimed(item);
    clearScroll(item);
    delete element.__sbs;
  },
};
