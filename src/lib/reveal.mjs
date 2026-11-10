// Native reveal using exported timing data. No source runtime or hidden content without JS.
const states=new WeakMap();
export function revealFrames(value,baseTransform='none'){
 const distance=Number(value.distance)||25;
 const transforms={fadeinup:`translateY(${distance}px)`,fadeindown:`translateY(-${distance}px)`,fadeinleft:`translateX(${distance}px)`,fadeinright:`translateX(-${distance}px)`,zoomin:`scale(${Number(value.scale)||0.9})`};
 const offset=transforms[value.style];const initial=offset?(baseTransform==='none'?offset:`${baseTransform} ${offset}`):baseTransform;
 return [{opacity:0,transform:initial},{opacity:1,transform:baseTransform}];
}
export const reveal={
 mounted(element,{value}){
  // Внутри попапов анимация появления элементов не нужна: попап сам выезжает снизу (решение Елены 14.10.2026)
  if(element.closest?.('.native-modal'))return;
  if(!value||states.has(element)||matchMedia('(prefers-reduced-motion: reduce)').matches||innerWidth<960&&value.mobile!=='y'||typeof IntersectionObserver==='undefined'||typeof element.animate!=='function')return;
  const state={observer:null,animation:null,started:false,originalOpacity:element.style.opacity};
  const restore=()=>{if(element.style.opacity==='0')element.style.opacity=state.originalOpacity;};
  const base=getComputedStyle(element).transform;
  // Prevent the first-frame flash before the observer dispatches its first callback.
  element.style.opacity='0';
  const observer=new IntersectionObserver(entries=>{
   if(state.started||!entries.some(e=>e.isIntersecting))return;
   state.started=true;observer.disconnect();
   try{
    const animation=element.animate(revealFrames(value,base),{duration:Math.max(0,Number(value.duration)||1)*1000,delay:Math.max(0,Number(value.delay)||0)*1000,easing:'cubic-bezier(.19,1,.22,1)',fill:'both'});
    state.animation=animation;
    animation.finished.then(()=>{restore();animation.cancel();},restore);
   }catch{restore();}
  },{rootMargin:'0px 0px -13% 0px'});state.observer=observer;states.set(element,state);observer.observe(element);
  // Низ страницы: элементы ниже линии запуска тоже проявляются, когда прокручено до конца
  state.atEnd=()=>{if(!state.started&&innerHeight+scrollY>=document.documentElement.scrollHeight-4&&element.getBoundingClientRect().top<innerHeight){observer.takeRecords();state.started=true;observer.disconnect();removeEventListener('scroll',state.atEnd);const a=element.animate(revealFrames(value,base),{duration:Math.max(0,Number(value.duration)||1)*1000,easing:'cubic-bezier(.19,1,.22,1)',fill:'both'});state.animation=a;a.finished.then(()=>{restore();a.cancel();},restore);}};
  addEventListener('scroll',state.atEnd,{passive:true});
 },
 unmounted(element){const state=states.get(element);if(state?.atEnd)removeEventListener('scroll',state.atEnd);state?.observer.disconnect();state?.animation?.cancel();if(state&&element.style.opacity==='0')element.style.opacity=state.originalOpacity;states.delete(element);}
};
