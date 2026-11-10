# -*- coding: utf-8 -*-
"""Компилятор снимка Тильды в независимые модели страниц. Снимок читается как данные: его JS не запускается и в сборку не попадает.
Вход: sources/live/<дата>/{inventory,manifest}.json и pages/*.html. Выход: public/content, public/media, public/fonts, src/fonts.css.
Завершается ненулевым кодом, если снимок не совпал с манифестом или не хватает обязательных данных."""
from pathlib import Path
from bs4 import BeautifulSoup, Comment, ProcessingInstruction
from collections import Counter
from urllib.parse import urlsplit
import json,re,hashlib,shutil,sys,os
sys.path.insert(0,str(Path(__file__).resolve().parent))
from typography import typograf_html
import design_tokens
from optimize_media import faststart_mp4,optimize_png,video_poster

ROOT=Path(__file__).resolve().parents[1]
SNAPSHOT=ROOT/'sources/live/2026-11-09'
OUT=ROOT/'public/content';MEDIA=ROOT/'public/media';FONTS=ROOT/'public/fonts'
SITE_ORIGIN='https://sistemayasnosti.com'
SITE_HOSTS={'sistemayasnosti.com','www.sistemayasnosti.com'}
SERVICE_PAGES={'/header':'header','/footer':'footer'}
# На главной свой Zero-блок подвала без обёртки t-footer. Сохраняем его оформление и ссылки.
INLINE_FOOTERS={'/':'1580656743'}
GIF='data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='
# Типограф в Zero: раскладка абсолютная, поэтому узлы, где неразрывные пробелы добавляют строку, исключены в sources/typograf-skip.json
# (аудит: tools/typograf-audit.mjs). ZERO_TYPOGRAF=0 нужен только аудиту, чтобы снять исходное число строк.
ZERO_TYPOGRAF=os.environ.get('ZERO_TYPOGRAF','1')!='0'
# Кнопка «Что изменилось?» (фон и подпись) на главной скрыта по решению Елены 09.11.2026: попап на живом сайте пуст, текста нет ни в снимке, ни в архиве
HIDDEN_NODES={'2194603213':{'1776437814550000002','1776437814550000003'}}
# Значки-ссылки подвала: на Тильде alt пустой, экранная читалка произносит только «ссылка»
ICON_ALT={'1761647021568':'Instagram','176164705506925820':'Написать на почту','176164704921189080':'YouTube','176164703477846730':'Telegram-бот'}
TYPO_SKIP_FILE=ROOT/'sources/typograf-skip.json'
TYPO_SKIP=set(json.loads(TYPO_SKIP_FILE.read_text('utf8'))['nodes']) if TYPO_SKIP_FILE.exists() and os.environ.get('TYPOGRAF_NO_SKIP')!='1' else set()
# Служебные записи, которых на странице нужен один экземпляр: на /about есть их копии с другими id
SINGLETON_TYPES={'360','602','890','674','270'}
SUPPORTED_NODES={'text','shape','image','button','vector','video','form'}
# Блик кнопки из T123 taplink: класс вешался скриптом на этот элемент (на /about класс light стоит в самом Zero)
CLASS_BY_ELEM={'1555825513':{'176310873726344220':['light']}}
# Единственный h1 страницы (sources/h1-map.json): узел выбран явно, при отсутствии узла в снимке сборка останавливается
H1_FILE=ROOT/'sources/h1-map.json'
H1_MAP={k:v for k,v in json.loads(H1_FILE.read_text('utf8')).items() if not k.startswith('_')}
h1_found=set()
POPUP_TYPES={'390','702','1093','868','331','1013'}

class SnapshotError(Exception):pass

manifest=json.loads((SNAPSHOT/'manifest.json').read_text('utf8'))
inventory=json.loads((SNAPSHOT/'inventory.json').read_text('utf8'))
assets=manifest['assets']
social_images={item.get('ogImage') for item in inventory}
social_image_hashes={assets[url]['sha256'] for url in social_images if url in assets}
if manifest.get('errors'):raise SnapshotError('В манифесте снимка есть ошибки: %s'%manifest['errors'])
EXT={'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp','image/svg+xml':'.svg','image/gif':'.gif','video/mp4':'.mp4','audio/mpeg':'.mp3'}
TOKEN=re.compile(r'tild[0-9a-f-]+/[^/?#]+')
by_token={}
for url,a in assets.items():
 if a.get('type') in EXT:
  m=TOKEN.search(url)
  if m:by_token.setdefault(m.group(0).lower(),url)

media={};media_variants={};optimized_images={};faststart_videos=set();video_posters={};asset_issues={};current_path='/'
page_fonts={}

