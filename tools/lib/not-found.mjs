// Страница 404 в оформлении сайта: шапка, куки и футер берутся у готовой страницы (shell), без редизайна.
export function notFoundPage(base) {
  const link = (href, text) => `<a href="${href}" style="display:inline-block;margin:6px 10px;color:#818658;font-weight:500">${text}</a>`;
  const html = `<div style="text-align:center;padding:100px 20px 40px"><h1 style="font-family:'Forum',Georgia,serif;font-weight:400;font-size:40px;line-height:1.2;color:#4c3c26;margin:0 0 16px">Страница не найдена</h1><p style="margin:0 0 24px;color:#938d84">Такого адреса нет или страница переехала. Вернитесь на главную или выберите курс.</p><p style="margin:0">${link('/', 'На главную')}${link('/clarity', 'Тело как опора')}${link('/mini', 'Мини-курсы')}${link('/audio-club', 'Аудиоклуб')}</p></div>`;
  const keep = (base.blocks || []).filter((b) => b.kind === 'embed');
  const header = keep.filter((b) => b.zone !== 'footer');
  const footer = keep.filter((b) => b.zone === 'footer');
  return {
    ...base,
    path: '/404',
    title: 'Страница не найдена',
    description: '',
    canonical: '',
    image: '',
    structuredData: [],
    anchors: [],
    popups: [],
    blocks: [...header, { kind: 'article', id: '404', type: '106', html, style: 'padding-top:120px;padding-bottom:120px;' }, ...footer],
  };
}
