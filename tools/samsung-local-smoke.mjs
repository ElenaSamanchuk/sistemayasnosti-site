// Direct CDP to an isolated tab on the physical Samsung, based on qa-kit / and_1009b.mjs.
// Requires a project-owned adb reverse and forward. Never visits external hosts.
import fs from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';
// SITE_ORIGIN (по умолчанию локальный превью), SITE_BASE (например /sistemayasnosti-site для GitHub Pages), OUTPUT_DIR, QA_TAG, SKIP_CORE
const origin = process.env.SITE_ORIGIN || 'http://127.0.0.1:4186';
const base = (process.env.SITE_BASE || '').replace(/\/$/, '');
const P = path => (base + path).replace(/\/$/, '') || '/';
const here = "(location.pathname.replace(/\\/$/,'')||'/')";
const debuggerOrigin = 'http://127.0.0.1:54186';
const output = process.env.OUTPUT_DIR || 'docs/screens/devices-2026-11-09/samsung';
await fs.mkdir(output, { recursive: true });
const tag = process.env.QA_TAG || 'sya-local-20261109';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function connect(url) {
  const ws = new WebSocket(url);
  const pending = new Map(), listeners = new Map();
  let next = 0;
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once:true });
    ws.addEventListener('error', reject, { once:true });
  });
  ws.addEventListener('message', ({data}) => {
    const msg = JSON.parse(data);
    if (msg.id) {
      const item = pending.get(msg.id);
      if (!item) return;
      pending.delete(msg.id);
      clearTimeout(item.timer);
      if (msg.error) item.reject(new Error(msg.error.message));
      else item.resolve(msg.result);
    } else listeners.get(msg.method)?.(msg.params);
  });
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++next;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(method + ' timeout')); }, 10000);
      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  return {send, on:(key, fn)=>listeners.set(key, fn), close:()=>ws.close()};
}