def copy_asset(url):
 a=assets[url]
 if url in media:return media[url]
 source=SNAPSHOT/'assets'/a['file']
 if not source.is_file():raise SnapshotError('Нет файла снимка: '+a['file'])
 raw=source.read_bytes()
 if hashlib.sha256(raw).hexdigest()!=a['sha256']:raise SnapshotError('Файл снимка не совпал с манифестом: '+a['file'])
 digest=a['sha256']; key=(digest,a['type'])
 if key in media_variants:
  media[url]=media_variants[key]
  return media[url]
 extension=EXT[a['type']]
 if extension=='.png' and digest not in social_image_hashes:
  webp=optimize_png(raw)
  if webp is not None:
   optimized_images[digest]={'originalBytes':len(raw),'optimizedBytes':len(webp)}
   raw=webp;extension='.webp'
 elif extension=='.mp4':
  video=faststart_mp4(raw)
  if video is not None:raw=video;faststart_videos.add(digest)
 name=hashlib.sha256(raw).hexdigest()[:24]+extension;dest=MEDIA/name
 if not dest.exists():dest.write_bytes(raw)
 media[url]='/media/'+name
 media_variants[key]=media[url]
 return media[url]

def resolve_asset(url):
 """Адрес из манифеста → локальный файл. thb.* и resize-адреса сводятся к исходному файлу по токену Тильды."""
 absolute='https:'+url if url.startswith('//') else url
 candidates=[absolute,absolute.split('?',1)[0],absolute.replace('http://','https://',1)]
 for c in candidates:
  if c in assets and assets[c].get('type') in EXT:return copy_asset(c)
 m=TOKEN.search(absolute)
 if m and m.group(0).lower() in by_token:return copy_asset(by_token[m.group(0).lower()])
 return None

URL_RE=re.compile(r'(?:https?:)?//[A-Za-z0-9.-]+\.[a-z]{2,}[^\s"\'()<>,;]*')
def is_tilda_file(url):return bool(re.search(r'//[a-z0-9.-]*tildacdn\.[a-z]+/|//tilda\.ws/',url))

def localize(value):
 if not value:return value
 def repl(m):
  url=m.group(0);local=resolve_asset(url)
  if local:return local
  if is_tilda_file(url):
   if 'imgfishsquare' not in url:asset_issues.setdefault(current_path,set()).add(url)
   return GIF
  return url
 value=URL_RE.sub(repl,value)
 fonts=page_fonts.get(current_path,{})
 value=re.sub(r'var\(--t-(text|headline)-font,[^)]*\)',lambda m:fonts[m.group(1)],value)
 return design_tokens.css_tokens(value.replace('--t396-','--scene-'))

def local_href(value):
 """Ссылка: свой домен → путь, файл из снимка → локальный файл, остальное без изменений."""
 if not value:return value
 local=resolve_asset(value) if value.startswith(('http','//')) else None
 if local:return local
 try:parsed=urlsplit(value)
 except ValueError:return value
 if parsed.hostname in SITE_HOSTS:
  return (parsed.path or '/')+('?'+parsed.query if parsed.query else '')+('#'+parsed.fragment if parsed.fragment else '')
 return value

def clean_html(atom,typo=True,node_id=None):
 clone=BeautifulSoup(str(atom),'html.parser')
 for x in clone.find_all(string=lambda t:isinstance(t,(Comment,ProcessingInstruction))):x.extract()
 for e in clone(['script','style','iframe','object','embed','form','input']):e.decompose()
 for e in clone.find_all(True):
  classes=e.get('class',[])
  if e.name=='img' and e.get('data-original'):e['src']=e['data-original']
  for k in list(e.attrs):
   if k.startswith('on') or k.startswith('data-') or k in ('class','field','id'):del e[k]
  mapped=[c.replace('tn-atom__','scene-atom__') for c in classes if c.startswith('tn-atom__button-')]
  if mapped:e['class']=mapped
  for k in ('href','xlink:href','src','style'):
   if e.has_attr(k):
    if re.match(r'\s*(javascript|vbscript):',e[k],re.I):del e[k]
    else:e[k]=local_href(e[k]) if k in ('href','xlink:href') else localize(e[k])
  if e.name=='a':
   if e.get('href','').startswith(('https://','http://')):e['target']='_blank';e['rel']='noopener noreferrer'
   else:
    e.attrs.pop('target',None);e.attrs.pop('rel',None)
  if e.name=='img':
   if not e.get('src'):e['src']=''
   e['alt']=e.get('alt','')
 root=clone.find()
 if not root:return ''
 inner=''.join(map(str,root.contents))
 return typograf_html(inner,current_path,nbsp=node_id not in TYPO_SKIP) if typo else inner

def mark_doc_titles(html):
 """Заголовки документов (строка заглавными, стоит отдельно) получают класс для шрифта сайта. Текст не меняется."""
 soup=BeautifulSoup(html,'html.parser')
 def alone(x):return x is None or getattr(x,'name',None)=='br' or (isinstance(x,str) and not x.strip())
 strongs=soup.find_all('strong')
 for tag in strongs:
  text=tag.get_text(' ',strip=True)
  # Первая строка документа тоже заголовок, даже если не заглавными (/cookie: Consentimiento de cookies)
  opening=tag is strongs[0] and tag.previous_sibling is None and tag.parent is soup
  if len(text)>=8 and alone(tag.previous_sibling) and alone(tag.next_sibling) and (opening or (text.upper()==text and re.search('[A-ZА-ЯÁÉÍÓÚÑ]{4}',text))):tag['class']='doc-title'
 return str(soup)

