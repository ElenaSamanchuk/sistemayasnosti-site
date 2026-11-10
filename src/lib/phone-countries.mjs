// Страны для поля телефона формы Zero: код, формат номера и флаг-эмодзи. Всё локально, без внешних скриптов.
// Формат: # = цифра национального номера, остальное разделители. Число # в маске = максимум цифр, как у Тильды
// (tilda-phone-mask-1.1, 09.11.2026: сверено по всем 63 странам). Минимум = максимум минус поблажка Тильды для кода страны (DISCOUNT).
// Группировка цифр у остальных стран упрощена до обычной записи номера; RU и ES закреплены тестами.
const DISCOUNT = { 49: 3, 372: 1, 359: 1, 36: 1, 385: 1, 43: 1, 357: 1, 61: 1, 55: 1, 39: 1, 86: 1, 82: 1, 381: 1, 971: 1, 972: 2, 64: 2, 44: 4, 358: 4, 54: 1 };
const RAW = [
  ['RU', 'Россия', '7', '(###) ###-##-##'],
  ['BY', 'Беларусь', '375', '(##)###-##-##'],
  ['KZ', 'Казахстан', '7', '(###) ###-##-##'],
  ['UA', 'Украина', '380', '(##)###-##-##'],
  ['ES', 'Испания', '34', '### ## ## ##'],
  ['DE', 'Германия', '49', '### ### ######'],
  ['FR', 'Франция', '33', '# ## ## ## ##'],
  ['IT', 'Италия', '39', '### ### ####'],
  ['PT', 'Португалия', '351', '### ### ###'],
  ['GB', 'Великобритания', '44', '## #### #####'],
  ['IE', 'Ирландия', '353', '## ### ####'],
  ['NL', 'Нидерланды', '31', '# ########'],
  ['BE', 'Бельгия', '32', '### ## ## ##'],
  ['LU', 'Люксембург', '352', '### ### ###'],
  ['CH', 'Швейцария', '41', '## ### ## ##'],
  ['AT', 'Австрия', '43', '### ########'],
  ['PL', 'Польша', '48', '### ### ###'],
  ['CZ', 'Чехия', '420', '### ### ###'],
  ['SK', 'Словакия', '421', '### ### ###'],
  ['HU', 'Венгрия', '36', '## ### ####'],
  ['RO', 'Румыния', '40', '## ### ####'],
  ['BG', 'Болгария', '359', '### ### ###'],
  ['GR', 'Греция', '30', '### ### ####'],
  ['SE', 'Швеция', '46', '## ### ## ##'],
  ['NO', 'Норвегия', '47', '### ## ###'],
  ['DK', 'Дания', '45', '## ## ## ##'],
  ['FI', 'Финляндия', '358', '### #######'],
  ['EE', 'Эстония', '372', '#### ####'],
  ['LV', 'Латвия', '371', '## ### ###'],
  ['LT', 'Литва', '370', '### #####'],
  ['CY', 'Кипр', '357', '## ######'],
  ['MT', 'Мальта', '356', '#### ####'],
  ['HR', 'Хорватия', '385', '## ### ####'],
  ['SI', 'Словения', '386', '## ### ###'],
  ['RS', 'Сербия', '381', '## ### ####'],
  ['ME', 'Черногория', '382', '## ### ###'],
  ['GE', 'Грузия', '995', '### ## ## ##'],
  ['AM', 'Армения', '374', '## ######'],
  ['AZ', 'Азербайджан', '994', '## ### ## ##'],
  ['MD', 'Молдова', '373', '#### ####'],
  ['UZ', 'Узбекистан', '998', '## ### ## ##'],
  ['KG', 'Киргизия', '996', '### ### ###'],
  ['TJ', 'Таджикистан', '992', '## ### ####'],
  ['TR', 'Турция', '90', '### ### ## ##'],
  ['IL', 'Израиль', '972', '###-###-####'],
  ['AE', 'ОАЭ', '971', '## ### #####'],
  ['EG', 'Египет', '20', '### ### ####'],
  ['MA', 'Марокко', '212', '## ### ####'],
  ['US', 'США', '1', '(###) ###-####'],
  ['CA', 'Канада', '1', '(###) ###-####'],
  ['MX', 'Мексика', '52', '## #### ####'],
  ['BR', 'Бразилия', '55', '## #####-####'],
  ['AR', 'Аргентина', '54', '### ####-####'],
  ['CL', 'Чили', '56', '# #### ####'],
  ['CO', 'Колумбия', '57', '### ### ####'],
  ['AU', 'Австралия', '61', '## #### ####'],
  ['NZ', 'Новая Зеландия', '64', '### ### ####'],
  ['CN', 'Китай', '86', '### #### ####'],
  ['IN', 'Индия', '91', '##### #####'],
  ['JP', 'Япония', '81', '## #### ####'],
  ['KR', 'Южная Корея', '82', '## #### ####'],
  ['TH', 'Таиланд', '66', '## ### ####'],
  ['VN', 'Вьетнам', '84', '## ### ## ##'],
];
export const flag = (iso) => String.fromCodePoint(...[...iso].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
export const countries = RAW.map(([iso, name, code, mask, len]) => {
  const size = [...mask].filter((c) => c === '#').length;
  return { iso, name, code, mask, min: len ? len[0] : size - (DISCOUNT[code] || 0), max: len ? len[1] : size, flag: flag(iso) };
});
// Россия первая и по умолчанию (в снимке li_maskcountry = RU), остальные по алфавиту русских названий
export const sortedCountries = [countries[0], ...countries.slice(1).sort((a, b) => a.name.localeCompare(b.name, 'ru'))];
export const byIso = (iso) => countries.find((c) => c.iso === (iso || 'RU')) || countries[0];
// Цифры национального номера → запись по маске. Разделители ставятся только перед следующей цифрой, чтобы символ можно было стереть.
export function applyMask(country, digits) {
  const body = digits.slice(0, country.max);
  let out = '', used = 0;
  for (const ch of country.mask) {
    if (used >= body.length) break;
    if (ch === '#') out += body[used++]; else out += ch;
  }
  return out + body.slice(used);
}
const gap = (country) => (country.mask.startsWith('(') ? '' : ' ');
export const placeholderFor = (country) => `+${country.code}${gap(country)}${country.mask.replace(/#/g, '0')}`;
// Строка из поля → { country, national, text }. Если введён «+код», страна определяется по самому длинному совпадению.
export function parsePhone(raw, current) {
  const plus = raw.trim().startsWith('+');
  const digits = raw.replace(/\D/g, '');
  if (!digits) return { country: current, national: '', text: plus ? '+' : '' };
  let country = current, national = digits;
  if (plus) {
    if (digits.startsWith(current.code)) national = digits.slice(current.code.length);
    else {
      const match = [...sortedCountries].sort((a, b) => b.code.length - a.code.length || (b.iso === 'US') - (a.iso === 'US')).find((c) => digits.startsWith(c.code));
      if (match) { country = match; national = digits.slice(match.code.length); }
      else return { country: current, national: '', text: `+${digits.slice(0, 15)}` };
    }
  } else if (country.code === '7' && (digits[0] === '7' || digits[0] === '8')) national = digits.slice(1);
  national = national.slice(0, country.max);
  return { country, national, text: `+${country.code}${national ? gap(country) : ''}${applyMask(country, national)}` };
}
export function phoneProblem(country, text) {
  const digits = text.replace(/\D/g, '');
  // Код страны не из списка: как номер международного формата, 8–15 цифр вместе с кодом
  if (!digits.startsWith(country.code)) return digits.length < 8 || digits.length > 15;
  const national = digits.slice(country.code.length);
  return national.length < country.min || national.length > country.max;
}
