<script setup>
// Форма Zero: внешний вид и проверка полей как на живом сайте. Реальной отправки нет, запросы в сеть не уходят, данные нигде не сохраняются.
// Решение Елены 10.11.2026: на любом адресе, включая боевой домен, форма показывает успешную отправку текстом Тильды.
// Настоящий получатель заявок не подключён, заявки никуда не уходят.
import { computed, nextTick, onBeforeUnmount, reactive, ref } from 'vue';
import { byIso, parsePhone, phoneProblem, placeholderFor, sortedCountries } from '../lib/phone-countries.mjs';
import { field } from '../lib/scene.mjs';
const props = defineProps({ node: Object, screen: Number });
const get = (key) => field(props.node.fields, key, props.screen);
const inputs = computed(() => props.node.inputs || []);
const px = (value) => (value === undefined || value === '' ? undefined : `${value}px`);
const inputStyle = computed(() => ({ fontFamily: get('inputfontfamily'), fontSize: px(get('inputfontsize')), fontWeight: get('inputfontweight'), color: get('inputcolor'), background: get('inputbgcolor'), borderRadius: px(get('inputradius')), height: px(get('inputheight')) }));
const rowStyle = computed(() => ({ marginBottom: px(get('inputmargbottom')) }));
const buttonStyle = computed(() => ({ '--form-hover': get('buttonhoverbgcolor'), color: get('buttoncolor'), backgroundImage: get('buttonbgcolor'), width: px(get('buttonwidth')), height: px(get('buttonheight')), borderRadius: px(get('buttonradius')), fontFamily: get('buttonfontfamily'), fontSize: px(get('buttonfontsize')), fontWeight: get('buttonfontweight') }));
// Сообщение занимает ровно место формы, чтобы не наезжать на текст под ней
const doneStyle = computed(() => { const size = Number(get('inputfontsize')) || 16; return { fontFamily: get('inputfontfamily'), color: get('inputcolor'), fontSize: `${size}px`, height: `${inputs.value.length * (Number(get('inputheight')) + Number(get('inputmargbottom'))) + Number(get('buttonheight'))}px` }; });
const values = reactive({});
const errors = reactive({});
const summary = ref('');
const done = ref(false);
const sending = ref(false);
let sendTimer = 0;
const inputType = (type) => ({ em: 'email', ph: 'tel' }[type] || 'text');
const inputMode = (type) => (type === 'ph' ? 'tel' : undefined);
const nameAttr = (input) => input.li_nm;
// Выбор страны в поле телефона, как на живом сайте (li_masktype = a, страна по умолчанию li_maskcountry из снимка)
const hasCountry = (input) => input.li_type === 'ph' && input.li_masktype === 'a';
const countryOf = reactive({});
const countryFor = (input) => countryOf[input.li_nm] || byIso(input.li_maskcountry);
// Живая форма показывает в телефоне маску страны, текст подсказки из настроек при этом не виден
const placeholder = (input) => (hasCountry(input) ? placeholderFor(countryFor(input)) : input.li_ph);
const ariaLabel = (input) => input.li_ph || input.li_title || input.li_nm;
function onInput(input, event) {
  if (hasCountry(input)) { const parsed = parsePhone(event.target.value, countryFor(input)); countryOf[input.li_nm] = parsed.country; event.target.value = parsed.text; values[input.li_nm] = parsed.text; }
  else if (input.li_type === 'ph') values[input.li_nm] = event.target.value;
  else values[input.li_nm] = event.target.value;
  if (errors[input.li_nm]) { delete errors[input.li_nm]; if (!Object.keys(errors).length) summary.value = ''; }
}
function validate(input) {
  const value = (values[input.li_nm] || '').trim();
  const bare = hasCountry(input) && value.replace(/\D/g, '') === countryFor(input).code; // выбрана страна, номер не введён
  if (!value || bare) return input.li_req === 'y' ? 'Обязательное поле' : '';
  if (input.li_type === 'ph') {
    if (hasCountry(input) ? phoneProblem(countryFor(input), value) : value.replace(/\D/g, '').length < 10) return 'Укажите, пожалуйста, корректный номер телефона';
  }
  if (input.li_type === 'em' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'Укажите, пожалуйста, корректный email';
  if (input.li_type === 'nm' && !/^[\p{L}\p{M}][\p{L}\p{M}\s.'’-]*$/u.test(value)) return 'Укажите, пожалуйста, имя';
  return '';
}
function submit(event) {
  if (sending.value) return;
  let first = null, required = false;
  for (const input of inputs.value) {
    const message = validate(input);
    if (message) { errors[input.li_nm] = message; if (message === 'Обязательное поле') required = true; first ??= input.li_nm; }
    else delete errors[input.li_nm];
  }
  if (first) {
    summary.value = required ? 'Пожалуйста, заполните все обязательные поля' : errors[first];
    event.target.querySelector(`[name="${first}"]`)?.focus();
    return;
  }
  summary.value = '';
  sending.value = true;
  sendTimer = setTimeout(() => { sending.value = false; done.value = true; }, 700);
}
// Список стран: кнопка с флагом слева в поле, список под полем. Esc закрывает только список, стрелки и буквы ходят по строкам.
const openFor = ref('');
const rowRefs = {};
let typed = '', typedAt = 0;
function onOutside(event) { if (!event.target.closest?.('.zero-form__phone')) closeList(); }
function closeList(refocus) {
  const name = openFor.value; openFor.value = '';
  document.removeEventListener('pointerdown', onOutside, true);
  if (refocus && name) rowRefs[name]?.querySelector('.zero-form__country')?.focus();
}
function toggleList(input) {
  if (openFor.value === input.li_nm) return closeList(true);
  openFor.value = input.li_nm;
  document.addEventListener('pointerdown', onOutside, true);
  nextTick(() => { const list = rowRefs[input.li_nm]?.querySelector('.zero-form__countries'); const active = list?.querySelector('[aria-selected="true"]'); active?.focus({ preventScroll: true }); if (list && active) list.scrollTop = Math.max(0, active.offsetTop - list.clientHeight / 2); });
}
function pickCountry(input, country) {
  const name = input.li_nm;
  const national = (values[name] || '').replace(/\D/g, '').slice(countryFor(input).code.length); // введённые цифры сохраняются
  const parsed = parsePhone(`+${country.code}${national}`, country);
  countryOf[name] = country; values[name] = parsed.text; delete errors[name];
  closeList(); nextTick(() => rowRefs[name]?.querySelector('.zero-form__input')?.focus());
}
function listKey(input, event) {
  const items = [...event.currentTarget.querySelectorAll('[role="option"]')];
  const at = items.indexOf(document.activeElement);
  const go = (i) => { event.preventDefault(); items[Math.max(0, Math.min(items.length - 1, i))]?.focus(); };
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeList(true); }
  else if (event.key === 'ArrowDown') go(at + 1);
  else if (event.key === 'ArrowUp') go(at - 1);
  else if (event.key === 'Home') go(0);
  else if (event.key === 'End') go(items.length - 1);
  else if (event.key === 'Tab') closeList();
  else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && event.key !== ' ') {
    const now = Date.now(); typed = now - typedAt > 700 ? event.key.toLowerCase() : typed + event.key.toLowerCase(); typedAt = now;
    const hit = items.findIndex((el) => el.dataset.name.toLowerCase().startsWith(typed)); if (hit >= 0) go(hit);
  }
}
onBeforeUnmount(() => { document.removeEventListener('pointerdown', onOutside, true); clearTimeout(sendTimer); });
</script>
<template>
  <Transition name="soft-fade" mode="out-in">
  <form v-if="!done" class="zero-form" novalidate @submit.prevent="submit">
    <div v-for="input in inputs" :key="input.li_nm" :ref="(el) => { rowRefs[input.li_nm] = el; }" class="zero-form__row" :class="{ 'zero-form__phone': hasCountry(input) }" :style="rowStyle">
      <button v-if="hasCountry(input)" type="button" class="zero-form__country" :style="{ color: inputStyle.color }" aria-haspopup="listbox" :aria-expanded="openFor === input.li_nm ? 'true' : 'false'" :aria-label="`Страна: ${countryFor(input).name}, код +${countryFor(input).code}`" @click="toggleList(input)"><span class="zero-form__flag" aria-hidden="true">{{ countryFor(input).flag }}</span><span class="zero-form__caret" aria-hidden="true"></span></button>
      <Transition name="soft-fade"><ul v-if="hasCountry(input) && openFor === input.li_nm" class="zero-form__countries" role="listbox" aria-label="Выбор страны" @keydown="listKey(input, $event)">
        <li v-for="country in sortedCountries" :key="country.iso" role="option" tabindex="-1" class="zero-form__option" :data-name="country.name" :aria-selected="country.iso === countryFor(input).iso ? 'true' : 'false'" @click.stop="pickCountry(input, country)" @keydown.enter.prevent="pickCountry(input, country)" @keydown.space.prevent="pickCountry(input, country)"><span class="zero-form__flag" aria-hidden="true">{{ country.flag }}</span><span class="zero-form__country-name">{{ country.name }}</span><span class="zero-form__code">+{{ country.code }}</span></li>
      </ul></Transition>
      <input class="zero-form__input" :class="{ 'zero-form__input--country': hasCountry(input) }" :name="nameAttr(input)" :type="inputType(input.li_type)" :inputmode="inputMode(input.li_type)" :placeholder="placeholder(input)" :aria-label="ariaLabel(input)" :aria-invalid="errors[input.li_nm] ? 'true' : undefined" :style="inputStyle" :value="values[input.li_nm] || ''" autocomplete="off" @input="onInput(input, $event)">
      <Transition name="soft-fade"><p v-if="errors[input.li_nm]" class="zero-form__error">{{ errors[input.li_nm] }}</p></Transition>
    </div>
    <button class="zero-form__submit" type="submit" :style="buttonStyle" :disabled="sending" :aria-busy="sending"><span>{{ sending ? 'Отправка...' : (get('buttontitle') || 'Отправить') }}</span></button>
    <Transition name="soft-fade"><div v-if="summary" class="zero-form__summary" role="alert">{{ summary }}</div></Transition>
  </form>
  <div v-else class="zero-form__done" role="status" :style="doneStyle">
    <p class="zero-form__done-title">Спасибо!</p><p>Данные успешно отправлены.</p>
  </div>
  </Transition>
</template>