def doc_h1(html,rec,indexes):
 """Заголовок документа становится h1 без изменения вида. Одиночная строка: h1 встаёт вокруг неё как строчный элемент (шрифт и межстрочный интервал наследуются).
 Несколько строк (оферта, два абзаца подряд): первый абзац становится h1, остальные строки переносятся в него через br, лишние абзацы убираются."""
 soup=BeautifulSoup(html,'html.parser')
 titles=soup.select('strong.doc-title')
 if not indexes or any(i>=len(titles) for i in indexes):raise SnapshotError('h1 %s: в статье %s нет строки .doc-title №%s (всего %d)'%(current_path,rec,indexes,len(titles)))
 first=titles[indexes[0]];parent=first.parent
 if parent is not None and parent.name=='p' and len(parent.find_all(True,recursive=False))==1:
  parent.name='h1';parent['class']=['doc-h1','doc-h1--block']
  for i in indexes[1:]:
   other=titles[i];box=other.parent
   if box is None or box.name!='p':raise SnapshotError('h1 %s: строка .doc-title №%d не в отдельном абзаце'%(current_path,i))
   parent.append(soup.new_tag('br'));parent.append(other.extract());box.decompose()
 else:
  if len(indexes)>1:raise SnapshotError('h1 %s: несколько строк заголовка поддержаны только в отдельных абзацах'%current_path)
  wrapper=soup.new_tag('h1');wrapper['class']=['doc-h1'];first.wrap(wrapper)
 return str(soup)

def rules(css,conditions=()):
 pos=0
 while pos<len(css):
  start=css.find('{',pos)
  if start<0:break
  selector=css[pos:start].strip();depth=1;end=start+1;quote=None
  while end<len(css) and depth:
   c=css[end]
   if quote:
    if c==quote and css[end-1]!='\\':quote=None
   elif c in ('"',"'"):quote=c
   elif c=='{':depth+=1
   elif c=='}':depth-=1
   end+=1
  body=css[start+1:end-1];pos=end
  if selector.startswith('@media'):
   yield from rules(body,conditions+(selector[6:].strip(),))
  elif not selector.startswith('@'):yield selector,body,conditions

def appearance(css,recid):
 result=[]
 for selectors,body,conditions in rules(css):
  for selector in selectors.split(','):
   selector=selector.strip()
   if not selector.startswith('#rec'+recid+' '):continue
   target=selector[len('#rec'+recid+' '):]
   target=target.replace('.t396__artboard','.scene-canvas').replace('.t396__carrier','.scene-background').replace('.t396__filter','.scene-filter')
   target=re.sub(r'\.tn-elem\[data-elem-id="([\d]+)"\]',r'[data-node="\1"]',target)
   target=re.sub(r'\.tn-group\[data-group-id="([\d]+)"\]',r'[data-node="\1"]',target)
   target=re.sub(r'\.tn-group__'+recid+r'([\d]+)',r'[data-node="\1"]',target)
   target=target.replace('#molecule-','#group-').replace('.t396__elem-flex','.scene-group-child')
   target=target.replace('.tn-atom__img','.scene-image').replace('.tn-atom','.scene-atom').replace('.tn-molecule','.scene-group-inner')
   if any(x in target for x in ('t396','tn-','t-bg','t-animate')):continue
   body=re.sub(r'(?:transition|animation-[a-z-]+):[^;]+;','',localize(body))
   rule='#scene-'+recid+' '+target+'{'+body+'}'
   for cond in reversed(conditions):rule='@media '+cond+'{'+rule+'}'
   result.append(rule)
 return '\n'.join(result)

def authored(e):return [c for c in e.get('class',[]) if c.startswith('cookie') or c.startswith('uc-') or c=='light']

def sbs_model(e):
 """Покадровая анимация Zero (scroll и blockintoview) как данные; значения для ширин хранятся отдельно, как в data-атрибутах снимка."""
 event=e.get('data-animate-sbs-event')
 if event not in ('scroll','blockintoview'):return None
 opts={};offset={}
 for k,v in e.attrs.items():
  m=re.fullmatch(r'data-animate-sbs-opts(?:-res-(\d+))?',k)
  if m:opts[m.group(1) or 'base']=json.loads(v.replace("'",'"'))
  m=re.fullmatch(r'data-animate-sbs-trgofst(?:-res-(\d+))?',k)
  if m:offset[m.group(1) or 'base']=float(v or 0)
 if not opts:return None
 return {'event':event,'trigger':float(e.get('data-animate-sbs-trg') or 1),'loop':e.get('data-animate-sbs-loop',''),'mobile':e.get('data-animate-mobile')=='y','opts':opts,'offset':offset}