const meta = await (await fetch(debuggerOrigin+'/json/version')).json();
const browser = await connect(meta.webSocketDebuggerUrl);
const results = [], blocked = [], failures = [], writes = [];
let tab, id;
try {
  // Вкладка фоновой Chrome не отвечает на снимки и касания, поэтому браузер выводится на передний план
  execFileSync('adb',['-s','RZCY71AGDWW','shell','am','start','-n','com.android.chrome/com.google.android.apps.chrome.Main']);
  await pause(2500);
  const initial = await (await fetch(debuggerOrigin+'/json/list')).json();
  try {
    const target = await browser.send('Target.createTarget', {url:'about:blank'});
    id = target.targetId;
  } catch {
    execFileSync('adb',['-s','RZCY71AGDWW','shell','am','start','-a','android.intent.action.VIEW',
      '-d',origin+'/?qa='+tag,'-p','com.android.chrome','--ez','create_new_tab','true',
      '--es','com.android.browser.application_id','sya.local.qa']);
    for(let i=0;i<18 && !id;i++) {
      await pause(350);
      const listing=await (await fetch(debuggerOrigin+'/json/list')).json();
      id=listing.find(entry=>entry.url.includes('qa='+tag) && !initial.some(previous=>previous.id===entry.id))?.id;
    }
  }
  const listing = await (await fetch(debuggerOrigin+'/json/list')).json();
  const owned = listing.find(entry => entry.id === id);
  if (!owned) throw new Error('CDP не вернул адрес отдельной вкладки');
  tab = await connect(owned.webSocketDebuggerUrl);
  const {send} = tab;
  const ev = async expression => {
    const evaluated = await send('Runtime.evaluate', {expression, returnByValue:true, awaitPromise:true});
    if (evaluated.exceptionDetails) throw new Error(evaluated.exceptionDetails.exception?.description || 'evaluate error');
    return evaluated.result.value;
  };
  async function wait(expression, ms=9000) {
    const end=performance.now()+ms;
    do {const value=await ev(expression); if(value)return value; await pause(180);} while(performance.now()<end);
    throw new Error('Таймаут: '+expression.slice(0,130));
  }
  async function navigate(path) {
    const result = await send('Page.navigate', {url:origin+P(path)+(base&&path!=='/'?'/':'')+'?qa='+tag});
    if (result.errorText) throw new Error(result.errorText);
    await wait(`location.origin === ${JSON.stringify(origin)} && ${here} === ${JSON.stringify(P(path))} && document.readyState === 'complete' && !!document.querySelector('main h1')`);
    await pause(650);
  }
  async function shot(file) {
    const {data}=await send('Page.captureScreenshot',{format:'png',fromSurface:true});
    await fs.writeFile(output+'/'+file+'.png',Buffer.from(data,'base64'));
  }
  async function tap(selector, options = {}) {
    const choose=`[...document.querySelectorAll(${JSON.stringify(selector)})].find(a=>a.getClientRects().length&&getComputedStyle(a).visibility!=='hidden')`;
    if(options.scroll){
      await ev(`(${choose})?.scrollIntoView({block:'center',inline:'center',behavior:'instant'})`);
      await pause(600);
    }
    const expression=`(() => {
      const e=${choose};
      if (!e) return null;
      for(const r of e.getClientRects()) for(const fx of [.5,.2,.8]){
        const x=Math.round(r.x+r.width*fx),y=Math.round(r.y+r.height/2);
        const hit=document.elementFromPoint(x,y);
        if(hit&&(hit===e||e.contains(hit)))return {x,y,hit:true,label:e.textContent.trim().slice(0,32)};
      }
      return {hit:false,label:e.textContent.trim().slice(0,32),tag:e.tagName};
    })()`;
    const point=await ev(expression);
    if (!point?.hit) throw new Error('Тап перекрыт или вне экрана: '+selector+' '+JSON.stringify(point));
    await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:point.x,y:point.y}]});
    await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await pause(350);
  }
  async function test(name,fn) {
    try {const detail=await fn();results.push({name,ok:true,detail});console.log('OK',name,JSON.stringify(detail??''));}
    catch(error){
      const file='and-check-'+String(results.length+1).padStart(2,'0');
      await shot(file).catch(()=>{});
      results.push({name,ok:false,error:error.message,file});console.log('CHECK',name,error.message);
    }
  }
  await send('Page.enable');
  await send('Network.enable');
  await send('Runtime.enable');
  tab.on('Network.requestWillBeSent', ({request}) => {if(!['GET','HEAD','OPTIONS'].includes(request.method)) writes.push(request.method+' '+new URL(request.url).pathname);});
  tab.on('Runtime.exceptionThrown', event => failures.push({kind:'js',error:event.exceptionDetails.text}));
  tab.on('Network.responseReceived', ({response}) => {if(response.status>=400&&response.url.startsWith(origin+'/')) failures.push({kind:'http',path:new URL(response.url).pathname,status:response.status});});
  tab.on('Fetch.requestPaused', ({request,requestId}) => {
    if(request.url.startsWith(origin+'/') && request.method==='GET') send('Fetch.continueRequest',{requestId}).catch(()=>{});
    else {blocked.push(new URL(request.url).hostname);send('Fetch.failRequest',{requestId,errorReason:'BlockedByClient'}).catch(()=>{});}
  });
  await send('Fetch.enable',{patterns:[{urlPattern:'http://*'},{urlPattern:'https://*'}]});
  await send('Page.bringToFront');
  await navigate('/');
  await ev(`localStorage.removeItem('cookieConsent');localStorage.removeItem('cookieConsentDate');true`);
  await navigate('/');
  await test('Первый экран и устройство', async()=>{
    await shot('and-01-home');
    return ev(`({title:document.title,w:innerWidth,h:innerHeight,dpr:devicePixelRatio,touch:navigator.maxTouchPoints,ua:navigator.userAgent,h1:document.querySelector('h1').innerText,media:matchMedia('(orientation: portrait)').matches})`);
  });
  await test('Куки: ссылка, согласие, перезагрузка', async()=>{
    await wait(`document.querySelector('.cookieBanner.visible')`);
    const link=await ev(`document.querySelector('.cookie-banner-link a')?.getAttribute('href')`);
    if(link!==P('/cookie'))throw new Error('Неверная ссылка на политику: '+link);
    await shot('and-02-cookie');
    await tap('.cookie-banner-link a');
    await wait(`${here}===${JSON.stringify(P('/cookie'))} && !!document.querySelector('.native-article')`);
    await wait(`document.querySelector('.cookieBanner.visible')`);
    const policy=await ev(`({display:getComputedStyle(document.querySelector('.cookieBanner')).display,consent:localStorage.getItem('cookieConsent')})`);
    if(policy.display==='none'||policy.consent!==null)throw new Error('Состояние после перехода: '+JSON.stringify(policy));
    await shot('and-08-cookie-policy');
    await tap('.cookieBanner .scene-button .scene-atom');
    await wait(`localStorage.getItem('cookieConsent')==='accepted' && getComputedStyle(document.querySelector('.cookieBanner')).display==='none'`);
    await navigate('/');
    await wait(`getComputedStyle(document.querySelector('.cookieBanner')).display==='none'`);
    return {policy:link, acceptedAfterReload:true};
  });
  await test('Видео на главной', async()=>{
    if(await ev(here)!==P('/')) await navigate('/');
    await ev(`document.querySelector('video').scrollIntoView({block:'center',behavior:'instant'})`);
    await wait(`[...document.querySelectorAll('video')].some(v=>!v.paused&&v.currentTime>0.2&&v.videoWidth>0)`,6000);
    return ev(`[...document.querySelectorAll('video')].filter(v=>v.videoWidth).map(v=>({t:Math.round(v.currentTime*10)/10,muted:v.muted,poster:!!v.poster}))`);
  });
  await test('Бургер и переход в курс', async()=>{
    await ev('window.scrollTo(0,0)');
    await tap('.site-burger');
    await wait(`document.querySelector('.site-burger').getAttribute('aria-expanded')==='true'`);
    await shot('and-03-menu');
    await tap(`.site-nav a[href="${P('/clarity')}"]`);
    await wait(`${here}===${JSON.stringify(P('/clarity'))} && !!document.querySelector('main h1')`);
    await pause(500);
    return ev(`({route:location.pathname,menu:document.querySelector('.site-burger').getAttribute('aria-expanded')})`);
  });
  await test('Якорь «Смотреть программу»',async()=>{
    if(await ev(here)!==P('/clarity')) await navigate('/clarity');
    await tap('a[href="#program"]',{scroll:true});
    await wait(`location.hash==='#program' && scrollY>500`);
    await pause(500);
    await shot('and-04-program');
    return ev(`({hash:location.hash,y:scrollY})`);
  });
  await test('Футер и стрелка «Наверх»',async()=>{
    await ev('window.scrollTo(0,document.body.scrollHeight-innerHeight-300)');
    await wait(`!!document.querySelector('.back-top') && [...document.querySelectorAll('footer a')].some(x=>x.getAttribute('href')===${JSON.stringify(P('/oferta'))})`);
    await shot('and-05-footer');
    await tap('.back-top');
    await wait('scrollY<=2');
    return true;
  });
  await test('Попап и выбор страны телефона',async()=>{
    await navigate('/mini');
    await tap('a[href="#zeropopup"]',{scroll:true});
    await wait(`!!document.querySelector('.native-dialog')`);
    await pause(650);
    await tap('.zero-form__country',{scroll:true});
    await wait(`!!document.querySelector('.zero-form__countries')`);
    const countries=await ev(`document.querySelector('.zero-form__countries').children.length`);
    if(countries<10)throw new Error('Список стран: '+countries);
    await shot('and-06-phone-countries');
    await tap('.popup-close');
    await wait(`!document.querySelector('.native-modal')`);
    return {countries,closed:true};
  });
  await test('Аудиоклуб: запуск и пауза',async()=>{
    await navigate('/audio-club');
    await wait(`!!document.querySelector('#sya-club .sya-play')`);
    await tap('#sya-club .sya-play',{scroll:true});
    await wait(`document.querySelector('#sya-club').hasAttribute('data-sya-playing')`);
    await shot('and-07-club-playing');
    await tap('#sya-club .sya-play');
    await wait(`!document.querySelector('#sya-club').hasAttribute('data-sya-playing')`);
    const offer=await ev(`[...document.querySelectorAll('#sya-club a[href*="startapp="]')].at(-1)?.getAttribute('href')`);
    if(offer!=='tg://resolve?domain=tribute&appname=app&startapp=s18xT')throw new Error('Неверное назначение кнопки клуба: '+offer);
    return {paused:true,offer};
  });
  await test('12 страниц и отсутствие горизонтального переполнения',async()=>{
    const paths=['/','/taplink','/mini','/about','/clarity','/audio-club','/audio-club-old','/audio-club-old-old','/oferta','/privacy','/consent','/cookie'];
    const measured=[];
    for(const path of paths){
      await navigate(path);
      if(path.startsWith('/audio-club')) await wait(`!!document.querySelector('#sya-club h1')`);
      measured.push(await ev(`({path:${here},w:innerWidth,scrollW:document.documentElement.scrollWidth,h1:[...document.querySelectorAll('main h1')].filter(x=>x.getBoundingClientRect().width>0).length})`));
    }
    const fail=measured.filter(x=>x.w!==x.scrollW||x.h1!==1);
    if(fail.length) throw new Error(JSON.stringify(fail));
    return measured;
  });
  await test('Кнопка «Что изменилось?» скрыта',async()=>{
    await navigate('/');
    const shown=await ev(`[...document.querySelectorAll('a[href="#zeropopupmain"]')].length`);
    if(shown) throw new Error('Кнопка без содержимого снова на странице');
    return {shown};
  });
  await test('Форма /taplink: страны, маска, успех без отправки',async()=>{
    await navigate('/taplink');
    await tap('a[href="#zeropopup"]',{scroll:true});
    await wait(`!!document.querySelector('.native-dialog .zero-form__input')`);
    await pause(650);
    const field=async(index,text)=>{
      await ev(`(()=>{const e=document.querySelectorAll('.native-dialog .zero-form__input')[${index}];e.focus();e.value='';e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
      await send('Input.insertText',{text});
      await pause(250);
    };
    const phone=()=>ev(`({value:document.querySelectorAll('.native-dialog .zero-form__input')[1].value,country:document.querySelector('.native-dialog .zero-form__country').getAttribute('aria-label')})`);
    await field(0,'Анна Проверка');
    await field(2,'@qa_local');
    await field(3,'Проверка превью на телефоне');
    await field(1,'+12025550123');
    const us=await phone();
    if(!us.country.includes('США'))throw new Error('+1 не определился как США: '+JSON.stringify(us));
    await shot('and-09-phone-us');
    await field(1,'+79001234567');
    const ru=await phone();
    if(ru.value!=='+7 (900) 123-45-67'||!ru.country.includes('Россия'))throw new Error('Маска +7: '+JSON.stringify(ru));
    await field(1,'+999123456789');
    const odd=await phone();
    await shot('and-10-phone-999');
    await ev(`document.activeElement?.blur();true`); await pause(900); // экранная клавиатура сдвигает вёрстку, закрываем её до тапа
    await tap('.native-dialog .zero-form__submit',{scroll:true});
    await wait(`!!document.querySelector('.native-dialog [role=status]')`,6000).catch(async e=>{throw new Error(e.message+' | состояние: '+JSON.stringify(await ev(`({dialog:!!document.querySelector('.native-dialog'),modal:!!document.querySelector('.native-modal'),text:(document.querySelector('.native-dialog')?.innerText||'').slice(0,160),errors:[...document.querySelectorAll('.zero-form__error,.zero-form__summary')].map(x=>x.innerText),y:scrollY})`)))});
    const status=await ev(`document.querySelector('.native-dialog [role=status]').innerText.replace(/\\s+/g,' ').trim()`);
    const errors=await ev(`document.querySelectorAll('.native-dialog .zero-form__error').length`);
    await shot('and-11-form-done');
    if(errors)throw new Error('Ошибки в форме при телефоне +999: '+JSON.stringify(odd));
    if(!status.includes('Спасибо!')||!status.includes('Данные успешно отправлены.'))throw new Error('Текст успеха: '+status);
    if(writes.length)throw new Error('Исходящие POST/PUT: '+writes.join(', '));
    return {us:us.value,ru:ru.value,odd:odd.value,status,writes:0};
  });
  await test('/cookie: язык страницы es, шапка и подвал ru',async()=>{
    await navigate('/cookie');
    const langs=await ev(`({html:document.documentElement.getAttribute('lang'),header:document.querySelector('header')?.getAttribute('lang'),footer:document.querySelector('footer')?.getAttribute('lang')})`);
    if(langs.html!=='es'||langs.header!=='ru'||langs.footer!=='ru')throw new Error(JSON.stringify(langs));
    return langs;
  });
  await ev(`localStorage.removeItem('cookieConsent');localStorage.removeItem('cookieConsentDate');true`);
} finally {
  tab?.close();
  if(id) await browser.send('Target.closeTarget',{targetId:id}).catch(()=>{});
  browser.close();
  await fs.writeFile(output+'/results.json',JSON.stringify({browser:meta.Browser,origin,results,blocked,writes,failures},null,2)+'\n');
}
if(results.some(r=>!r.ok)||failures.length||blocked.length)process.exitCode=1;
