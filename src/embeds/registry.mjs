// Реестр встроенных блоков Тильды (T123) sistemayasnosti.com. Ровно 33 уникальных rec id (снимок 09.11.2026).
// Формат записи:
//   { kind: 'component', load: () => import('./X.vue'), props?: {...}, note?: '...' }  монтировать компонент на месте блока
//   { kind: 'global', name: 'metrika' | 'kommo' }  запуск из src/lib/site-integrations.mjs (runGlobal(name)), один раз на загрузку
//   { kind: 'skip', reason: '...', cosmetic?: true }  блок не переносится как код; cosmetic: правку учесть в стилях (см. README)
// props передаются компоненту как есть. Дубли блоков с разными id ведут на один компонент. Один компонент на страницу:
// если на странице несколько записей component с одним load и одинаковыми props, монтировать один раз.

const hscroll = (targets) => ({ kind: 'component', load: () => import('./HorizontalDragScroll.vue'), props: { targets } })
const cookie = { kind: 'component', load: () => import('./CookieConsent.vue') }
const smooth = {
  kind: 'skip',
  reason:
    'SmoothScroll с cdnjs: внешний CDN нельзя, и нужна ли плавная прокрутка вообще, решает Елена (вопрос 3 в T123-INVENTORY). По умолчанию не включаем.',
}
const videoPos = (sel) => ({
  kind: 'skip',
  cosmetic: true,
  reason: `Косметика Тильды: object-position: 36% 50% для видео ${sel}. Одно CSS-правило на видео в новой вёрстке.`,
})
const shine = (elem) => ({
  kind: 'skip',
  cosmetic: true,
  reason: `Косметика Тильды: блик на кнопке (.light) для элемента ${elem}. Один CSS-класс кнопки, текст в src/embeds/README.md.`,
})
const menuBlur = (nav) => ({
  kind: 'skip',
  cosmetic: true,
  reason: `Косметика Тильды: размытие фона меню (#${nav}) и полупрозрачная панель до 960 px. Входит в общую шапку, правила в src/embeds/README.md.`,
})
const clubCss = (month) => ({
  kind: 'skip',
  reason: `Часть аудиоклуба (${month}): стили и шрифты. Подключаются внутри компонента AudioClub из public/embeds/audio-club/${month}/club.css.`,
})
const clubJs = (month) => ({
  kind: 'skip',
  reason: `Часть аудиоклуба (${month}): JS приложения. Подключается внутри компонента AudioClub из public/embeds/audio-club/${month}/club.js.`,
})
const clubMount = (month) => ({
  kind: 'component',
  load: () => import('./AudioClub.vue'),
  reserve: true, // страница клуба пуста до загрузки компонента: место держит правило .embed-reserve в style.css
  props: { variant: month },
  note: 'Точка монтирования аудиоклуба: здесь же подключаются стили и скрипт выпуска. Соседние блоки CSS и JS этой страницы пропускаются.',
})

export const embeds = {
  // --- общее для всех страниц ---
  1862707833: { kind: 'global', name: 'metrika' }, // счётчик 106581349, только на боевом домене, один раз
  1569554833: { kind: 'global', name: 'kommo' }, // виджет Kommo 1059843
  1569556213: { kind: 'global', name: 'kommo' }, // копия на главной, тот же код
  2019386053: cookie, // плашка куки (ключи cookieConsent, cookieConsentDate)
  2019389043: cookie, // копия на главной
  1491047173: menuBlur('nav1486554413'),
  1488865263: menuBlur('nav1488865513'), // меню главной

  // --- главная ---
  1488855793: hscroll(['#rec1487844433']),
  1490588213: { kind: 'component', load: () => import('./Typewriter.vue') },
  1491040633: shine('tn-elem__14865533831761599192234'),
  1493369823: smooth,
  1559313953: videoPos('#html-video-1486553383-176310543960410240'),
  1795637143: { kind: 'component', load: () => import('./Snitch.vue') },

  // --- /about ---
  2098149263: hscroll(['#rec2098148563']),
  2098149283: smooth,
  2098149513: shine('tn-elem__1555825513176310873726344220'),

  // --- /clarity ---
  2426973843: {
    kind: 'skip',
    cosmetic: true,
    reason:
      'Косметика Тильды: sticky у блока #rec2426973823 (top: 25vh, z-index: 0). Остальное в блоке чинит Тильду (transform/will-change, overflow-x: clip у #allrecords) и не переносится. Правила в src/embeds/README.md.',
  },
  2426973863: hscroll(['#rec2426973803', '#rec2426973763']),
  2426973883: {
    kind: 'component',
    load: () => import('./AutoScrollStrip.vue'),
    props: { target: '#rec2426973703' },
  },
  2426973893: smooth,

  // --- /mini ---
  1713786233: videoPos('#html-video-1703875663-1766147559512000013'),
  1714199963: smooth,

  // --- /taplink ---
  1557141233: videoPos('#html-video-1557093663-1763043211874'),
  1559325923: shine('tn-elem__1555825513176310873726344220'),

  // --- аудиоклуб: ноябрь 2026, /audio-club (Tribute s18xT, бот ?start=audio_nov) ---
  5543946903: clubCss('2026-11'),
  5543947003: clubMount('2026-11'),
  5543947103: clubJs('2026-11'),
  // --- аудиоклуб: сентябрь 2026, /audio-club-old (Tribute s15wd) ---
  3602643503: clubCss('2026-09'),
  3603226603: clubMount('2026-09'),
  3603229603: clubJs('2026-09'),
  // --- аудиоклуб: октябрь 2026, /audio-club-old-old (Tribute s18xT, canonical на /audio-club) ---
  4600632003: clubCss('2026-10'),
  4600632103: clubMount('2026-10'),
  4600632203: clubJs('2026-10'),
}

export const EXPECTED_REC_IDS = Object.keys(embeds).length