INPUT_KEYS=('li_type','li_title','li_ph','li_req','li_nm','li_masktype','li_maskcountry','li_rule')
def form_inputs(e):
 """Состав полей Zero-формы из снимка. Получатели и адреса отправки в модель не попадают."""
 box=e.select_one('.tn-atom__inputs-data')
 items=json.loads(box.get('data-value','[]')) if box else []
 return [{k:v for k,v in item.items() if k in INPUT_KEYS} for item in sorted(items,key=lambda x:int(x.get('ls') or 0))]

def video_model(atom,recid):
 frame=atom.select_one('.tn-atom__videoiframe') if atom else None
 url=frame.get('data-mp4video') if frame else ''
 local=resolve_asset(url) if url else None
 if not local:raise SnapshotError('Нет файла видео в снимке: %s'%url)
 if local not in video_posters:
  poster=video_poster(MEDIA/Path(local).name)
  video_posters[local]=None
  if poster:
   name=hashlib.sha256(poster).hexdigest()[:24]+'.jpg'
   (MEDIA/name).write_bytes(poster)
   video_posters[local]='/media/'+name
 return {'src':local,'fit':frame.get('data-video-object-fit') or 'cover','poster':video_posters[local]}


def node(e,stats,recid=''):
 classes=authored(e)+CLASS_BY_ELEM.get(recid,{}).get(e.get('data-elem-id') or '',[])
 anim={k[13:]:v for k,v in e.attrs.items() if k.startswith('data-animate-')} if e.get('data-animate-style') else None
 if e.has_attr('data-group-id'):
  inner=e.select_one(':scope > .tn-molecule') or e
  return {'animation':anim,'sbs':sbs_model(e),'id':e['data-group-id'],'type':'group','classes':classes,'fields':{k[11:]:v for k,v in e.attrs.items() if k.startswith('data-group-')},'children':[node(n,stats,recid) for n in inner.find_all(recursive=False) if n.has_attr('data-elem-id') or n.has_attr('data-group-id')]}
 atom=e.select_one('.tn-atom');kind=e.get('data-elem-type','shape');stats[kind]+=1
 original=atom.get('data-original') if atom else None
 html=clean_html(atom,ZERO_TYPOGRAF,e.get('data-elem-id')) if atom else ''
 if kind=='image' and atom:
  img=atom.find('img');src=(img.get('data-original') or img.get('src')) if img else None
  if src:html='<img class="scene-image" src="'+localize(src)+'" alt="'+((ICON_ALT.get(e.get('data-elem-id')) or img.get('alt','')).replace('"','&quot;'))+'"/>'
 if kind not in SUPPORTED_NODES or kind in ('video','form'):html=''
 skip=('receivers','successurl','formmsgsuccess','imgs-value')
 model={'id':e['data-elem-id'],'type':kind,'html':html,'href':local_href(atom.get('href','')) if atom else '','target':atom.get('target','') if atom else '','atomStyle':localize(atom.get('style','')) if atom else '','background':localize(original) if original else '','fields':{k[11:]:v for k,v in e.attrs.items() if k.startswith('data-field-') and not any(x in k for x in skip)},'classes':classes}
 if anim:model['animation']=anim
 h1=H1_MAP.get(current_path,{}).get('node')
 if h1 and h1['rec']==recid and h1['elem']==e.get('data-elem-id'):
  if kind!='text':raise SnapshotError('h1 %s: узел %s/%s не текстовый (%s)'%(current_path,recid,h1['elem'],kind))
  model['tag']='h1';h1_found.add(current_path)
 sbs=sbs_model(e)
 if sbs:model['sbs']=sbs
 if kind=='video':model['video']=video_model(atom,recid)
 if kind=='form':model['inputs']=form_inputs(e)
 return model

def compile_scene(r,recid,css,stats,sbs):
 board=r.select_one('.t396__artboard')
 scene={'id':recid,'min':r.get('data-screen-min',''),'max':r.get('data-screen-max',''),'board':{k[14:]:v for k,v in board.attrs.items() if k.startswith('data-artboard-')},'nodes':[node(e,stats,recid) for e in board.find_all(recursive=False) if (e.has_attr('data-elem-id') or e.has_attr('data-group-id')) and e.get('data-elem-id') not in HIDDEN_NODES.get(recid,())]}
 css.append(appearance('\n'.join(t.get_text() for t in r.find_all('style')),recid))
 for el in r.select('[data-animate-sbs-event]'):
  event=el.get('data-animate-sbs-event')
  if event in ('scroll','blockintoview'):continue
  if event!='hover':sbs[event]+=1;continue
  nid=el.get('data-elem-id') or el.get('data-group-id')
  try:steps=json.loads(el.get('data-animate-sbs-opts','[]').replace("'",'"'))
  except ValueError:continue
  if not nid or len(steps)<2:continue
  t=steps[-1];num=lambda k,d:float(t.get(k,d) or d)
  tr=[];mx,my,sx,sy,ro=num('mx',0),num('my',0),num('sx',1),num('sy',1),num('ro',0)
  if mx or my:tr.append('translate(%gpx,%gpx)'%(mx,my))
  if sx!=1 or sy!=1:tr.append('scale(%g,%g)'%(sx,sy))
  if ro:tr.append('rotate(%gdeg)'%ro)
  ms=int(num('ti',200))
  css.append('#scene-%s [data-node="%s"]{transition:opacity %dms ease-in-out,transform %dms ease-in-out}'%(recid,nid,ms,ms))
  css.append('@media (hover:hover){#scene-%s [data-node="%s"]:hover{opacity:%g;%s}}'%(recid,nid,num('op',1),('transform:%s'%' '.join(tr)) if tr else ''))
 st=r.get('style','');pt=re.search(r'padding-top:\s*(\d+)px',st);pb=re.search(r'padding-bottom:\s*(\d+)px',st);bg=re.search(r'background-color:\s*([^;]+)',st)
 res=re.findall(r't-rec_p([tb])-res-(\d+)_(\d+)',' '.join(r.get('class',[])))
 if (pt and pt.group(1)!='0') or (pb and pb.group(1)!='0') or res:
  css.append('#scene-%s{box-sizing:content-box;padding-top:%spx;padding-bottom:%spx;%s}'%(recid,pt.group(1) if pt else 0,pb.group(1) if pb else 0,('background-color:%s;'%bg.group(1).strip()) if bg else ''))
  for side,w,val in sorted(res,key=lambda x:-int(x[1])):
   css.append('@media screen and (max-width:%spx){#scene-%s{padding-%s:%spx}}'%(w,recid,'top' if side=='t' else 'bottom',val))
 minimum=re.match(r'^([\d.]+)',r.get('data-screen-min',''));maximum=re.match(r'^([\d.]+)',r.get('data-screen-max',''))
 if minimum:css.append('@media(max-width:%spx){#scene-%s,#rec%s{display:none!important}}'%(minimum.group(1),recid,recid))
 if maximum:css.append('@media(min-width:%spx){#scene-%s,#rec%s{display:none!important}}'%(int(float(maximum.group(1)))+1,recid,recid))
 return scene

def declarations(css,selector):
 """Тело правила верхнего уровня с точным селектором."""
 for sel,body,cond in rules(css):
  if not cond and any(s.strip()==selector for s in sel.split(',')):return body
 return ''
def prop(body,name):
 m=re.search(r'(?:^|;)\s*'+re.escape(name)+r'\s*:\s*([^;]+)',body)
 return m.group(1).replace('!important','').strip() if m else ''

def menu_model(r,recid):
 """T228: данные меню. Вёрстку и поведение повторяет SiteMenu.vue."""
 css='\n'.join(t.get_text() for t in r.find_all('style'))
 nav=r.select_one('.t228');logo=r.select_one('img.t228__imglogo');burger=r.select_one('.t-menuburger span')
 height=re.search(r'height:\s*(\d+)px',nav.get('style','')) if nav else None
 width=re.search(r'width:\s*(\d+)px',logo.get('style','')) if logo else None
 link=declarations(css,'#rec%s a.t-menu__link-item'%recid)
 hover=re.search(r'\.t-menu__link-item\.t-active:not\([^)]*\)\{color:([^;!}]+)',css)
 button=r.select_one('.t228__right_buttons_but a')
 bstyle=declarations(css,'#rec%s .t-btnflex.t-btnflex_type_button'%recid)
 logo_href=local_href(r.select_one('a.t228__imgwrapper').get('href','/')) if r.select_one('a.t228__imgwrapper') else '/'
 return {'rec':recid,'height':int(height.group(1)) if height else 80,'background':nav.get('data-bgcolor-rgba','') if nav else '','backgroundScrolled':nav.get('data-bgcolor-rgba-afterscroll','') if nav else '',
  'logo':{'src':localize(logo.get('src','')) if logo else '','width':int(width.group(1)) if width else 41,'href':logo_href},
  'burgerColor':re.search(r'background-color:\s*([^;]+)',burger.get('style','')).group(1) if burger else '#000',
  'items':[{'text':a.get_text(' ',strip=True),'href':local_href(a.get('href',''))} for a in r.select('a.t-menu__link-item')],
  'itemStyle':{'fontSize':prop(link,'font-size'),'color':prop(link,'color'),'fontWeight':prop(link,'font-weight'),'hoverColor':hover.group(1).strip() if hover else ''},
  'button':{'text':button.get_text(' ',strip=True),'href':local_href(button.get('href','')),'color':prop(bstyle,'color'),'background':prop(bstyle,'background-image'),'radius':prop(bstyle,'border-radius'),'fontWeight':prop(bstyle,'font-weight'),'fontSize':prop(bstyle,'font-size')} if button else None}

def service_model(typ,r,recid,shell):
 css='\n'.join(t.get_text() for t in r.find_all('style'))
 if typ=='602':
  bar=r.select_one('.t602__indicator');m=re.search(r'background:\s*([^;]+)',bar.get('style','')) if bar else None
  shell['scrollIndicator']={'color':m.group(1).strip() if m else '#000'}
 elif typ=='890':
  arrow=r.select_one('.t890__arrow');pos=declarations(css,'#rec%s .t890'%recid)
  hover=re.search(r'\.t890__arrow:hover svg rect\{fill:([^;}]+)',css);icon=r.select_one('.t890__arrow svg')
  shell['backTop']={'left':prop(pos,'left') or '20px','bottom':prop(pos,'bottom') or '20px','shadow':prop(arrow.get('style',''),'box-shadow'),'hover':hover.group(1).strip() if hover else '','svg':str(icon) if icon else ''}
 elif typ=='674':
  m=re.search(r'body\{background-color:\s*([^;!}]+)',css)
  if m:shell['background']=m.group(1).strip()
 elif typ=='270':
  box=r.select_one('.t270');shell['anchorOffset']=int(box.get('data-offset-top') or 0) if box else 0

def record_hash(r):return hashlib.sha256(re.sub(r'\s+','',str(r)).encode()).hexdigest()

def load_page(path):
 slug='index' if path=='/' else path.strip('/').replace('/','__')
 file=SNAPSHOT/'pages'/(slug+'.html');info=manifest['pages'].get(path)
 if not file.is_file() or not info:raise SnapshotError('Нет страницы снимка: '+path)
 raw=file.read_bytes()
 if hashlib.sha256(raw).hexdigest()!=info['sha256']:raise SnapshotError('Страница снимка изменилась без обновления манифеста: '+path)
 return BeautifulSoup(raw,'html.parser')

def read_page_fonts(path,soup):
 """Какой шрифт стоит за var(--t-text-font,…) на самой странице: значение из её файла блоков Тильды (снимок), а не из предположения."""
 for link in soup.find_all('link',rel='stylesheet'):
  href=link.get('href','')
  if 'tilda-blocks-page' in href and href in assets:
   css=(SNAPSHOT/'assets'/assets[href]['file']).read_text('utf8')
   found={k:re.search(r'--t-%s-font:([^;}]+)'%k,css) for k in ('text','headline')}
   if all(found.values()):return {k:v.group(1).strip() for k,v in found.items()}
 raise SnapshotError('Не найдены шрифты страницы (--t-text-font): '+path)

shared={'scenes':{},'css':{},'hash':{},'zone':{}}

def compile_service(path,zone):
 global current_path
 current_path=path
 s=load_page(path);page_fonts[path]=read_page_fonts(path,s)
 stats=Counter();sbs=Counter()
 for r in s.select('[data-record-type]'):
  recid=r.get('id','rec')[3:];shared['hash'][recid]=record_hash(r);shared['zone'][recid]=zone
  if r.get('data-record-type')=='396' and r.select_one('.t396__artboard'):
   css=[];shared['scenes'][recid]=compile_scene(r,recid,css,stats,sbs);shared['css'][recid]='\n'.join(css)

def window_scenes(scenes):
 return {sc['id'] for sc in scenes if any(k.startswith('upscale') and v=='window' for k,v in sc['board'].items())}

def compile_page(item):
 global current_path
 path=item['path'];current_path=path
 s=load_page(path);page_fonts[path]=read_page_fonts(path,s)
 scenes=[];css=[];popups=[];unsupported=[];anchors=[];blocks=[];stats=Counter();sbs=Counter();deduped=[]
 shell={'menu':None,'cookie':None,'footer':None}
 seen=set();singletons=set()
 for r in s.select('[data-record-type]'):
  recid=r.get('id','rec')[3:];typ=r.get('data-record-type')
  if recid in seen:deduped.append({'id':recid,'type':typ,'why':'повтор id'});continue
  seen.add(recid)
  if typ in SINGLETON_TYPES:
   if typ in singletons:deduped.append({'id':recid,'type':typ,'why':'копия служебного блока'});continue
   singletons.add(typ);service_model(typ,r,recid,shell);continue
  is_shared=shared['hash'].get(recid)==record_hash(r)
  zone=shared['zone'].get(recid) if is_shared else None
  for a in r.select('a[name]'):anchors.append({'name':a['name'],'scene':recid})
  board=r.select_one('.t396__artboard')
  if board:
   is_footer=r.find_parent(id='t-footer') or INLINE_FOOTERS.get(path)==recid
   role='cookie' if r.select_one('.cookieBanner') else 'footer' if is_footer else None
   if not is_shared:scenes.append(compile_scene(r,recid,css,stats,sbs))
   else:
    for k,v in Counter(n.get('data-elem-type','shape') for n in board.select('[data-elem-id]')).items():stats[k]+=v
   if role:shell[role]=recid
   else:blocks.append({'kind':'scene','id':recid})
  elif typ=='131':
   entry={'kind':'embed','rec':recid}
   parent='header' if r.find_parent(id='t-header') else 'footer' if r.find_parent(id='t-footer') else None
   if parent:entry['zone']=parent
   blocks.append(entry)
  elif typ=='257':
   if not shell['menu']:shell['menu']=menu_model(r,recid)
  elif typ in POPUP_TYPES:
   popup=r.select_one('[data-tooltip-hook]')
   if popup:
    ids=popup.get('data-popup-rec-ids','')
    popups.append({'scenes':[re.sub(r'^rec','',x.strip()) for x in ids.split(',')] if ids else [],'hook':popup['data-tooltip-hook'],'type':typ})
  elif typ in ('106','33','976','3'):
   content=r.select_one('[field="text"],.t017,.t976__wrapper,.t107')
   if content:
    for img in content.find_all('img'):
     if img.get('data-original'):img['src']=img['data-original']
    article_html=mark_doc_titles(clean_html(content))
    spec=H1_MAP.get(path,{}).get('article')
    if spec and spec['rec']==recid:
     article_html=doc_h1(article_html,recid,spec['docTitles']);h1_found.add(path)
    blocks.append({'kind':'article','id':recid,'type':typ,'html':article_html,'style':localize(r.get('style',''))})
  elif typ=='215':blocks.append({'kind':'anchor','id':recid})
  elif typ=='113':
   blocks.append({'kind':'spacer','id':recid,'style':localize(r.get('style',''))})
   for side,res,val in re.findall(r't-rec_p([tb])-res-(\d+)_(\d+)',' '.join(r.get('class',[]))):
    css.append('@media screen and (max-width:%spx){#rec%s{padding-%s:%spx!important}}'%(res,recid,'top' if side=='t' else 'bottom',val))
  else:unsupported.append({'id':recid,'type':typ,'text':r.get_text(' ',strip=True)[:300]})
 embedded=H1_MAP.get(path,{}).get('embedded')
 if embedded:
  if not any(b['kind']=='embed' and b['rec']==embedded['rec'] for b in blocks):raise SnapshotError('h1 %s: встроенного блока %s нет на странице'%(path,embedded['rec']))
  h1_found.add(path)
 if path not in H1_MAP:raise SnapshotError('h1: для страницы %s нет записи в sources/h1-map.json'%path)
 if path not in h1_found:raise SnapshotError('h1 %s: узел из sources/h1-map.json не найден в снимке: %s'%(path,json.dumps(H1_MAP[path],ensure_ascii=False)))
 title=s.title.get_text() if s.title else item.get('title','')
 robots=s.find('meta',attrs={'name':'robots'});desc=s.find('meta',attrs={'name':'description'});og=s.find('meta',attrs={'property':'og:image'})
 icon=s.find('link',rel=lambda v:v and 'icon' in v)
 structured=[]
 for tag in s.find_all('script',attrs={'type':'application/ld+json'}):
  try:structured.append(json.loads(tag.get_text()))
  except (ValueError,TypeError):pass
 canonical=re.sub(r'^http://','https://',item.get('canonical') or SITE_ORIGIN+path)
 if canonical==SITE_ORIGIN:canonical+='/'
 popup_scenes={x for p in popups for x in p['scenes']}
 missing_popups=sorted(x for x in popup_scenes if x not in {sc['id'] for sc in scenes})
 notsup=sorted(k for k in stats if k not in SUPPORTED_NODES)
 model={'path':path,'title':title,'description':desc.get('content','') if desc else '','canonical':canonical,'image':localize(og.get('content','')) if og and og.get('content') else '','icon':localize(icon.get('href','')) if icon else '','robots':robots.get('content','') if robots else '','structuredData':structured,'shell':shell,'scenes':scenes,'blocks':blocks,'popups':popups,'anchors':anchors}
 if embedded:model['h1Embedded']=embedded['text']
 page_id=item['pageId']
 (OUT/(page_id+'.json')).write_text(design_tokens.tg_links(json.dumps(model,ensure_ascii=False,separators=(',',':'))),'utf8')
 (OUT/(page_id+'.css')).write_text(design_tokens.round_line_heights(design_tokens.css_tokens('\n'.join(css)),window_scenes(scenes)),'utf8')
 return {'path':path,'page':page_id,'title':title,'scenes':len(scenes),'embeds':[b['rec'] for b in blocks if b['kind']=='embed'],'unsupported':unsupported,'unsupportedNodes':{k:stats[k] for k in notsup},'nodes':dict(stats),'unsupportedAnimations':dict(sbs),'popupsNotRendered':[p['hook'] for p in popups if any(x in missing_popups for x in p['scenes'])],'missingPopupScenes':missing_popups,'deduped':deduped,'missingShell':[k for k,v in shell.items() if not v],'missingMediaCount':len(asset_issues.get(path,[]))}

def build_fonts():
 """Inter и Forum из снимка в public/fonts и src/fonts.css. На Google сайт не ходит."""
 url=next(u for u in assets if 'Forum:wght@400&family=Inter:wght@100' in u)
 css=(SNAPSHOT/'assets'/assets[url]['file']).read_text('utf8')
 want={'cyrillic','cyrillic-ext','latin','latin-ext'};seen=set();out=[]
 for block in re.finditer(r'/\* ([\w-]+) \*/\s*@font-face\s*\{([^}]*)\}',css):
  subset,body=block.group(1),block.group(2)
  family=re.search(r"font-family:\s*'([^']+)'",body).group(1)
  if subset not in want or (family,subset) in seen:continue
  seen.add((family,subset))
  src=re.search(r'url\(([^)]+)\)',body).group(1);uni=re.search(r'unicode-range:\s*([^;]+)',body).group(1)
  asset=assets.get(src)
  if not asset:raise SnapshotError('Нет файла шрифта в снимке: '+src)
  raw=(SNAPSHOT/'assets'/asset['file']).read_bytes()
  if hashlib.sha256(raw).hexdigest()!=asset['sha256']:raise SnapshotError('Файл шрифта изменился: '+src)
  name='%s-%s.woff2'%(family.lower(),subset);(FONTS/name).write_bytes(raw)
  weight='100 900' if family=='Inter' else '400'
  out.append("@font-face{font-family:'%s';font-style:normal;font-weight:%s;font-display:swap;src:url(/fonts/%s) format('woff2');unicode-range:%s}"%(family,weight,name,uni.strip()))
 if len(seen)!=8:raise SnapshotError('В снимке не все начертания Inter/Forum: %s'%sorted(seen))
 (ROOT/'src/fonts.css').write_text('/* Сгенерировано tools/normalize_export.py из снимка, руками не править */\n'+'\n'.join(out)+'\n','utf8')
 return len(seen)

def main():
 for d in (OUT,MEDIA,FONTS):d.mkdir(parents=True,exist_ok=True)
 for old in OUT.glob('*'):old.unlink()
 for p in MEDIA.glob('*'):p.unlink()
 fonts=build_fonts()
 for path,zone in SERVICE_PAGES.items():compile_service(path,zone)
 routes=[item for item in inventory if item['path'] not in SERVICE_PAGES]
 if len(routes)!=len(inventory)-len(SERVICE_PAGES):raise SnapshotError('В инвентаре нет /header или /footer')
 compiled=[compile_page(r) for r in routes]
 layout={'scenes':list(shared['scenes'].values())}
 (OUT/'shared-layout.json').write_text(design_tokens.tg_links(json.dumps(layout,ensure_ascii=False,separators=(',',':'))),'utf8')
 (OUT/'shared-layout.css').write_text(design_tokens.round_line_heights(design_tokens.css_tokens('\n'.join(shared['css'].values())),window_scenes(shared['scenes'].values())),'utf8')
 (OUT/'routes.json').write_text(json.dumps(compiled,ensure_ascii=False),'utf8')
 (ROOT/'sources').joinpath('local-media.json').write_text(json.dumps(media,ensure_ascii=False,indent=1),'utf8')
 issues={k:sorted(v) for k,v in asset_issues.items()}
 unsupported=Counter(u['type'] for r in compiled for u in r['unsupported'])
 nodes=Counter()
 for r in compiled:nodes.update(r['unsupportedNodes'])
 sbs=Counter()
 for r in compiled:sbs.update(r['unsupportedAnimations'])
 optimization={'images':len(optimized_images),'bytesSaved':sum(item['originalBytes']-item['optimizedBytes'] for item in optimized_images.values()),'faststartVideos':len(faststart_videos),'videoPosters':sum(bool(poster) for poster in video_posters.values())}
 report={'snapshot':manifest['capturedAt'],'pages':len(compiled),'mediaCopied':len(set(media.values())),'mediaOptimization':optimization,'fonts':fonts,'unsupportedRecords':dict(unsupported),'unsupportedNodes':dict(nodes),'unsupportedAnimations':dict(sbs),'assetIssues':issues,'routes':compiled}
 (ROOT/'docs/compiler-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=1),'utf8')
 print(json.dumps({'pages':len(compiled),'media':len(set(media.values())),'mediaOptimization':optimization,'fonts':fonts,'unsupportedRecords':dict(unsupported),'unsupportedNodes':dict(nodes),'unsupportedAnimations':dict(sbs),'assetIssues':sum(len(v) for v in issues.values())},ensure_ascii=False))
 bad=[r['path'] for r in compiled if r['path']=='/oferta' and (r['unsupported'] or r['missingMediaCount'] or r['missingShell'])]
 if bad:
  print('ОШИБКА: на /oferta неподдержанные записи, пропавшие файлы или неполный общий слой',file=sys.stderr);sys.exit(2)

try:main()
except SnapshotError as error:
 print('ОШИБКА снимка: %s'%error,file=sys.stderr);sys.exit(1)
