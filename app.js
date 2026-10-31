import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, setPersistence, browserLocalPersistence, onAuthStateChanged,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
  sendPasswordResetEmail
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getFirestore, doc, getDoc, getDocFromServer, setDoc, onSnapshot, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAG1fSeZNxx5I1--zM_bW0iVQu53ggRjDc',
  authDomain: 'calendar-ay.firebaseapp.com',
  projectId: 'calendar-ay',
  storageBucket: 'calendar-ay.firebasestorage.app',
  messagingSenderId: '6362891897',
  appId: '1:6362891897:web:6641890012d605ce4ef6a8'
};

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const pad = n => String(n).padStart(2, '0');
const ds = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y,m,d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const add = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const startWeek = d => { const x=new Date(d.getFullYear(), d.getMonth(), d.getDate()); return add(x, -((x.getDay()+6)%7)); };
const uid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const esc = s => String(s ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
const diaryIconHtml = hasDiary => `<span class="diaryGlyph ${hasDiary?'open':'closed'}" aria-hidden="true"></span>`;
const DAY = 86400000;
const dayNum = s => { const [y,m,d] = s.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / DAY); };
const diffDays = (a,b) => dayNum(b) - dayNum(a);
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

function hexToHsl(hex){
  const h=String(hex||'#d9d9d9').replace('#','');
  const full=h.length===3?h.split('').map(x=>x+x).join(''):h.padEnd(6,'0').slice(0,6);
  let r=parseInt(full.slice(0,2),16)/255, g=parseInt(full.slice(2,4),16)/255, b=parseInt(full.slice(4,6),16)/255;
  const max=Math.max(r,g,b), min=Math.min(r,g,b); let hue=0, sat=0; const light=(max+min)/2;
  if(max!==min){
    const d=max-min; sat=light>0.5?d/(2-max-min):d/(max+min);
    if(max===r) hue=(g-b)/d+(g<b?6:0); else if(max===g) hue=(b-r)/d+2; else hue=(r-g)/d+4;
    hue/=6;
  }
  return {h:hue*360,s:sat*100,l:light*100};
}
function hslToHex(h,s,l){
  h=((h%360)+360)%360; s=clamp(s,0,100)/100; l=clamp(l,0,100)/100;
  const c=(1-Math.abs(2*l-1))*s, x=c*(1-Math.abs((h/60)%2-1)), m=l-c/2;
  let r=0,g=0,b=0;
  if(h<60){r=c;g=x}else if(h<120){r=x;g=c}else if(h<180){g=c;b=x}else if(h<240){g=x;b=c}else if(h<300){r=x;b=c}else{r=c;b=x}
  const hx=v=>Math.round((v+m)*255).toString(16).padStart(2,'0');
  return `#${hx(r)}${hx(g)}${hx(b)}`;
}
function suggestSubCalendarColor(parentId, editId=''){
  const parent=state.calendars.find(c=>c.id===parentId); if(!parent) return '#d9d9d9';
  const siblings=state.calendars.filter(c=>c.parentId===parentId && c.id!==editId);
  const {h,s,l}=hexToHsl(parent.color);
  const lightDeltas=l>=72?[-10,-18,-26,-34,-14,-22]:l<=38?[14,24,34,18,28,38]:[14,-12,24,-20,32,-28];
  const i=siblings.length, delta=lightDeltas[i%lightDeltas.length];
  const newL=clamp(l+delta,18,92);
  const newS=s<8?0:clamp(s+(i%2===0?3:-4),22,95);
  return hslToHex(h,newS,newL);
}

const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
const db = getFirestore(app);
await setPersistence(auth, browserLocalPersistence);

const defaultState = () => ({
  version: '2.77',
  calendars: [
    {id:'work',name:'아도라블',color:'#bfe8c9',order:1,period:'오전',capacity:5,capacityUnknown:false,capacityByDay:Object.fromEntries([0,1,2,3,4,5,6].map(d=>[d,{hours:d===0||d===6?0:5,unknown:false}])),parentId:''},
    {id:'personal',name:'개인업무',color:'#d9d9d9',order:2,period:'오후',capacity:3,capacityUnknown:false,capacityByDay:Object.fromEntries([0,1,2,3,4,5,6].map(d=>[d,{hours:d===0||d===6?0:3,unknown:false}])),parentId:''},
    {id:'family',name:'가족/개인',color:'#f6e8a6',order:3,period:'저녁',capacity:2,capacityUnknown:false,capacityByDay:Object.fromEntries([0,1,2,3,4,5,6].map(d=>[d,{hours:d===0||d===6?0:2,unknown:false}])),parentId:''}
  ],
  events: [],
  fixed: [],
  flexible: [],
  purchases: [],
  diary: {},
  actualWork: {},
  settings: { hiddenCalendars: [], weekdayWidths:[100,100,100,100,100,100,100], weekdayWidthMode:'ratio', weekdayWidthReference:0, fixedPanelsCollapsed: { recurring:false, archivedRecurring:true, manual:false, flexible:false, purchase:false, payment:false }, sidebarCalendarGroupsCollapsed: { recurring:{}, archivedRecurring:{}, manual:{}, flexible:{}, payment:{} }, sidebarSectionOrder:['calendar','fixed','flexible','purchase','payment','dday','diary'], sidebarSectionsCollapsed:{}, laneHeights:{}, laneCollapsed:{}, laneLabelWidth:72, mobileSectionsCollapsed:{}, dayLaneHeights:{}, dayLaneManual:{}, workloadRange:'week', weekViewMode:'detailed', monthShowCommonWithFocus:true, selectedDdayId:'' }
});

let state = defaultState();
let cursor = new Date();
let view = 'week';
let mobileSelectedDate = '';
let currentUser = null;
let unsubscribeDoc = null;
let remoteRef = null;
let syncReady = false;
let applyingRemote = false;
let saveTimer = null;
let selectedFixedFilter = 'all';
let selectedFlexibleFilter = 'all';
let selectedPaymentFilter = 'all';
let selectedDiaryMonth = 'all';
let diaryMainMode = 'calendar';
let lastScheduleView = 'week';
let calendarFocusIds = new Set();
let activeDrag = null;
let activeEventOccurrence = null;
let lastFirebaseSavedAt = null;
let lastLocalSavedAt = null;
let localDirty = false;
let writeInFlight = false;
let holidayData = {};
const HOLIDAY_URL = 'https://raw.githubusercontent.com/hyunbinseo/holidays-kr/main/public/basic.json';
const HOLIDAY_CACHE_KEY = 'myCalendarHolidayKR:v1';
const HOLIDAY_CACHE_MAX_AGE = 24 * 60 * 60 * 1000;
const SIDEBAR_UI_KEY = 'calendarSidebarUI:v1';
const SIDEBAR_DEFAULT_WIDTH = 260;
const SIDEBAR_MIN_WIDTH = 210;
const SIDEBAR_MAX_WIDTH = 520;
let sidebarUI = { width: SIDEBAR_DEFAULT_WIDTH, collapsed: false };

function loadSidebarUI(){
  try{
    const raw=JSON.parse(localStorage.getItem(SIDEBAR_UI_KEY)||'null');
    if(raw && typeof raw==='object'){
      sidebarUI.width=clamp(Number(raw.width)||SIDEBAR_DEFAULT_WIDTH,SIDEBAR_MIN_WIDTH,SIDEBAR_MAX_WIDTH);
      sidebarUI.collapsed=!!raw.collapsed;
    }
  }catch{}
}
function saveSidebarUI(){
  try{ localStorage.setItem(SIDEBAR_UI_KEY,JSON.stringify(sidebarUI)); }catch{}
}
function isMobileSidebar(){ return window.matchMedia('(max-width: 760px)').matches; }
function applySidebarUI(){
  const layout=$('.layout'), btn=$('#sidebarCollapseBtn');
  if(!layout) return;
  document.documentElement.style.setProperty('--sidebar-w',`${sidebarUI.width}px`);
  const desktopCollapsed=!isMobileSidebar() && sidebarUI.collapsed;
  layout.classList.toggle('sidebarCollapsed',desktopCollapsed);
  if(btn){
    btn.textContent=desktopCollapsed?'›':'‹';
    btn.setAttribute('aria-label',desktopCollapsed?'좌측바 펴기':'좌측바 접기');
    btn.title=desktopCollapsed?'좌측바 펴기':'좌측바 접기';
  }
}
function setSidebarCollapsed(collapsed){
  sidebarUI.collapsed=!!collapsed;
  saveSidebarUI();
  applySidebarUI();
}
function initSidebarResizer(){
  loadSidebarUI();
  applySidebarUI();
  const resizer=$('#sidebarResizer'), collapseBtn=$('#sidebarCollapseBtn');
  if(!resizer || !collapseBtn) return;
  collapseBtn.addEventListener('click',e=>{
    e.stopPropagation();
    if(isMobileSidebar()) return;
    setSidebarCollapsed(!sidebarUI.collapsed);
  });
  resizer.addEventListener('dblclick',e=>{
    if(isMobileSidebar() || e.target.closest('button')) return;
    sidebarUI.width=SIDEBAR_DEFAULT_WIDTH;
    sidebarUI.collapsed=false;
    saveSidebarUI(); applySidebarUI();
  });
  resizer.addEventListener('pointerdown',e=>{
    if(isMobileSidebar() || e.button!==0 || e.target.closest('button') || sidebarUI.collapsed) return;
    e.preventDefault();
    const max=Math.min(SIDEBAR_MAX_WIDTH,Math.max(SIDEBAR_MIN_WIDTH,window.innerWidth*0.55));
    document.body.classList.add('resizingSidebar');
    resizer.setPointerCapture?.(e.pointerId);
    const move=ev=>{
      sidebarUI.width=clamp(ev.clientX,SIDEBAR_MIN_WIDTH,max);
      document.documentElement.style.setProperty('--sidebar-w',`${sidebarUI.width}px`);
    };
    const up=ev=>{
      resizer.removeEventListener('pointermove',move);
      resizer.removeEventListener('pointerup',up);
      resizer.removeEventListener('pointercancel',up);
      document.body.classList.remove('resizingSidebar');
      saveSidebarUI();
      try{resizer.releasePointerCapture?.(ev.pointerId)}catch{}
    };
    resizer.addEventListener('pointermove',move);
    resizer.addEventListener('pointerup',up);
    resizer.addEventListener('pointercancel',up);
  });
  window.addEventListener('resize',applySidebarUI);
}
const FALLBACK_HOLIDAYS = {
  '2026-01-01':['1월 1일'],'2026-02-16':['설날 전날'],'2026-02-17':['설날'],'2026-02-18':['설날 다음 날'],'2026-03-01':['3ㆍ1절'],'2026-03-02':['대체공휴일(3ㆍ1절)'],'2026-05-01':['노동절'],'2026-05-05':['어린이날'],'2026-05-24':['부처님 오신 날'],'2026-05-25':['대체공휴일(부처님 오신 날)'],'2026-06-03':['전국동시지방선거'],'2026-06-06':['현충일'],'2026-07-17':['제헌절'],'2026-08-15':['광복절'],'2026-08-17':['대체공휴일(광복절)'],'2026-09-24':['추석 전날'],'2026-09-25':['추석'],'2026-09-26':['추석 다음 날'],'2026-10-03':['개천절'],'2026-10-05':['대체공휴일(개천절)'],'2026-10-09':['한글날'],'2026-12-25':['기독탄신일'],
  '2027-01-01':['1월 1일'],'2027-02-06':['설날 전날'],'2027-02-07':['설날'],'2027-02-08':['설날 다음 날'],'2027-02-09':['대체공휴일(설날)'],'2027-03-01':['3ㆍ1절'],'2027-05-01':['노동절'],'2027-05-03':['대체공휴일(노동절)'],'2027-05-05':['어린이날'],'2027-05-13':['부처님 오신 날'],'2027-06-06':['현충일'],'2027-07-17':['제헌절'],'2027-07-19':['대체공휴일(제헌절)'],'2027-08-15':['광복절'],'2027-08-16':['대체공휴일(광복절)'],'2027-09-14':['추석 전날'],'2027-09-15':['추석'],'2027-09-16':['추석 다음 날'],'2027-10-03':['개천절'],'2027-10-04':['대체공휴일(개천절)'],'2027-10-09':['한글날'],'2027-10-11':['대체공휴일(한글날)'],'2027-12-25':['기독탄신일'],'2027-12-27':['대체공휴일(기독탄신일)']
};
function flattenHolidayData(raw){
  const out={};
  if(!raw || typeof raw!=='object') return out;
  for(const year of Object.values(raw)) if(year && typeof year==='object') for(const [date,names] of Object.entries(year)) out[date]=Array.isArray(names)?names:[String(names)];
  return out;
}
function fixedHolidayFallback(year){
  const dates={
    [`${year}-01-01`]:['1월 1일'],
    [`${year}-03-01`]:['3ㆍ1절'],
    [`${year}-05-05`]:['어린이날'],
    [`${year}-06-06`]:['현충일'],
    [`${year}-08-15`]:['광복절'],
    [`${year}-10-03`]:['개천절'],
    [`${year}-10-09`]:['한글날'],
    [`${year}-12-25`]:['기독탄신일']
  };
  return dates;
}
function holidaysForDate(date){
  const exact=holidayData[date] || FALLBACK_HOLIDAYS[date];
  if(exact) return exact;
  const year=Number(date.slice(0,4));
  return fixedHolidayFallback(year)[date] || [];
}
function holidayLabel(date){ return holidaysForDate(date).join(' · '); }
function holidayClass(date){ return holidaysForDate(date).length ? 'holiday' : ''; }
async function loadHolidayData(){
  try{
    const cache=JSON.parse(localStorage.getItem(HOLIDAY_CACHE_KEY)||'null');
    if(cache?.data){ holidayData=flattenHolidayData(cache.data); }
    const shouldRefresh=!cache?.savedAt || Date.now()-new Date(cache.savedAt).getTime()>HOLIDAY_CACHE_MAX_AGE;
    if(shouldRefresh){
      const res=await fetch(HOLIDAY_URL,{cache:'no-store'});
      if(!res.ok) throw new Error(`holiday fetch ${res.status}`);
      const data=await res.json();
      holidayData=flattenHolidayData(data);
      localStorage.setItem(HOLIDAY_CACHE_KEY,JSON.stringify({savedAt:new Date().toISOString(),data}));
      render();
    }
  }catch(err){
    console.warn('공휴일 데이터를 불러오지 못해 내장 공휴일 정보를 사용합니다.',err);
    if(!Object.keys(holidayData).length) holidayData={...FALLBACK_HOLIDAYS};
    render();
  }
}


const DEFAULT_SIDEBAR_SECTION_ORDER=['calendar','fixed','flexible','purchase','payment','dday','diary'];
function normalizeSidebarSectionOrder(value){
  const src=Array.isArray(value)?value.map(String):[];
  const valid=src.filter((x,i)=>DEFAULT_SIDEBAR_SECTION_ORDER.includes(x)&&src.indexOf(x)===i);
  for(const id of DEFAULT_SIDEBAR_SECTION_ORDER) if(!valid.includes(id)) valid.push(id);
  return valid;
}
function applySidebarSectionOrder(){
  const sidebar=$('#sidebar'); if(!sidebar) return;
  const order=normalizeSidebarSectionOrder(state.settings?.sidebarSectionOrder);
  state.settings.sidebarSectionOrder=order;
  order.forEach(id=>{ const sec=sidebar.querySelector(`[data-sidebar-section="${id}"]`); if(sec) sidebar.appendChild(sec); });
}
let sidebarSectionDragId='';
function commitSidebarSectionOrder(){
  const sidebar=$('#sidebar'); if(!sidebar) return;
  state.settings.sidebarSectionOrder=[...sidebar.querySelectorAll(':scope > [data-sidebar-section]')].map(x=>x.dataset.sidebarSection);
  save();
}
function bindSidebarSectionReorder(){
  const sidebar=$('#sidebar'); if(!sidebar) return;
  sidebar.querySelectorAll('.sidebarSectionGrip').forEach(grip=>{
    grip.ondragstart=e=>{
      const sec=grip.closest('[data-sidebar-section]'); if(!sec) return;
      sidebarSectionDragId=sec.dataset.sidebarSection;
      sec.classList.add('sidebarSectionDragging');
      e.dataTransfer.effectAllowed='move';
      try{ e.dataTransfer.setData('text/plain',`sidebar-section:${sidebarSectionDragId}`); }catch{}
    };
    grip.ondragend=()=>{
      sidebar.querySelectorAll('.sidebarSectionDragging,.sidebarSectionDrop').forEach(x=>x.classList.remove('sidebarSectionDragging','sidebarSectionDrop'));
      if(sidebarSectionDragId) commitSidebarSectionOrder();
      sidebarSectionDragId='';
    };
  });
  sidebar.querySelectorAll(':scope > [data-sidebar-section]').forEach(sec=>{
    sec.ondragover=e=>{
      if(!sidebarSectionDragId) return;
      const dragged=sidebar.querySelector(`[data-sidebar-section="${sidebarSectionDragId}"]`); if(!dragged || dragged===sec) return;
      e.preventDefault(); e.dataTransfer.dropEffect='move';
      const r=sec.getBoundingClientRect();
      const before=e.clientY<r.top+r.height/2;
      sidebar.insertBefore(dragged,before?sec:sec.nextSibling);
      sec.classList.add('sidebarSectionDrop');
    };
    sec.ondragleave=()=>sec.classList.remove('sidebarSectionDrop');
    sec.ondrop=e=>{ if(!sidebarSectionDragId) return; e.preventDefault(); sec.classList.remove('sidebarSectionDrop'); commitSidebarSectionOrder(); };
  });
}


function sidebarSectionCollapsed(id){
  state.settings.sidebarSectionsCollapsed=state.settings.sidebarSectionsCollapsed||{};
  return !!state.settings.sidebarSectionsCollapsed[id];
}
function bindSidebarSectionCollapse(){
  const sidebar=$('#sidebar'); if(!sidebar) return;
  sidebar.querySelectorAll(':scope > [data-sidebar-section]').forEach(sec=>{
    const id=sec.dataset.sidebarSection, head=sec.querySelector(':scope > .secHead'); if(!id||!head) return;
    head.querySelectorAll('.sidebarSectionToggle').forEach(x=>x.remove());
    const collapsed=sidebarSectionCollapsed(id);
    sec.classList.toggle('sidebarSectionCollapsed',collapsed);
    head.classList.toggle('sectionBandCollapsed',collapsed);
    head.setAttribute('role','button');
    head.setAttribute('tabindex','0');
    head.setAttribute('aria-expanded',collapsed?'false':'true');
    head.title=collapsed?'눌러서 메뉴 펼치기':'눌러서 메뉴 접기';
    const toggle=()=>{
      state.settings.sidebarSectionsCollapsed=state.settings.sidebarSectionsCollapsed||{};
      state.settings.sidebarSectionsCollapsed[id]=!sidebarSectionCollapsed(id);
      save();
    };
    head.onclick=e=>{
      // +, 수정, 드래그 손잡이 등 헤더 안의 실제 기능 버튼은 그대로 동작한다.
      if(e.target.closest('button,input,select,a,.sidebarSectionGrip')) return;
      e.preventDefault(); toggle();
    };
    head.onkeydown=e=>{
      if(e.key!=='Enter'&&e.key!==' ') return;
      if(e.target.closest('button,input,select,a,.sidebarSectionGrip')) return;
      e.preventDefault(); toggle();
    };
  });
}


function normalizeState(raw){
  const d = defaultState();
  const s = raw && typeof raw === 'object' ? raw : {};
  const calendars = Array.isArray(s.calendars) && s.calendars.length ? s.calendars.map((c,i)=>(
    {
      id:c.id||uid(), name:c.name||`캘린더 ${i+1}`, color:c.color||'#d9d9d9',
      order:Number(c.order)||i+1, period:c.period||'종일', capacity:Number(c.capacity)||0,
      capacityUnknown:!!c.capacityUnknown,
      capacityByDay:Object.fromEntries([0,1,2,3,4,5,6].map(d=>{
        const src=c.capacityByDay?.[d]??c.capacityByDay?.[String(d)];
        return [d,{hours:Number(src?.hours ?? c.capacity ?? 0)||0,unknown:src?.unknown!==undefined?!!src.unknown:!!c.capacityUnknown}];
      })),
      parentId:typeof c.parentId==='string'?c.parentId:''
    }
  )) : d.calendars;
  const ids = new Set(calendars.map(c=>c.id));
  calendars.forEach(c=>{ if(!c.parentId || c.parentId===c.id || !ids.has(c.parentId)) c.parentId=''; });
  // 손상된 백업 등에서 부모 순환참조가 들어와도 자동으로 최상위 캘린더로 복구합니다.
  calendars.forEach(c=>{
    const seen=new Set([c.id]); let cur=c;
    while(cur.parentId){
      if(seen.has(cur.parentId)){ c.parentId=''; break; }
      seen.add(cur.parentId);
      cur=calendars.find(x=>x.id===cur.parentId);
      if(!cur) break;
    }
  });
  return {
    version: '2.77',
    calendars,
    events: Array.isArray(s.events) ? s.events.filter(e=>e && e.id && e.title && e.date).map(e=>({
      ...e,
      endDate:e.endDate||e.date,
      allDay:e.allDay !== false,
      hours:Number(e.hours)||0,
      noDuration:!!e.noDuration,
      kind:e.kind||'event',
      important:!!e.important,
      availabilityBlock:!!e.availabilityBlock,
      availabilityTargetCalId:typeof e.availabilityTargetCalId==='string'?e.availabilityTargetCalId:'',
      repeat:e.repeat||'none',
      repeatRule:e.repeatRule||null,
      paymentAmount:Math.max(0,Number(e.paymentAmount)||0),
      paymentMethod:typeof e.paymentMethod==='string'?e.paymentMethod:'',
      prepEnabled:!!e.prepEnabled,
      prepDeadline:typeof e.prepDeadline==='string'&&e.prepDeadline?e.prepDeadline:(e.date||''),
      prepMode:e.prepMode==='custom'?'custom':'auto',
      prepAutoEnabled:typeof e.prepAutoEnabled==='boolean'?e.prepAutoEnabled:e.prepMode!=='custom',
      prepDays:Math.max(1,Number(e.prepDays)||5),
      prepWeekdaysOnly:!!e.prepWeekdaysOnly,
      prepIncludeDeadline:!!e.prepIncludeDeadline,
      prepDailyNotes:(e.prepDailyNotes&&typeof e.prepDailyNotes==='object')?Object.fromEntries(Object.entries(e.prepDailyNotes).map(([k,v])=>[String(k),String(v??'')])):{},
      prepDone:(e.prepDone&&typeof e.prepDone==='object')?Object.fromEntries(Object.entries(e.prepDone).filter(([,v])=>!!v).map(([k])=>[String(k),true])):{},
      prepMissed:(e.prepMissed&&typeof e.prepMissed==='object')?Object.fromEntries(Object.entries(e.prepMissed).filter(([,v])=>!!v).map(([k])=>[String(k),true])):{},
      prepMoves:(e.prepMoves&&typeof e.prepMoves==='object')?Object.fromEntries(Object.entries(e.prepMoves).filter(([,v])=>typeof v==='string'&&v).map(([k,v])=>[String(k),String(v)])):{},
      prepTasks:Array.isArray(e.prepTasks)?e.prepTasks.filter(x=>x&&['date','weekly','repeat'].includes(x.type)).map((x,i)=>({
        id:String(x.id||`prep-${i}-${uid()}`), type:x.type, text:String(x.text||'').trim(),
        date:x.type==='date'?String(x.date||''):'',
        startDate:['weekly','repeat'].includes(x.type)?String(x.startDate||''):'',
        weekday:x.type==='weekly'?Math.max(0,Math.min(6,Number(x.weekday)||0)):0,
        startMode:x.type==='repeat'&&x.startMode==='before'?'before':'date',
        beforeDays:x.type==='repeat'?Math.max(0,Math.min(365,Number(x.beforeDays)||0)):0,
        repeatType:x.type==='repeat'&&['daily','weekly','weekdays','weekends'].includes(x.repeatType)?x.repeatType:'daily',
        interval:x.type==='repeat'?Math.max(1,Math.min(99,Number(x.interval)||1)):1,
        weekdays:x.type==='repeat'&&Array.isArray(x.weekdays)?[...new Set(x.weekdays.map(Number).filter(n=>n>=0&&n<=6))]:[],
        endType:x.type==='repeat'&&x.endType==='date'?'date':'deadline',
        endDate:x.type==='repeat'&&x.endType==='date'?String(x.endDate||''):'',
        includeDeadline:x.type==='repeat'?!!x.includeDeadline:false
      })).filter(x=>x.text&&(x.type==='date'?x.date:(x.type==='weekly'?x.startDate:(x.startMode==='before'||x.startDate)))):[],
      excludedDates:Array.isArray(e.excludedDates)?e.excludedDates.map(String):[],
      done:!!e.done,
      doneDates:Array.isArray(e.doneDates)?e.doneDates:[],
      checklist:Array.isArray(e.checklist)?e.checklist.filter(x=>x&&String(x.text||'').trim()).map((x,i)=>({id:String(x.id||`cl-${i}-${uid()}`),text:String(x.text||'').trim()})):[],
      checklistDoneByDate:(e.checklistDoneByDate&&typeof e.checklistDoneByDate==='object')?Object.fromEntries(Object.entries(e.checklistDoneByDate).map(([k,v])=>[k,Array.isArray(v)?v.map(String):[]])):{},
      orderByDate:(e.orderByDate&&typeof e.orderByDate==='object')?Object.fromEntries(Object.entries(e.orderByDate).map(([k,v])=>[k,Number(v)||0])):{},
      repeatOrder:Number(e.repeatOrder)||0,
      carryoverCount:Math.max(0,Number(e.carryoverCount)||0),
      carryoverFromDate:typeof e.carryoverFromDate==='string'?e.carryoverFromDate:'',
      carryoverRootId:typeof e.carryoverRootId==='string'?e.carryoverRootId:'',
      carryoverParentId:typeof e.carryoverParentId==='string'?e.carryoverParentId:'',
      carryoverHistory:Array.isArray(e.carryoverHistory)?e.carryoverHistory.filter(r=>r&&r.fromDate&&r.toDate).map(r=>({
        fromDate:String(r.fromDate),toDate:String(r.toDate),childId:String(r.childId||''),remainingHours:Number(r.remainingHours)||0
      })):[]
    })) : [],
    fixed: Array.isArray(s.fixed) ? s.fixed.filter(f=>f && f.id && f.name).map(f=>({...f,hours:Number(f.hours)||0,noDuration:!!f.noDuration,important:!!f.important,checklist:Array.isArray(f.checklist)?f.checklist.filter(x=>x&&String(x.text||'').trim()).map((x,i)=>({id:String(x.id||`fcl-${i}-${uid()}`),text:String(x.text||'').trim()})):[]})) : [],
    flexible: Array.isArray(s.flexible) ? s.flexible.filter(f=>f && f.id && f.name).map(f=>({...f,hours:Number(f.hours)||0,noDuration:!!f.noDuration,important:!!f.important,checklist:Array.isArray(f.checklist)?f.checklist.filter(x=>x&&String(x.text||'').trim()).map((x,i)=>({id:String(x.id||`xcl-${i}-${uid()}`),text:String(x.text||'').trim()})):[]})) : [],
    purchases: Array.isArray(s.purchases) ? s.purchases.filter(p=>p && p.id && p.name).map((p,i)=>({id:String(p.id),name:String(p.name),qty:Math.max(1,Number(p.qty)||1),memo:String(p.memo||''),dueDate:typeof p.dueDate==='string'?p.dueDate:'',done:!!p.done,createdAt:String(p.createdAt||''),order:Number.isFinite(Number(p.order))?Number(p.order):i})) : [],
    diary: s.diary && typeof s.diary === 'object' ? s.diary : {},
    actualWork: (s.actualWork && typeof s.actualWork==='object') ? Object.fromEntries(Object.entries(s.actualWork).map(([date,rows])=>[
      String(date),
      (rows && typeof rows==='object') ? Object.fromEntries(Object.entries(rows).map(([calId,v])=>[String(calId),Math.max(0,Math.min(24,Number(v)||0))])) : {}
    ])) : {},
    settings: {
      hiddenCalendars: Array.isArray(s.settings?.hiddenCalendars) ? s.settings.hiddenCalendars : [],
      weekdayWidths: Array.from({length:7},(_,i)=>Math.max(40,Math.min(700,Number(s.settings?.weekdayWidths?.[i])||100))),
      weekdayWidthMode: s.settings?.weekdayWidthMode==='px'?'px':'ratio',
      weekdayWidthReference: Math.max(0,Number(s.settings?.weekdayWidthReference)||0),
      fixedPanelsCollapsed: {
        recurring: !!s.settings?.fixedPanelsCollapsed?.recurring,
        manual: !!s.settings?.fixedPanelsCollapsed?.manual,
        flexible: !!s.settings?.fixedPanelsCollapsed?.flexible,
        purchase: !!s.settings?.fixedPanelsCollapsed?.purchase,
        payment: !!s.settings?.fixedPanelsCollapsed?.payment,
        archivedRecurring: s.settings?.fixedPanelsCollapsed?.archivedRecurring !== false
      },
      sidebarCalendarGroupsCollapsed: {
        recurring: (s.settings?.sidebarCalendarGroupsCollapsed?.recurring && typeof s.settings.sidebarCalendarGroupsCollapsed.recurring==='object') ? {...s.settings.sidebarCalendarGroupsCollapsed.recurring} : {},
        archivedRecurring: (s.settings?.sidebarCalendarGroupsCollapsed?.archivedRecurring && typeof s.settings.sidebarCalendarGroupsCollapsed.archivedRecurring==='object') ? {...s.settings.sidebarCalendarGroupsCollapsed.archivedRecurring} : {},
        manual: (s.settings?.sidebarCalendarGroupsCollapsed?.manual && typeof s.settings.sidebarCalendarGroupsCollapsed.manual==='object') ? {...s.settings.sidebarCalendarGroupsCollapsed.manual} : {},
        flexible: (s.settings?.sidebarCalendarGroupsCollapsed?.flexible && typeof s.settings.sidebarCalendarGroupsCollapsed.flexible==='object') ? {...s.settings.sidebarCalendarGroupsCollapsed.flexible} : {},
        payment: (s.settings?.sidebarCalendarGroupsCollapsed?.payment && typeof s.settings.sidebarCalendarGroupsCollapsed.payment==='object') ? {...s.settings.sidebarCalendarGroupsCollapsed.payment} : {}
      },
      sidebarSectionOrder: normalizeSidebarSectionOrder(s.settings?.sidebarSectionOrder),
      sidebarSectionsCollapsed: (s.settings?.sidebarSectionsCollapsed && typeof s.settings.sidebarSectionsCollapsed==='object') ? {...s.settings.sidebarSectionsCollapsed} : {},
      mobileSectionsCollapsed: (s.settings?.mobileSectionsCollapsed && typeof s.settings.mobileSectionsCollapsed==='object') ? {...s.settings.mobileSectionsCollapsed} : {},
      dayCalendarGroupsCollapsed: (s.settings?.dayCalendarGroupsCollapsed && typeof s.settings.dayCalendarGroupsCollapsed==='object') ? {...s.settings.dayCalendarGroupsCollapsed} : {},
      laneHeights: (s.settings?.laneHeights && typeof s.settings.laneHeights==='object') ? Object.fromEntries(Object.entries(s.settings.laneHeights).map(([k,v])=>[k,Math.max(LANE_MIN_HEIGHT,Math.min(2400,Number(v)||0))]).filter(([,v])=>v)) : {},
      dayLaneHeights: (s.settings?.dayLaneHeights && typeof s.settings.dayLaneHeights==='object') ? Object.fromEntries(Object.entries(s.settings.dayLaneHeights).map(([k,v])=>[k,Math.max(52,Math.min(640,Number(v)||0))]).filter(([,v])=>v)) : {},
      dayLaneManual: (s.settings?.dayLaneManual && typeof s.settings.dayLaneManual==='object') ? Object.fromEntries(Object.entries(s.settings.dayLaneManual).filter(([,v])=>!!v).map(([k])=>[k,true])) : {},
      laneCollapsed: (s.settings?.laneCollapsed && typeof s.settings.laneCollapsed==='object') ? {...s.settings.laneCollapsed} : {},
      laneLabelWidth: (()=>{ const v=Number(s.settings?.laneLabelWidth); return v>=48?Math.max(48,Math.min(180,v)):72; })(),
      workloadRange: ['week','month','year'].includes(s.settings?.workloadRange) ? s.settings.workloadRange : 'week',
      weekViewMode: s.settings?.weekViewMode==='compact' ? 'compact' : 'detailed',
      monthShowCommonWithFocus: s.settings?.monthShowCommonWithFocus!==false,
      selectedDdayId: typeof s.settings?.selectedDdayId==='string' ? s.settings.selectedDdayId : ''
    }
  };
}

function storageKey(){ return currentUser ? `myCalendarV12:${currentUser.uid}` : 'myCalendarV12:guest'; }
function metaKey(){ return currentUser ? `myCalendarV12Meta:${currentUser.uid}` : 'myCalendarV12Meta:guest'; }
function legacyStorageKey(){ return currentUser ? `myCalendarV11:${currentUser.uid}` : 'myCalendarV11:guest'; }
function fmtDateTime(value){
  if(!value) return '-';
  const d = value instanceof Date ? value : new Date(value);
  if(Number.isNaN(d.getTime())) return '-';
  return `${d.getFullYear()}.${pad(d.getMonth()+1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function updateSaveIndicators(){
  const fb = fmtDateTime(lastFirebaseSavedAt);
  const local = fmtDateTime(lastLocalSavedAt);
  const fbEl=$('#lastFirebaseSave'), localEl=$('#lastLocalSave');
  if(fbEl) fbEl.textContent=fb;
  if(localEl) localEl.textContent=local;
  const badge=$('#saveBadge'), txt=$('#saveBadgeText');
  if(badge && txt && !badge.dataset.busy){
    txt.textContent = lastFirebaseSavedAt ? `Firebase 저장완료 · ${fmtDateTime(lastFirebaseSavedAt).split(' ')[1]}` : 'Firebase 확인 중';
    badge.className='saveBadge saved';
  }
}
function setSyncStatus(text, type='normal'){
  const stateEl=$('#syncState'); if(stateEl) stateEl.textContent=text;
  const badge=$('#saveBadge'), txt=$('#saveBadgeText');
  if(badge && txt){
    txt.textContent=text;
    badge.className=`saveBadge ${type}`;
    badge.dataset.busy = ['saving','error','loading','offline'].includes(type) ? '1' : '';
  }
}
function saveLocal(){
  if(!currentUser) return;
  localStorage.setItem(storageKey(), JSON.stringify(state));
  lastLocalSavedAt=new Date();
  localStorage.setItem(metaKey(), JSON.stringify({lastLocalSavedAt:lastLocalSavedAt.toISOString()}));
  updateSaveIndicators();
}
function loadLocal(){
  if(!currentUser) return defaultState();
  try {
    const meta=JSON.parse(localStorage.getItem(metaKey())||'null');
    lastLocalSavedAt=meta?.lastLocalSavedAt?new Date(meta.lastLocalSavedAt):null;
    const current=localStorage.getItem(storageKey());
    const legacy=localStorage.getItem(legacyStorageKey());
    const raw=current || legacy;
    const loaded=normalizeState(JSON.parse(raw || 'null'));
    if(!current && legacy){
      localStorage.setItem(storageKey(),JSON.stringify(loaded));
      lastLocalSavedAt=lastLocalSavedAt||new Date();
      localStorage.setItem(metaKey(),JSON.stringify({lastLocalSavedAt:lastLocalSavedAt.toISOString()}));
    }
    return loaded;
  }
  catch { return defaultState(); }
}
function timestampToDate(ts){
  if(!ts) return null;
  if(typeof ts.toDate==='function') return ts.toDate();
  if(ts.seconds) return new Date(ts.seconds*1000);
  return null;
}
async function writeRemoteNow(reason='save'){
  if(!syncReady || !remoteRef || applyingRemote) return false;
  clearTimeout(saveTimer); saveTimer=null;
  localDirty=true; writeInFlight=true;
  setSyncStatus(reason==='restore'?'백업 복원 저장 중…':reason==='manual'?'최신자료 저장 중…':'저장 중…','saving');
  try{
    await setDoc(remoteRef,{state,updatedAt:serverTimestamp()},{merge:false});
    localDirty=false; writeInFlight=false;
    lastFirebaseSavedAt=new Date();
    updateSaveIndicators();
    setSyncStatus(`✓ Firebase 저장완료 · ${fmtDateTime(lastFirebaseSavedAt).split(' ')[1]}`,'saved');
    return true;
  }catch(e){
    writeInFlight=false;
    console.error(e);
    setSyncStatus('⚠ Firebase 저장 실패','error');
    return false;
  }
}
function queueRemoteSave(){
  if(!syncReady || !remoteRef || applyingRemote) return;
  localDirty=true;
  setSyncStatus('저장 대기…','saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(()=>writeRemoteNow('save'), 300);
}
function save({rerender=true}={}){
  saveLocal();
  queueRemoteSave();
  if(rerender) render();
}

function sortedRawCals(list=state.calendars){ return [...list].sort((a,b)=>(a.order-b.order)||a.name.localeCompare(b.name)); }
function cal(id){ return state.calendars.find(x=>x.id===id) || state.calendars[0] || {id:'',name:'미지정',color:'#ddd',order:999,capacity:0,capacityUnknown:false,period:'종일',parentId:''}; }
function directChildren(parentId){ return sortedRawCals(state.calendars.filter(c=>c.parentId===parentId)); }
function calendarDepth(id){
  let depth=0, cur=state.calendars.find(c=>c.id===id), seen=new Set();
  while(cur?.parentId && depth<20 && !seen.has(cur.parentId)){
    seen.add(cur.id); depth++; cur=state.calendars.find(c=>c.id===cur.parentId);
  }
  return depth;
}
function descendants(id){
  const out=[]; const seen=new Set();
  const walk=pid=>{ for(const child of directChildren(pid)){ if(seen.has(child.id)) continue; seen.add(child.id); out.push(child); walk(child.id); } };
  walk(id); return out;
}
function topAncestor(cOrId){
  let cur=typeof cOrId==='string'?state.calendars.find(c=>c.id===cOrId):cOrId;
  if(!cur) return null;
  const seen=new Set([cur.id]);
  while(cur.parentId){
    const p=state.calendars.find(c=>c.id===cur.parentId);
    if(!p || seen.has(p.id)) break;
    seen.add(p.id); cur=p;
  }
  return cur;
}
function topLevelCals(){
  const ids=new Set(state.calendars.map(c=>c.id));
  return sortedRawCals(state.calendars.filter(c=>!c.parentId || !ids.has(c.parentId)));
}
function cals(){
  const out=[], visited=new Set();
  const walk=c=>{ if(!c || visited.has(c.id)) return; visited.add(c.id); out.push(c); directChildren(c.id).forEach(walk); };
  topLevelCals().forEach(walk);
  sortedRawCals().forEach(walk);
  return out;
}
function isCalendarHidden(id){
  return new Set(state.settings.hiddenCalendars||[]).has(id);
}
function visibleCals(){ return cals().filter(c=>!isCalendarHidden(c.id)); }
function sanitizeCalendarFocus(){
  const valid=new Set(state.calendars.map(c=>c.id));
  calendarFocusIds=new Set([...calendarFocusIds].filter(id=>valid.has(id)));
  return calendarFocusIds;
}
function focusedCalendarIds(){
  sanitizeCalendarFocus();
  if(!calendarFocusIds.size) return null;
  const out=new Set();
  for(const id of calendarFocusIds){
    out.add(id);
    descendants(id).forEach(c=>out.add(c.id));
  }
  return out;
}
function displayCals(){
  const visible=visibleCals();
  const focused=focusedCalendarIds();
  return focused?visible.filter(c=>focused.has(c.id)):visible;
}
function focusedCalendarList(){
  sanitizeCalendarFocus();
  return cals().filter(c=>calendarFocusIds.has(c.id));
}
function focusLabel(){
  const xs=focusedCalendarList();
  if(!xs.length) return '';
  if(xs.length===1) return calendarPath(xs[0].id);
  return `${xs.slice(0,2).map(c=>c.name).join(' · ')}${xs.length>2?` 외 ${xs.length-2}개`:''}`;
}
function focusSuffix(){ const label=focusLabel(); return label?` · ${label}만 보기`:''; }
function compactFocusSuffix(){ const label=focusLabel(); return label?` · ${label}`:''; }
function setRangeLabel(fullText, compactText=fullText){
  const el=$('#range'); if(!el) return;
  el.textContent=window.matchMedia('(max-width: 760px)').matches?compactText:fullText;
  el.title=fullText;
}
function calendarPath(id){
  let cur=state.calendars.find(c=>c.id===id); if(!cur) return '미지정';
  const parts=[], seen=new Set();
  while(cur && !seen.has(cur.id)){ parts.unshift(cur.name); seen.add(cur.id); cur=cur.parentId?state.calendars.find(c=>c.id===cur.parentId):null; }
  return parts.join(' › ');
}
function duration(e){ return e?.noDuration ? 0 : (Number(e?.hours)||0); }
function durationLabel(e){ return e?.noDuration ? '소요시간 미체크' : fmtH(Number(e?.hours)||0); }
function availabilityBlockTargetRootId(e){
  const raw=e?.availabilityTargetCalId || e?.calId || '';
  const root=topAncestor(raw);
  return root?.id || raw;
}
function availabilityBlockOnDate(rootId,date){
  if(!rootId || !date) return false;
  const targetRoot=topAncestor(rootId)?.id || rootId;
  for(const e of state.events){
    if(!e?.availabilityBlock || e.kind==='payment' || e.kind==='anniversary') continue;
    if(availabilityBlockTargetRootId(e)!==targetRoot) continue;
    const span=Math.max(0,diffDays(e.date,e.endDate||e.date));
    const starts=generateOccurrenceStarts(e,ds(add(parse(date),-span)),date);
    for(const start of starts){
      const occ=ds(start);
      if((e.excludedDates||[]).includes(occ)) continue;
      const end=add(start,span);
      if(start<=parse(date) && end>=parse(date)) return true;
    }
  }
  return false;
}
function capacityForDate(c,date){
  const root=topAncestor(c)||c;
  if(!root) return {hours:0,unknown:false,blocked:false};
  if(availabilityBlockOnDate(root.id,date)) return {hours:0,unknown:false,blocked:true};
  const dow=parse(date).getDay();
  const src=root?.capacityByDay?.[dow]??root?.capacityByDay?.[String(dow)];
  if(src) return {hours:Number(src.hours)||0,unknown:!!src.unknown,blocked:false};
  return {hours:Number(root?.capacity)||0,unknown:!!root?.capacityUnknown,blocked:false};
}
function capacityForWeek(c,startDate){
  let hours=0,unknownDays=0,blockedDays=0;
  for(let i=0;i<7;i++){
    const info=capacityForDate(c,ds(add(startDate,i)));
    if(info.blocked) blockedDays++;
    else if(info.unknown) unknownDays++;
    else hours+=info.hours;
  }
  return {hours,unknownDays,blockedDays,unknown:unknownDays>0};
}
function capacitySidebarLabel(c){
  if(c?.parentId) return '상위 공유';
  const vals=[0,1,2,3,4,5,6].map(d=>{ const x=c?.capacityByDay?.[d]??c?.capacityByDay?.[String(d)]; return x?`${!!x.unknown?'u':'k'}:${Number(x.hours)||0}`:`${!!c?.capacityUnknown?'u':'k'}:${Number(c?.capacity)||0}`; });
  if(new Set(vals).size===1){ const [flag,val]=vals[0].split(':'); return flag==='u'?'미정':`${val}h`; }
  return '요일별';
}
function workloadDuration(e){ return e?.availabilityBlock ? 0 : duration(e); }
function fmtH(h){
  const value = Math.max(0, Number(h) || 0);
  const rounded = Math.round(value * 100) / 100;
  const text = Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(/0+$/,'').replace(/\.$/,'');
  return `${text}h`;
}
function getDurationInputs(prefix=''){
  const h = Number($(`#${prefix}hoursH`)?.value)||0;
  const m = Number($(`#${prefix}hoursM`)?.value)||0;
  return h + clamp(m,0,59)/60;
}
function setDurationInputs(value, prefix=''){
  const total = Math.max(0, Math.round((Number(value)||0)*60));
  const h = Math.floor(total/60), m=total%60;
  $(`#${prefix}hoursH`).value = h;
  $(`#${prefix}hoursM`).value = m;
}
function updateDurationUI(prefix=''){
  const cb=$(`#${prefix}noDuration`); if(!cb) return;
  const off=!!cb.checked;
  const h=$(`#${prefix}hoursH`), m=$(`#${prefix}hoursM`);
  if(h) h.disabled=off; if(m) m.disabled=off;
  const box=cb.closest('.durationField'); if(box) box.classList.toggle('durationUnchecked',off);
}
function daysInMonth(y,m0){ return new Date(y,m0+1,0).getDate(); }
function validLocalDate(y,m0,d){
  const x = new Date(y,m0,d);
  return x.getFullYear()===y && x.getMonth()===m0 && x.getDate()===d ? x : null;
}
function nthWeekday(y,m0,weekday,nth){
  const first = new Date(y,m0,1);
  const offset = (weekday-first.getDay()+7)%7;
  const day = 1 + offset + (nth-1)*7;
  return day<=daysInMonth(y,m0) ? new Date(y,m0,day) : null;
}
function lastWeekday(y,m0,weekday){
  const last = new Date(y,m0+1,0);
  const back = (last.getDay()-weekday+7)%7;
  return new Date(y,m0,last.getDate()-back);
}
function getNthLabel(n){ return ['첫째','둘째','셋째','넷째','다섯째'][n-1]||`${n}번째`; }
function weekdayName(n){ return ['일','월','화','수','목','금','토'][n]+'요일'; }

// Korean lunar calendar conversion based on KASI/KARI standard.
// Conversion data/algorithm derived from usingsky/korean_lunar_calendar (MIT).
const lunarFormatter={calendar:'korean-kasi'};
const KOREAN_LUNAR_BASE_YEAR=1000;
const KOREAN_LUNAR_MAX_YEAR=2050;
const KOREAN_LUNAR_DATA=[0x82c60a57,0x82fec52b,0x82c40d2a,0x82c60d55,0xc30095ad,0x82c4056a,0x82c6096d,0x830054dd,0xc2c404ad,0x82c40a4d,0x83002e4d,0x82c40b26,0xc300ab56,0x82c60ad5,0x82c4035a,0x8300697a,0xc2c6095b,0x82c4049b,0x83004a9b,0x82c40a4b,0xc301caa5,0x82c406aa,0x82c60ad5,0x830092dd,0xc2c402b5,0x82c60957,0x82fe54ae,0x82c60c97,0xc2c4064b,0x82ff254a,0x82c60da9,0x8300a6b6,0xc2c6066d,0x82c4026e,0x8301692e,0x82c4092e,0xc2c40c96,0x83004d95,0x82c40d4a,0x8300cd69,0xc2c40b58,0x82c80d6b,0x8301926b,0x82c4025d,0xc2c4092b,0x83005aab,0x82c40a95,0x82c40b4a,0xc3021eab,0x82c402d5,0x8301b55a,0x82c604bb,0xc2c4025b,0x83007537,0x82c4052b,0x82c40695,0xc3003755,0x82c406aa,0x8303cab5,0x82c40275,0xc2c404b6,0x83008a5e,0x82c40a56,0x82c40d26,0xc3005ea6,0x82c60d55,0x82c405aa,0x83001d6a,0xc2c6096d,0x8300b4af,0x82c4049d,0x82c40a4d,0xc3007d2d,0x82c40aa6,0x82c60b55,0x830045d5,0xc2c4035a,0x82c6095d,0x83011173,0x82c4045b,0xc3009a4f,0x82c4064b,0x82c40aa5,0x83006b69,0xc2c606b5,0x82c402da,0x83002ab6,0x82c60937,0xc2fec497,0x82c60c97,0x82c4064b,0x82fe86aa,0xc2c60da5,0x82c405b4,0x83034a6d,0x82c402ae,0xc2c40e61,0x83002d2e,0x82c40c96,0x83009d4d,0x82c40d4a,0x82c60d65,0x83016595,0x82c6055d,0xc2c4026d,0x83002a5d,0x82c4092b,0x8300aa97,0xc2c40a95,0x82c40b4a,0x83008b5a,0x82c60ad5,0xc2c6055b,0x830042b7,0x82c40457,0x82c4052b,0xc3001d2b,0x82c40695,0x8300972d,0x82c405aa,0xc2c60ab5,0x830054ed,0x82c404b6,0x82c60a57,0xc2ff344e,0x82c40d26,0x8301be92,0x82c60d55,0xc2c405aa,0x830089ba,0x82c6096d,0x82c404ae,0xc3004a9d,0x82c40a4d,0x82c40d25,0x83002f25,0xc2c40b54,0x8303ad69,0x82c402da,0x82c6095d,0xc301649b,0x82c4049b,0x82c40a4b,0x83004b4b,0xc2c406a5,0x8300bb53,0x82c406b4,0x82c60ab6,0xc3018956,0x82c60997,0x82c40497,0x83004697,0xc2c4054b,0x82fec6a5,0x82c60da5,0x82c405ac,0xc303aab5,0x82c4026e,0x82c4092e,0x83006cae,0xc2c40c96,0x82c40d4a,0x83002f4a,0x82c60d55,0xc300b56b,0x82c6055b,0x82c4025d,0x8300793d,0xc2c40927,0x82c40a95,0x83015d15,0x82c40b4a,0xc2c60b55,0x830112d5,0x82c604db,0x82fe925e,0xc2c60a57,0x82c4052b,0x83006aab,0x82c40695,0xc2c406aa,0x83003baa,0x82c60ab5,0x8300b4b7,0xc2c404ae,0x82c60a57,0x82fe752e,0x82c40d26,0xc2c60e93,0x830056d5,0x82c405aa,0x82c609b5,0xc300256d,0x82c404ae,0x8301aa4d,0x82c40a4d,0xc2c40d26,0x83006d65,0x82c40b52,0x82c60d6a,0xc30026da,0x82c6095d,0x8301c49d,0x82c4049b,0xc2c40a4b,0x83008aab,0x82c406a5,0x82c40b54,0xc3004bb4,0x82c60ab6,0x82c6095b,0x83002537,0xc2c40497,0x8300964f,0x82c4054b,0x82c406a5,0xc30176c5,0x82c405ac,0x82c60ab6,0x8301386e,0xc2c4092e,0x8300cc97,0x82c40c96,0x82c40d4a,0xc3008daa,0x82c60b55,0x82c4056a,0x83025adb,0xc2c4025d,0x82c4092e,0x83002d2b,0x82c40a95,0xc3009d4d,0x82c40b2a,0x82c60b55,0x83007575,0xc2c404da,0x82c60a5b,0x83004557,0x82c4052b,0xc301ca93,0x82c40693,0x82c406aa,0x83008ada,0xc2c60ae5,0x82c404b6,0x83004aae,0x82c60a57,0xc2c40527,0x82ff2526,0x82c60e53,0x8300a6cb,0xc2c405aa,0x82c605ad,0x830164ad,0x82c404ae,0xc2c40a4e,0x83004d4d,0x82c40d26,0x8300bd53,0xc2c40b52,0x82c60b6a,0x8301956a,0x82c60557,0xc2c4049d,0x83015a1b,0x82c40a4b,0x82c40aa5,0xc3001ea5,0x82c40b52,0x8300bb5a,0x82c60ab6,0xc2c6095b,0x830064b7,0x82c40497,0x82c4064b,0xc300374b,0x82c406a5,0x8300b6b3,0x82c405ac,0xc2c60ab6,0x830182ad,0x82c4049e,0x82c40a4d,0xc3005d4b,0x82c40b25,0x82c40b52,0x83012e52,0xc2c60b5a,0x8300a95e,0x82c6095b,0x82c4049b,0xc3006a57,0x82c40a4b,0x82c40aa5,0x83004ba5,0xc2c406d4,0x8300cad6,0x82c60ab6,0x82c60937,0x8300849f,0x82c40497,0x82c4064b,0x82fe56ca,0xc2c60da5,0x82c405aa,0x83001d6c,0x82c60a6e,0xc300b92f,0x82c4092e,0x82c40c96,0x83007d55,0xc2c40d4a,0x82c60d55,0x83013555,0x82c4056a,0xc2c60a6d,0x83001a5d,0x82c4092b,0x83008a5b,0xc2c40a95,0x82c40b2a,0x83015b2a,0x82c60ad5,0xc2c404da,0x83001cba,0x82c60a57,0x8300952f,0xc2c40527,0x82c40693,0x830076b3,0x82c406aa,0xc2c60ab5,0x83003575,0x82c404b6,0x8300ca67,0xc2c40a2e,0x82c40d16,0x83008e96,0x82c40d4a,0xc2c60daa,0x830055ea,0x82c6056d,0x82c404ae,0xc301285d,0x82c40a2d,0x8300ad17,0x82c40aa5,0xc2c40b52,0x83007d74,0x82c60ada,0x82c6055d,0xc300353b,0x82c4045b,0x82c40a2b,0x83011a2b,0xc2c40aa5,0x83009b55,0x82c406b2,0x82c60ad6,0xc3015536,0x82c60937,0x82c40457,0x83003a57,0xc2c4052b,0x82feaaa6,0x82c60d95,0x82c405aa,0xc3017aac,0x82c60a6e,0x82c4052e,0x83003cae,0xc2c40a56,0x8300bd2b,0x82c40d2a,0x82c60d55,0xc30095ad,0x82c4056a,0x82c60a6d,0x8300555d,0xc2c4052b,0x82c40a8d,0x83002e55,0x82c40b2a,0xc300ab56,0x82c60ad5,0x82c404da,0x83006a7a,0xc2c60a57,0x82c4051b,0x83014a17,0x82c40653,0xc301c6a9,0x82c405aa,0x82c60ab5,0x830092bd,0xc2c402b6,0x82c60a37,0x82fe552e,0x82c40d16,0x82c60e4b,0x82fe3752,0x82c60daa,0x8301b5b4,0xc2c6056d,0x82c402ae,0x83007a3d,0x82c40a2d,0xc2c40d15,0x83004d95,0x82c40b52,0x8300cb69,0xc2c60ada,0x82c6055d,0x8301925b,0x82c4045b,0xc2c40a2b,0x83005aab,0x82c40a95,0x82c40b52,0xc3001eaa,0x82c60ab6,0x8300c55b,0x82c604b7,0xc2c40457,0x83007537,0x82c4052b,0x82c40695,0xc3014695,0x82c405aa,0x8300cab5,0x82c60a6e,0xc2c404ae,0x83008a5e,0x82c40a56,0x82c40d2a,0xc3006eaa,0x82c60d55,0x82c4056a,0x8301295a,0xc2c6095d,0x8300b4af,0x82c4049b,0x82c40a4d,0xc3007d2d,0x82c40b2a,0x82c60b55,0x830045d5,0xc2c402da,0x82c6095b,0x83011157,0x82c4049b,0xc3009a4f,0x82c4064b,0x82c406a9,0x83006aea,0xc2c606b5,0x82c402b6,0x83002aae,0x82c60937,0xc2ffb496,0x82c40c96,0x82c60e4b,0x82fe76b2,0xc2c60daa,0x82c605ad,0x8300336d,0x82c4026e,0xc2c4092e,0x83002d2d,0x82c40c95,0x83009d4d,0xc2c40b4a,0x82c60b69,0x8301655a,0x82c6055b,0xc2c4025d,0x83002a5b,0x82c4092b,0x8300aa97,0xc2c40695,0x82c4074a,0x83008b5a,0x82c60ab6,0xc2c6053b,0x830042b7,0x82c40257,0x82c4052b,0xc3001d2b,0x82c40695,0x830096ad,0x82c405aa,0xc2c60ab5,0x830054ed,0x82c404ae,0x82c60a57,0xc2ff344e,0x82c40d2a,0x8301bd94,0x82c60b55,0x82c4056a,0x8300797a,0x82c6095d,0x82c404ae,0xc3004a9b,0x82c40a4d,0x82c40d25,0x83011aaa,0xc2c60b55,0x8300956d,0x82c402da,0x82c6095b,0xc30054b7,0x82c40497,0x82c40a4b,0x83004b4b,0xc2c406a9,0x8300cad5,0x82c605b5,0x82c402b6,0xc300895e,0x82c6092f,0x82c40497,0x82fe4696,0xc2c40d4a,0x8300cea5,0x82c60d69,0x82c6056d,0xc301a2b5,0x82c4026e,0x82c4092e,0x83006cad,0xc2c40c95,0x82c40d4a,0x83002f4a,0x82c60b59,0xc300c56d,0x82c6055b,0x82c4025d,0x8300793b,0xc2c4092b,0x82c40a95,0x83015b15,0x82c406ca,0xc2c60ad5,0x830112b6,0x82c604bb,0x8300925f,0xc2c40257,0x82c4052b,0x82fe6aaa,0x82c60e95,0xc2c406aa,0x83003baa,0x82c60ab5,0x8300b4b7,0xc2c404ae,0x82c60a57,0x82fe752d,0x82c40d26,0xc2c60d95,0x830055d5,0x82c4056a,0x82c6096d,0xc300255d,0x82c404ae,0x8300aa4f,0x82c40a4d,0xc2c40d25,0x83006d69,0x82c60b55,0x82c4035a,0xc3002aba,0x82c6095b,0x8301c49b,0x82c40497,0xc2c40a4b,0x83008b2b,0x82c406a5,0x82c406d4,0xc3034ab5,0x82c402b6,0x82c60937,0x8300252f,0xc2c40497,0x82fe964e,0x82c40d4a,0x82c60ea5,0xc30166a9,0x82c6056d,0x82c402b6,0x8301385e,0xc2c4092e,0x8300bc97,0x82c40a95,0x82c40d4a,0xc3008daa,0x82c60b4d,0x82c6056b,0x830042db,0xc2c4025d,0x82c4092d,0x83002d2b,0x82c40a95,0xc3009b4d,0x82c406aa,0x82c60ad5,0x83006575,0xc2c604bb,0x82c4025b,0x83013457,0x82c4052b,0xc2ffba94,0x82c60e95,0x82c406aa,0x83008ada,0xc2c609b5,0x82c404b6,0x83004aae,0x82c60a4f,0xc2c20526,0x83012d26,0x82c60d55,0x8301a5a9,0xc2c4056a,0x82c6096d,0x8301649d,0x82c4049e,0xc2c40a4d,0x83004d4d,0x82c40d25,0x8300bd53,0xc2c40b54,0x82c60b5a,0x8301895a,0x82c6095b,0xc2c4049b,0x83004a97,0x82c40a4b,0x82c40aa5,0xc3001ea5,0x82c406d4,0x8302badb,0x82c402b6,0xc2c60937,0x830064af,0x82c40497,0x82c4064b,0xc2fe374a,0x82c60da5,0x8300b6b5,0x82c6056d,0xc2c402ae,0x8300793e,0x82c4092e,0x82c40c96,0xc3015d15,0x82c40d4a,0x82c60da5,0x83013555,0xc2c4056a,0x83007a7a,0x82c60a5d,0x82c4092d,0xc3006aab,0x82c40a95,0x82c40b4a,0x83004baa,0xc2c60ad5,0x82c4055a,0x830128ba,0x82c60a5b,0xc3007537,0x82c4052b,0x82c40693,0x83015715,0xc2c406aa,0x82c60ad5,0x830035b5,0x82c404b6,0xc3008a5e,0x82c40a4e,0x82c40d26,0x83006ea6,0xc2c40d52,0x82c60daa,0x8301466a,0x82c6056d,0xc2c404ae,0x83003a9d,0x82c40a4d,0x83007d2b,0xc2c40b25,0x82c40d52,0x83015d54,0x82c60b5a,0xc2c6055d,0x8300355b,0x82c4049b,0x83007657,0x82c40a4b,0x82c40aa5,0x83006b65,0x82c406d2,0xc2c60ada,0x830045b6,0x82c60937,0x82c40497,0xc3003697,0x82c4064d,0x82fe76aa,0x82c60da5,0xc2c405aa,0x83005aec,0x82c60aae,0x82c4092e,0xc3003d2e,0x82c40c96,0x83018d45,0x82c40d4a,0xc2c60d55,0x83016595,0x82c4056a,0x82c60a6d,0xc300455d,0x82c4052d,0x82c40a95,0x83013c95,0xc2c40b4a,0x83017b4a,0x82c60ad5,0x82c4055a,0xc3015a3a,0x82c60a5b,0x82c4052b,0x83014a17,0xc2c40693,0x830096ab,0x82c406aa,0x82c60ab5,0xc30064f5,0x82c404b6,0x82c60a57,0x82fe452e,0xc2c40d16,0x82c60e93,0x82fe3752,0x82c60daa,0xc30175aa,0x82c6056d,0x82c404ae,0x83015a1d,0xc2c40a2d,0x82c40d15,0x83004da5,0x82c40b52,0xc3009d6a,0x82c60ada,0x82c6055d,0x8301629b,0xc2c4045b,0x82c40a2b,0x83005b2b,0x82c40a95,0xc2c40b52,0x83012ab2,0x82c60ad6,0x83017556,0xc2c60537,0x82c40457,0x83005657,0x82c4052b,0xc2c40695,0x83003795,0x82c405aa,0x8300aab6,0xc2c60a6d,0x82c404ae,0x83006a6e,0x82c40a56,0xc2c40d2a,0x83005eaa,0x82c60d55,0x82c405aa,0xc3003b6a,0x82c60a6d,0x830074bd,0x82c404ab,0xc2c40a8d,0x83005d55,0x82c40b2a,0x82c60b55,0xc30045d5,0x82c404da,0x82c6095d,0x83002557,0xc2c4049b,0x83006a97,0x82c4064b,0x82c406a9,0x83004baa,0x82c606b5,0x82c402ba,0x83002ab6,0xc2c60937,0x82fe652e,0x82c40d16,0x82c60e4b,0xc2fe56d2,0x82c60da9,0x82c605b5,0x8300336d,0xc2c402ae,0x82c40a2e,0x83002e2d,0x82c40c95,0xc3006d55,0x82c40b52,0x82c60b69,0x830045da,0xc2c6055d,0x82c4025d,0x83003a5b,0x82c40a2b,0xc3017a8b,0x82c40a95,0x82c40b4a,0x83015b2a,0xc2c60ad5,0x82c6055b,0x830042b7,0x82c40257,0xc300952f,0x82c4052b,0x82c40695,0x830066d5,0xc2c405aa,0x82c60ab5,0x8300456d,0x82c404ae,0xc2c60a57,0x82ff3456,0x82c40d2a,0x83017e8a,0xc2c60d55,0x82c405aa,0x83005ada,0x82c6095d,0xc2c404ae,0x83004aab,0x82c40a4d,0x83008d2b,0xc2c40b29,0x82c60b55,0x83007575,0x82c402da,0xc2c6095d,0x830054d7,0x82c4049b,0x82c40a4b,0xc3013a4b,0x82c406a9,0x83008ad9,0x82c606b5,0xc2c402b6,0x83015936,0x82c60937,0x82c40497,0xc2fe4696,0x82c40e4a,0x8300aea6,0x82c60da9,0xc2c605ad,0x830162ad,0x82c402ae,0x82c4092e,0xc3005cad,0x82c40c95,0x82c40d4a,0x83013d4a,0xc2c60b69,0x8300757a,0x82c6055b,0x82c4025d,0xc300595b,0x82c4092b,0x82c40a95,0x83004d95,0xc2c40b4a,0x82c60b55,0x830026d5,0x82c6055b,0xc3006277,0x82c40257,0x82c4052b,0x82fe5aaa,0xc2c60e95,0x82c406aa,0x83003baa,0x82c60ab5,0x830084bd,0x82c404ae,0x82c60a57,0x82fe554d,0xc2c40d26,0x82c60d95,0x83014655,0x82c4056a,0xc2c609ad,0x8300255d,0x82c404ae,0x83006a5b,0xc2c40a4d,0x82c40d25,0x83005da9,0x82c60b55,0xc2c4056a,0x83002ada,0x82c6095d,0x830074bb,0xc2c4049b,0x82c40a4b,0x83005b4b,0x82c406a9,0xc2c40ad4,0x83024bb5,0x82c402b6,0x82c6095b,0xc3002537,0x82c40497,0x82fe6656,0x82c40e4a,0xc2c60ea5,0x830156a9,0x82c605b5,0x82c402b6,0xc30138ae,0x82c4092e,0x83017c8d,0x82c40c95,0xc2c40d4a,0x83016d8a,0x82c60b69,0x82c6056d,0xc301425b,0x82c4025d,0x82c4092d,0x83002d2b,0xc2c40a95,0x83007d55,0x82c40b4a,0x82c60b55,0xc3015555,0x82c604db,0x82c4025b,0x83013857,0xc2c4052b,0x83008a9b,0x82c40695,0x82c406aa,0xc3006aea,0x82c60ab5,0x82c404b6,0x83004aae,0xc2c60a57,0x82c40527,0x82fe3726,0x82c60d95,0xc30076b5,0x82c4056a,0x82c609ad,0x830054dd,0xc2c404ae,0x82c40a4e,0x83004d4d,0x82c40d25,0xc3008d59,0x82c40b54,0x82c60d6a,0x8301695a,0xc2c6095b,0x82c4049b,0x83004a9b,0x82c40a4b,0xc300ab27,0x82c406a5,0x82c406d4,0x83026b75,0xc2c402b6,0x82c6095b,0x830054b7,0x82c40497,0xc2c4064b,0x82fe374a,0x82c60ea5,0x830086d9,0xc2c605ad,0x82c402b6,0x8300596e,0x82c4092e,0xc2c40c96,0x83004e95,0x82c40d4a,0x82c60da5,0xc3002755,0x82c4056c,0x83027abb,0x82c4025d,0xc2c4092d,0x83005cab,0x82c40a95,0x82c40b4a,0xc3013b4a,0x82c60b55,0x8300955d,0x82c404ba,0xc2c60a5b,0x83005557,0x82c4052b,0x82c40a95,0xc3004b95,0x82c406aa,0x82c60ad5,0x830026b5,0xc2c404b6,0x83006a6e,0x82c60a57,0x82c40527,0xc2fe56a6,0x82c60d93,0x82c405aa,0x83003b6a,0xc2c6096d,0x8300b4af,0x82c404ae,0x82c40a4d,0xc3016d0d,0x82c40d25,0x82c40d52,0x83005dd4,0xc2c60b6a,0x82c6096d,0x8300255b,0x82c4049b,0xc3007a57,0x82c40a4b,0x82c40b25,0x83015b25,0xc2c406d4,0x82c60ada,0x830138b6];
const KL_SOLAR_DAYS=[31,28,31,30,31,30,31,31,30,31,30,31,29];
const KL_SOLAR_LUNAR_DAY_DIFF=43;
function klLunarData(year){
  const i=Number(year)-KOREAN_LUNAR_BASE_YEAR;
  return i>=0&&i<KOREAN_LUNAR_DATA.length ? KOREAN_LUNAR_DATA[i]>>>0 : 0;
}
function klLeapMonth(data){ return (data>>>12)&0x0f; }
function klLunarDays(year,month=null,isLeap=false){
  const data=klLunarData(year); if(!data) return 0;
  if(month!=null){
    month=Number(month);
    if(month<1||month>12) return 0;
    if(isLeap && klLeapMonth(data)===month) return ((data>>>16)&1)?30:29;
    return ((data>>>(12-month))&1)?30:29;
  }
  return (data>>>17)&0x01ff;
}
function klSolarLeapYear(year){ const data=klLunarData(year); return !!data && (((data>>>30)&1)>0); }
function klSolarDays(year,month=null){
  if(month==null) return klSolarLeapYear(year)?366:365;
  month=Number(month); if(month<1||month>12) return 0;
  return month===2 && klSolarLeapYear(year) ? 29 : KL_SOLAR_DAYS[month-1];
}
const KL_LUNAR_PREFIX=[0],KL_SOLAR_PREFIX=[0];
for(let y=KOREAN_LUNAR_BASE_YEAR;y<=KOREAN_LUNAR_MAX_YEAR;y++){
  KL_LUNAR_PREFIX.push(KL_LUNAR_PREFIX[KL_LUNAR_PREFIX.length-1]+klLunarDays(y));
  KL_SOLAR_PREFIX.push(KL_SOLAR_PREFIX[KL_SOLAR_PREFIX.length-1]+klSolarDays(y));
}
function klDaysThrough(prefix,year){
  if(year<KOREAN_LUNAR_BASE_YEAR) return 0;
  const idx=Math.min(prefix.length-1,year-KOREAN_LUNAR_BASE_YEAR+1);
  return prefix[idx]||0;
}
function klLunarDaysBeforeMonth(year,month,isLeap){
  let days=0;
  if(year<KOREAN_LUNAR_BASE_YEAR||month<=0) return 0;
  for(let m=1;m<=month;m++) days+=klLunarDays(year,m,false);
  if(isLeap){
    const lm=klLeapMonth(klLunarData(year));
    if(lm>0 && lm<month+1) days+=klLunarDays(year,lm,true);
  }
  return days;
}
function klLunarAbsDays(year,month,day,isLeap){
  let days=klDaysThrough(KL_LUNAR_PREFIX,year-1)+klLunarDaysBeforeMonth(year,month-1,true)+Number(day);
  if(isLeap && klLeapMonth(klLunarData(year))===Number(month)) days+=klLunarDays(year,month,false);
  return days;
}
function klSolarDaysBeforeMonth(year,month){ let d=0; for(let m=1;m<=month;m++) d+=klSolarDays(year,m); return d; }
function klSolarAbsDays(year,month,day){ return klDaysThrough(KL_SOLAR_PREFIX,year-1)+klSolarDaysBeforeMonth(year,month-1)+Number(day)-KL_SOLAR_LUNAR_DAY_DIFF; }
function klValidLunar(year,month,day,isLeap){
  year=Number(year);month=Number(month);day=Number(day);
  if(year<KOREAN_LUNAR_BASE_YEAR||year>KOREAN_LUNAR_MAX_YEAR||month<1||month>12||day<1) return false;
  if(isLeap && klLeapMonth(klLunarData(year))!==month) return false;
  return day<=klLunarDays(year,month,!!isLeap);
}
function klValidSolar(year,month,day){
  year=Number(year);month=Number(month);day=Number(day);
  if(year<KOREAN_LUNAR_BASE_YEAR||year>KOREAN_LUNAR_MAX_YEAR||month<1||month>12||day<1) return false;
  return day<=klSolarDays(year,month);
}
function lunarPartsFromSolar(date){
  if(!(date instanceof Date)||Number.isNaN(date.getTime())) return null;
  const sy=date.getFullYear(),sm=date.getMonth()+1,sd=date.getDate();
  if(!klValidSolar(sy,sm,sd)) return null;
  const abs=klSolarAbsDays(sy,sm,sd);
  let ly=abs>=klLunarAbsDays(sy,1,1,false)?sy:sy-1;
  if(ly<KOREAN_LUNAR_BASE_YEAR) return null;
  let lm=0,ld=0,leap=false;
  for(let m=12;m>=1;m--){
    const start=klLunarAbsDays(ly,m,1,false);
    if(abs>=start){
      lm=m;
      if(klLeapMonth(klLunarData(ly))===m) leap=abs>=klLunarAbsDays(ly,m,1,true);
      ld=abs-klLunarAbsDays(ly,lm,1,leap)+1;
      break;
    }
  }
  return lm&&ld?{year:ly,month:lm,day:ld,leap}:null;
}
function solarDateForLunarYear(lunarYear,month,day,leap=false){
  lunarYear=Number(lunarYear);month=Number(month);day=Number(day);leap=!!leap;
  if(!klValidLunar(lunarYear,month,day,leap)) return null;
  const abs=klLunarAbsDays(lunarYear,month,day,leap);
  let sy=abs<klSolarAbsDays(lunarYear+1,1,1)?lunarYear:lunarYear+1;
  if(sy>KOREAN_LUNAR_MAX_YEAR) return null;
  let sm=0,sd=0;
  for(let m=12;m>=1;m--){
    const start=klSolarAbsDays(sy,m,1);
    if(abs>=start){ sm=m; sd=abs-start+1; break; }
  }
  return sm&&sd?new Date(sy,sm-1,sd):null;
}
function lunarLabel(month,day,leap=false){ return `음력 ${leap?'윤':''}${Number(month)}월 ${Number(day)}일`; }

function defaultRepeatRule(eDate, repeat){
  const d = parse(eDate||ds(new Date()));
  const nth = Math.floor((d.getDate()-1)/7)+1;
  return {
    interval:1,
    weekdays:[d.getDay()],
    monthlyMode:'date',
    monthDay:d.getDate(),
    nth,
    weekday:d.getDay(),
    yearlyCalendar:'solar',
    yearlyMonth:d.getMonth()+1,
    yearlyDay:d.getDate(),
    lunarMonth:(lunarPartsFromSolar(d)?.month)||1,
    lunarDay:(lunarPartsFromSolar(d)?.day)||1,
    lunarLeap:!!lunarPartsFromSolar(d)?.leap,
    endType:'never',
    until:'',
    count:10,
    repeat:repeat||'none'
  };
}
function normalizedRule(e){
  const base = defaultRepeatRule(e.date, e.repeat);
  const r = e.repeatRule || {};
  return {
    ...base,
    ...r,
    interval:Math.max(1,Number(r.interval)||1),
    weekdays:Array.isArray(r.weekdays)&&r.weekdays.length ? r.weekdays.map(Number).filter(n=>n>=0&&n<=6) : base.weekdays,
    count:Math.max(1,Number(r.count)||10)
  };
}
function generateOccurrenceStarts(e, rangeStart, rangeEnd){
  const repeat = e.repeat||'none';
  const rule = normalizedRule(e);
  const base = parse(e.date);
  const out=[];
  const rEnd = parse(rangeEnd);
  const untilDate = rule.endType==='date' && rule.until ? parse(rule.until) : null;
  const countLimit = rule.endType==='count' ? rule.count : Infinity;
  let count=0, guard=0;
  const tryPush = d => {
    if(!d || d<base) return true;
    if(untilDate && d>untilDate) return false;
    count++;
    if(count>countLimit) return false;
    if(d<=rEnd) out.push(new Date(d));
    return d<=rEnd;
  };

  if(repeat==='none') return [base];
  if(repeat==='daily'){
    for(let i=0;guard++<20000;i++){
      const d=add(base,i*rule.interval);
      if(!tryPush(d) || d>rEnd) break;
    }
    return out;
  }
  if(repeat==='weekly'){
    const ws=startWeek(base);
    const weekdays=[...new Set(rule.weekdays)].sort((a,b)=>((a+6)%7)-((b+6)%7));
    for(let block=0;guard++<5000;block++){
      const weekStart=add(ws,block*7*rule.interval);
      if(weekStart>add(rEnd,7)) break;
      for(const wd of weekdays){
        const d=add(weekStart,(wd+6)%7);
        if(d<base) continue;
        const cont=tryPush(d);
        if(!cont) return out;
      }
    }
    return out;
  }
  if(repeat==='monthly'){
    for(let k=0;guard++<3000;k++){
      const md=new Date(base.getFullYear(),base.getMonth()+k*rule.interval,1);
      if(md>add(rEnd,31)) break;
      let d=null;
      if(rule.monthlyMode==='nthWeekday') d=nthWeekday(md.getFullYear(),md.getMonth(),Number(rule.weekday),Number(rule.nth));
      else if(rule.monthlyMode==='lastWeekday') d=lastWeekday(md.getFullYear(),md.getMonth(),Number(rule.weekday));
      else if(rule.monthlyMode==='monthEnd') d=new Date(md.getFullYear(),md.getMonth()+1,0);
      else {
        const wanted=Math.max(1,Number(rule.monthDay)||base.getDate());
        // '설정한 날짜'는 해당 날짜가 실제로 존재하는 달에만 생성합니다.
        // 말일 반복은 monthlyMode === 'monthEnd'인 경우에만 별도로 처리합니다.
        d=validLocalDate(md.getFullYear(),md.getMonth(),wanted);
      }
      if(!d || d<base) continue;
      const cont=tryPush(d);
      if(!cont || d>rEnd) break;
    }
    return out;
  }
  if(repeat==='yearly'){
    if(rule.yearlyCalendar==='lunar'){
      const baseLunar=lunarPartsFromSolar(base);
      const startLunarYear=baseLunar?.year || base.getFullYear();
      for(let k=0;guard++<1200;k++){
        const ly=startLunarYear+k*rule.interval;
        if(ly>rEnd.getFullYear()+1) break;
        const d=solarDateForLunarYear(ly,Number(rule.lunarMonth),Number(rule.lunarDay),!!rule.lunarLeap);
        if(!d || d<base) continue;
        const cont=tryPush(d);
        if(!cont) break;
      }
    }else{
      for(let k=0;guard++<1000;k++){
        const y=base.getFullYear()+k*rule.interval;
        const d=validLocalDate(y,Number(rule.yearlyMonth)-1,Number(rule.yearlyDay));
        if(!d) continue;
        if(d<base) continue;
        const cont=tryPush(d);
        if(!cont || d>rEnd) break;
      }
    }
  }
  return out;
}


function preparationDatesFromValues(deadline,days,weekdaysOnly=false,includeDeadline=false){
  if(!deadline) return [];
  const count=Math.max(1,Math.min(365,Number(days)||1));
  let d=parse(deadline);
  if(!includeDeadline) d=add(d,-1);
  const out=[];
  let guard=0;
  while(out.length<count && guard++<800){
    const dow=d.getDay();
    if(!weekdaysOnly || (dow!==0 && dow!==6)) out.push(ds(d));
    d=add(d,-1);
  }
  return out.reverse();
}
function prepTaskEntriesFromValues(deadline,tasks=[]){
  if(!deadline) return [];
  const deadlineDate=parse(deadline), out=[];
  const dayMs=86400000;
  for(const raw of Array.isArray(tasks)?tasks:[]){
    if(!raw || !String(raw.text||'').trim()) continue;
    const text=String(raw.text||'').trim(), id=String(raw.id||'');
    if(raw.type==='date' && raw.date){
      const date=String(raw.date);
      if(date<=deadline) out.push({date,sourceDate:date,text,ruleId:id,type:'date',ruleLabel:'지정',key:`date:${id}`});
      continue;
    }
    // v1.90 이하의 기존 매주 준비업무 호환
    if(raw.type==='weekly' && raw.startDate){
      const weekday=Math.max(0,Math.min(6,Number(raw.weekday)||0));
      let d=parse(raw.startDate), guard=0;
      while(d.getDay()!==weekday && guard++<8) d=add(d,1);
      while(d<deadlineDate && guard++<500){
        const date=ds(d);
        out.push({date,sourceDate:date,text,ruleId:id,type:'weekly',ruleLabel:`매주 ${weekdayName(weekday)}`,key:`weekly:${id}:${date}`});
        d=add(d,7);
      }
      continue;
    }
    if(raw.type==='repeat'){
      const startMode=raw.startMode==='before'?'before':'date';
      const beforeDays=Math.max(0,Math.min(365,Number(raw.beforeDays)||0));
      const startDate=startMode==='before'?ds(add(deadlineDate,-beforeDays)):String(raw.startDate||'');
      if(!startDate) continue;
      const start=parse(startDate), includeDeadline=!!raw.includeDeadline;
      const endType=raw.endType==='date'?'date':'deadline';
      const requestedEnd=endType==='date'&&raw.endDate?parse(String(raw.endDate)):deadlineDate;
      const effectiveEnd=requestedEnd>deadlineDate?deadlineDate:requestedEnd;
      if(start>deadlineDate || effectiveEnd<start || (endType==='deadline'&&!includeDeadline&&start.getTime()===deadlineDate.getTime())) continue;
      const repeatType=['daily','weekly','weekdays','weekends'].includes(raw.repeatType)?raw.repeatType:'daily';
      const interval=Math.max(1,Math.min(99,Number(raw.interval)||1));
      const weekdays=[...new Set((Array.isArray(raw.weekdays)?raw.weekdays:[]).map(Number).filter(n=>n>=0&&n<=6))];
      const selectedWeekdays=weekdays.length?weekdays:[start.getDay()];
      let d=new Date(start), guard=0;
      const withinEnd=cur=>endType==='date'?cur<=effectiveEnd:(includeDeadline?cur<=deadlineDate:cur<deadlineDate);
      while(withinEnd(d) && guard++<800){
        const diff=Math.round((new Date(d.getFullYear(),d.getMonth(),d.getDate())-new Date(start.getFullYear(),start.getMonth(),start.getDate()))/dayMs);
        let match=false;
        if(repeatType==='daily') match=diff%interval===0;
        else if(repeatType==='weekdays') match=d.getDay()!==0&&d.getDay()!==6;
        else if(repeatType==='weekends') match=d.getDay()===0||d.getDay()===6;
        else if(repeatType==='weekly'){
          const weekIndex=Math.floor(diff/7);
          match=weekIndex%interval===0 && selectedWeekdays.includes(d.getDay());
        }
        if(match){
          const date=ds(d);
          let ruleLabel='';
          if(repeatType==='daily') ruleLabel=interval===1?'매일':`${interval}일마다`;
          else if(repeatType==='weekdays') ruleLabel='평일마다';
          else if(repeatType==='weekends') ruleLabel='주말마다';
          else ruleLabel=`${interval===1?'매주':`${interval}주마다`} ${selectedWeekdays.map(weekdayName).join('·')}`;
          out.push({date,sourceDate:date,text,ruleId:id,type:'repeat',ruleLabel,key:`repeat:${id}:${date}`});
        }
        d=add(d,1);
      }
    }
  }
  return out.sort((a,b)=>a.date.localeCompare(b.date)||a.type.localeCompare(b.type)||a.text.localeCompare(b.text));
}
function basePreparationEntries(e){
  if(!e?.prepEnabled || !e.prepDeadline) return [];
  if((e.repeat||'none')!=='none') return [];
  const manual=prepTaskEntriesFromValues(e.prepDeadline,e.prepTasks||[]);
  const autoEnabled=typeof e.prepAutoEnabled==='boolean'?e.prepAutoEnabled:e.prepMode!=='custom';
  const auto=autoEnabled?preparationDatesFromValues(e.prepDeadline,e.prepDays,e.prepWeekdaysOnly,e.prepIncludeDeadline)
    .map(date=>({date,sourceDate:date,text:String(e?.prepDailyNotes?.[date]||'').trim(),ruleId:date,type:'auto',ruleLabel:'자동',key:`auto:${date}`})):[];
  return [...auto,...manual].sort((a,b)=>a.date.localeCompare(b.date)||a.type.localeCompare(b.type)||a.text.localeCompare(b.text));
}
function preparationEntries(e){
  const moves=(e?.prepMoves&&typeof e.prepMoves==='object')?e.prepMoves:{};
  const movedEntries=basePreparationEntries(e).map(entry=>{
    const moved=typeof moves[entry.key]==='string'&&moves[entry.key]?moves[entry.key]:'';
    return moved?{...entry,date:moved,moved:true}:{...entry,moved:false};
  }).filter(entry=>!e?.prepDeadline || entry.date<=e.prepDeadline);

  // 자동 준비일이 다른 자동 준비일 날짜로 이동되어 겹치면 같은 날 카드가 두 장 생길 수 있다.
  // 자동계산은 날짜당 1개 계획이므로, 충돌 시 그 날짜가 원래 sourceDate인 항목을 우선한다.
  const autoByDate=new Map(), others=[];
  for(const entry of movedEntries){
    if(entry.type!=='auto'){ others.push(entry); continue; }
    const prev=autoByDate.get(entry.date);
    if(!prev || (entry.sourceDate===entry.date && prev.sourceDate!==prev.date)) autoByDate.set(entry.date,entry);
  }
  return [...autoByDate.values(),...others]
    .sort((a,b)=>a.date.localeCompare(b.date)||a.type.localeCompare(b.type)||a.text.localeCompare(b.text));
}
function preparationEntryDone(e,key){ return !!(key && e?.prepDone && e.prepDone[key]); }
function preparationEntryMissed(e,key){ return !!(key && e?.prepMissed && e.prepMissed[key]); }
function preparationProgress(e){
  const entries=preparationEntries(e), total=entries.length;
  const done=entries.filter(x=>preparationEntryDone(e,x.key)).length;
  const missed=entries.filter(x=>preparationEntryMissed(e,x.key)).length;
  return {done,missed,total};
}
function preparationDates(e){
  return [...new Set(preparationEntries(e).map(x=>x.date))].sort();
}
function preparationDateLabel(date){
  if(!date) return '';
  const d=parse(date);
  return `${d.getMonth()+1}/${d.getDate()} ${weekdayName(d.getDay())}`;
}
function preparationSummary(e){
  const entries=preparationEntries(e), dates=[...new Set(entries.map(x=>x.date))].sort();
  if(!entries.length) return `준비일정 미등록 · 마감 ${e?.prepDeadline||e?.date||''}`;
  const first=dates[0], last=dates[dates.length-1], range=first===last?first:`${first} ~ ${last}`;
  const autoCount=entries.filter(x=>x.type==='auto').length;
  const extraCount=entries.length-autoCount;
  return `준비 ${range} · ${entries.length}건/${dates.length}일${autoCount?` · 자동 ${autoCount}일`:''}${extraCount?` · 추가 ${extraCount}건`:''} · 마감 ${e.prepDeadline}`;
}
function preparationNoteForDate(e,date){
  return preparationEntries(e).filter(x=>x.date===date).map(x=>String(x.text||'').trim()).filter(Boolean).join(' / ');
}
function preparationVirtualEvent(e,entry){
  const date=typeof entry==='string'?entry:entry.date;
  const note=typeof entry==='string'?preparationNoteForDate(e,date):String(entry.text||'').trim();
  const key=typeof entry==='string'?`auto:${entry}`:String(entry.key||'');
  const sourceDate=typeof entry==='string'?entry:String(entry.sourceDate||entry.date||'');
  return {...e,_prepDay:true,_prepDate:date,_renderDate:date,_occurrenceStart:e.date,_occurrenceEnd:e.date,_prepNote:note,_prepKey:key,_prepMissed:preparationEntryMissed(e,key),_prepSourceDate:sourceDate,_prepType:typeof entry==='string'?'auto':String(entry.type||''),_prepRuleId:typeof entry==='string'?'':String(entry.ruleId||''),_prepRuleLabel:typeof entry==='string'?'':String(entry.ruleLabel||'')};
}
function isPreparationDeadlineOccurrence(e){
  if(!e?.prepEnabled || e?._prepDay) return false;
  const renderDate=e._renderDate||e._occurrenceStart||e.date;
  return !!renderDate && renderDate===(e.prepDeadline||e.date);
}
function hasPreparationEntryOnDeadline(e){
  if(!e?.prepEnabled || !e.prepDeadline) return false;
  return preparationEntries(e).some(x=>x.date===e.prepDeadline);
}
function isPreparationManagedItem(e){ return !!e?._prepDay || isPreparationDeadlineOccurrence(e); }
function isPreparationLaneItem(e){ return !!e?._prepDay || (isPreparationDeadlineOccurrence(e) && !hasPreparationEntryOnDeadline(e)); }
function isPreparationDeadlineDuplicate(e){ return isPreparationDeadlineOccurrence(e) && hasPreparationEntryOnDeadline(e); }

function purchaseEventCalendarId(){
  return topLevelCals()[0]?.id || state.calendars[0]?.id || '';
}
function purchaseDisplayTitle(p, completed=false){
  const qty=Math.max(1,Number(p?.qty)||1);
  const name=String(p?.name||'구매항목').trim();
  return `${name}${qty>1?` ${qty}개`:''} ${completed?'구입완료':'구매'}`;
}
function purchaseDueVirtualEvent(p){
  const date=String(p?.dueDate||'');
  return {
    id:`purchase-due-${p.id}`,purchaseId:String(p.id),_purchaseDue:true,sourceType:'purchaseDue',
    title:purchaseDisplayTitle(p,false),calId:purchaseEventCalendarId(),date,endDate:date,
    allDay:true,start:'',end:'',hours:0,noDuration:true,kind:'todo',place:'',repeat:'none',repeatRule:null,
    memo:String(p.memo||''),important:false,done:false,doneDates:[],checklist:[],checklistDoneByDate:{},orderByDate:{},
    _occurrenceStart:date,_occurrenceEnd:date,_renderDate:date
  };
}

function buildOccurrenceMap(rangeStart, rangeEnd, options={}){
  const map={};
  for(let d=parse(rangeStart), end=parse(rangeEnd); d<=end; d=add(d,1)) map[ds(d)]=[];
  const hidden = new Set(state.settings.hiddenCalendars||[]);
  const includeHidden=!!options.includeHidden;
  const includePreparations=options.includePreparations!==false;
  const calendarIds=options.calendarIds instanceof Set ? options.calendarIds : null;
  const includeCommon=options.includeCommon!==false;
  const includePurchases=options.includePurchases!==false;
  // 구매목록의 구매기한은 실제 일정 복제본을 만들지 않고 Quick에 가상 일정으로 표시한다.
  // 구매기한 수정 시 자동으로 날짜가 따라가고, 구매완료로 목록에서 제거되면 자동으로 사라진다.
  for(const p of (includePurchases ? (state.purchases||[]) : [])){
    const due=String(p.dueDate||'');
    if(due && due>=rangeStart && due<=rangeEnd && map[due]) map[due].push(purchaseDueVirtualEvent(p));
  }
  for(const e of state.events){
    // 캘린더 필터 중에도 공통 일정(D-Day/기념일, 예약·약속)은 항상 남긴다.
    const alwaysCommon=e.kind==='anniversary'||e.kind==='appointment'||e.sourceType==='purchase';
    if(!includePurchases && e.sourceType==='purchase') continue;
    if(!includeCommon && (e.kind==='anniversary'||e.kind==='appointment')) continue;
    if(calendarIds && !calendarIds.has(e.calId) && !alwaysCommon) continue;
    if(!includeHidden && isCalendarHidden(e.calId) && !alwaysCommon) continue;
    if(includePreparations) for(const prepEntry of preparationEntries(e)){
      const prepDate=prepEntry.date;
      if(prepDate>=rangeStart && prepDate<=rangeEnd && map[prepDate]) map[prepDate].push(preparationVirtualEvent(e,prepEntry));
    }
    const span=Math.max(0,diffDays(e.date,e.endDate||e.date));
    const starts=generateOccurrenceStarts(e, ds(add(parse(rangeStart),-span)), rangeEnd);
    for(const start of starts){
      const occStart=ds(start), occEnd=ds(add(start,span));
      if((e.excludedDates||[]).includes(occStart)) continue;
      for(let d=new Date(Math.max(start,parse(rangeStart))); d<=parse(rangeEnd) && d<=add(start,span); d=add(d,1)){
        const k=ds(d);
        if(map[k]) map[k].push({...e,_occurrenceStart:occStart,_occurrenceEnd:occEnd,_renderDate:k});
      }
    }
  }
  for(const k of Object.keys(map)){
    map[k].sort((a,b)=>{
      const ao=Number(a.orderByDate?.[k]);
      const bo=Number(b.orderByDate?.[k]);
      const ah=Number.isFinite(ao)&&ao!==0, bh=Number.isFinite(bo)&&bo!==0;
      if(ah||bh){
        if(ah&&bh&&ao!==bo) return ao-bo;
        if(ah!==bh) return ah?-1:1;
      }
      const ar=Number(a.repeatOrder), br=Number(b.repeatOrder);
      const arh=Number.isFinite(ar)&&ar!==0, brh=Number.isFinite(br)&&br!==0;
      if(arh||brh){
        if(arh&&brh&&ar!==br) return ar-br;
        if(arh!==brh) return arh?-1:1;
      }
      if(!!a._prepDay!==!!b._prepDay) return a._prepDay?-1:1;
      const calOrder=cal(a.calId).order-cal(b.calId).order;
      if(calOrder) return calOrder;
      return ((a.allDay===b.allDay)?0:(a.allDay?-1:1)) || (a.start||'').localeCompare(b.start||'') || a.title.localeCompare(b.title,'ko');
    });
  }
  return map;
}
function isDone(e){
  if((e.repeat||'none')==='none') return !!e.done;
  return (e.doneDates||[]).includes(e._occurrenceStart||e.date);
}
function repeatShort(e){
  if((e.repeat||'none')==='none') return '';
  return '↻';
}
function repeatEndText(rule){
  if(rule.endType==='date' && rule.until) return ` · ${rule.until}까지`;
  if(rule.endType==='count') return ` · 총 ${rule.count}회`;
  return '';
}
function monthlyRepeatLabel(e){
  const r=normalizedRule(e);
  const lead=r.interval>1?`${r.interval}개월마다`:'매월';
  let body='';
  if(r.monthlyMode==='monthEnd') body='말일';
  else if(r.monthlyMode==='nthWeekday') body=`${getNthLabel(Number(r.nth))} ${weekdayName(Number(r.weekday))}`;
  else if(r.monthlyMode==='lastWeekday') body=`마지막 ${weekdayName(Number(r.weekday))}`;
  else {
    const day=Math.max(1,Number(r.monthDay)||parse(e.date).getDate());
    body=`${day}일`;
  }
  return `${lead} ${body}${repeatEndText(r)}`;
}
function repeatRuleLabel(e){
  const repeat=e.repeat||'none';
  const r=normalizedRule(e);
  if(repeat==='none') return '반복 없음';
  if(repeat==='daily'){
    const lead=r.interval>1?`${r.interval}일마다`:'매일';
    return `${lead}${repeatEndText(r)}`;
  }
  if(repeat==='weekly'){
    const lead=r.interval>1?`${r.interval}주마다`:'매주';
    const order=[1,2,3,4,5,6,0];
    const days=order.filter(d=>(r.weekdays||[]).includes(d)).map(d=>weekdayName(d).replace('요일','')).join('·') || weekdayName(parse(e.date).getDay()).replace('요일','');
    return `${lead} ${days}요일${repeatEndText(r)}`;
  }
  if(repeat==='monthly') return monthlyRepeatLabel(e);
  if(repeat==='yearly'){
    const lead=r.interval>1?`${r.interval}년마다`:'매년';
    if(r.yearlyCalendar==='lunar') return `${lead} ${lunarLabel(r.lunarMonth,r.lunarDay,r.lunarLeap)}${repeatEndText(r)}`;
    return `${lead} ${r.yearlyMonth}월 ${r.yearlyDay}일${repeatEndText(r)}`;
  }
  return repeat;
}

function kindPrefix(e){
  if(e.kind==='appointment') return '◆ ';
  if(e.kind==='todo') return '☐ ';
  if(e.kind==='habit') return '◇ ';
  if(e.kind==='anniversary') return '♥ ';
  if(e.kind==='payment') return '₩ ';
  return '';
}
function carryoverOutRecord(e){
  const occ=e._occurrenceStart||e.date;
  return (e.carryoverHistory||[]).find(r=>r.fromDate===occ) || null;
}
function carryoverInLabel(e){
  const n=Math.max(0,Number(e.carryoverCount)||0);
  if(!n) return '';
  return n===1 ? '↪ 전날 미완료' : `↪ ${n}일째 이월`;
}

const expandedChecklistKeys=new Set();
function checklistExpandKey(e){ return `${e?.id||''}|${e?._occurrenceStart||e?.date||''}`; }
function dayCalCollapseKey(date,calId){ return `${date}|${calId}`; }
function isDayCalCollapsed(date,calId){ return !!state.settings?.dayCalendarGroupsCollapsed?.[dayCalCollapseKey(date,calId)]; }
function toggleDayCalCollapsed(date,calId){
  state.settings.dayCalendarGroupsCollapsed=(state.settings.dayCalendarGroupsCollapsed&&typeof state.settings.dayCalendarGroupsCollapsed==='object')?state.settings.dayCalendarGroupsCollapsed:{};
  const key=dayCalCollapseKey(date,calId);
  if(state.settings.dayCalendarGroupsCollapsed[key]) delete state.settings.dayCalendarGroupsCollapsed[key];
  else state.settings.dayCalendarGroupsCollapsed[key]=true;
  save();
}

function checklistItems(e){ return Array.isArray(e?.checklist)?e.checklist.filter(x=>x&&String(x.text||'').trim()):[]; }
function checklistOccurrenceKey(e){ return e?._occurrenceStart||e?.date||''; }
function checklistDoneSet(e,occ=''){
  const key=occ||checklistOccurrenceKey(e);
  const raw=e?.checklistDoneByDate?.[key];
  return new Set(Array.isArray(raw)?raw.map(String):[]);
}
function checklistProgress(e,occ=''){
  const items=checklistItems(e), done=checklistDoneSet(e,occ);
  const count=items.reduce((n,x)=>n+(done.has(String(x.id))?1:0),0);
  return {total:items.length,done:count,complete:items.length>0&&count===items.length};
}
function setOccurrenceDoneState(e,occ,done){
  if(!e) return;
  const key=occ||e.date;
  if((e.repeat||'none')==='none') e.done=!!done;
  else{
    e.doneDates=Array.isArray(e.doneDates)?e.doneDates:[];
    const set=new Set(e.doneDates);
    done?set.add(key):set.delete(key);
    e.doneDates=[...set].sort();
  }
}
function syncDoneFromChecklist(e,occ=''){
  const p=checklistProgress(e,occ);
  if(!p.total) return;
  setOccurrenceDoneState(e,occ||e.date,p.complete);
}
function checklistHtml(e,compact=false){
  const items=checklistItems(e); if(!items.length) return '';
  const occ=checklistOccurrenceKey(e), done=checklistDoneSet(e,occ), p=checklistProgress(e,occ);
  if(compact) return `<div class="checklistCompact" title="세부 체크리스트 ${p.done}/${p.total}">☑ ${p.done}/${p.total}</div>`;
  return `<div class="subtaskList">${items.map(x=>{
    const checked=done.has(String(x.id));
    return `<div class="subtaskRow ${checked?'done':''}"><button type="button" class="subtaskCheck" data-action="subtask" data-subtask-id="${esc(x.id)}" title="${checked?'체크 해제':'완료 체크'}">${checked?'☑':'☐'}</button><span title="${esc(x.text)}">${esc(x.text)}</span></div>`;
  }).join('')}</div>`;
}
function eventItemHtml(e, compact=false){
  const c=cal(e.calId), purchaseDue=!!e._purchaseDue, purchaseLinked=purchaseDue||e.sourceType==='purchase', prepDay=!!e._prepDay, prepDeadlineDay=prepDay && (e._renderDate||e._prepDate||e.date)===(e.prepDeadline||e.date), deadlineItem=isPreparationDeadlineOccurrence(e);
  const done=prepDay?preparationEntryDone(e,e._prepKey):isDone(e), missed=prepDay?preparationEntryMissed(e,e._prepKey):false, checkable=e.kind!=='anniversary' && !prepDay;
  const recurring=(e.repeat||'none')!=='none';
  const payment=e.kind==='payment';
  const checklist=prepDay?[]:checklistItems(e), checklistState=prepDay?{done:0,total:0}:checklistProgress(e);
  const durationPrefix=(!prepDay && !payment && !e.noDuration && duration(e)>0)?`(${fmtH(duration(e))}) `:'';
  const timePrefix=(!prepDay && !e.allDay && e.start)?`${e.start}${e.end?`–${e.end}`:''} `:'';
  const inLabel=prepDay?'':carryoverInLabel(e), outRecord=prepDay?null:carryoverOutRecord(e);
  const renderDate=e._renderDate||e._occurrenceStart||e.date;
  const drag=(deadlineItem||purchaseDue)?'false':'true';
  const prepNote=prepDay?String(e._prepNote||'').trim():'';
  // v2.11: 준비일정 구역에서는 원본 일정명/`준비` 접두어를 반복하지 않는다.
  // 일반 준비일은 그날 해야 할 업무만, 마감 관련 카드만 `준비마감`/`마감`을 표시한다.
  const prepTaskTitle=prepNote||'할 일 미입력';
  const basePrepTitle=prepDeadlineDay?`준비마감 · ${prepTaskTitle}`:prepTaskTitle;
  const shownTitle=prepDay
    ? basePrepTitle
    : (deadlineItem?`마감 · ${e.title}`:e.title);
  const detail=[];
  if(prepDay){ detail.push(preparationSummary(e)); if(prepNote) detail.push(prepNote); }
  else if(!e.allDay && e.start) detail.push(e.start + (e.end?`–${e.end}`:''));
  if(!prepDay && payment){
    if(Number(e.paymentAmount)>0) detail.push(`₩${Number(e.paymentAmount).toLocaleString('ko-KR')}`);
    if(e.paymentMethod) detail.push(e.paymentMethod);
  }else if(!prepDay && e.noDuration) detail.push('소요시간 미체크');
  else if(!prepDay && duration(e)) detail.push(fmtH(duration(e)));
  if(!prepDay && e.place) detail.push(e.place);
  if(!prepDay && recurring) detail.push(repeatRuleLabel(e));
  if(!prepDay && checklist.length) detail.push(`체크리스트 ${checklistState.done}/${checklistState.total}`);
  if(inLabel) detail.push(inLabel);
  if(outRecord) detail.push(`${outRecord.toDate}로 이월`);
  if(deadlineItem) detail.unshift(preparationSummary(e));
  const tooltip=[shownTitle,...detail].filter(Boolean).join(' · ');
  const dragHandle=deadlineItem?'':`<span class="dragHandle" title="${prepDay?'드래그: 준비일정을 다른 날짜로 이동':'드래그: 같은 날짜에서는 순서 변경 · 다른 날짜에서는 이동'}" aria-hidden="true">⋮⋮</span>`;
  const mainCheck=prepDay?`<button type="button" class="todoCheck prepCheck" data-action="prep-toggle" title="${done?'완료 해제':'완료 처리'}">${done?'☑':'☐'}</button>`:'';
  const checklistKey=checklistExpandKey(e), expanded=!prepDay&&expandedChecklistKeys.has(checklistKey);
  const checklistButton=checklist.length?`<button type="button" class="checklistToggle ${expanded?'on':''}" data-action="checklist-toggle" title="세부 체크리스트 ${checklistState.done}/${checklistState.total}">☷ ${checklistState.done}/${checklistState.total}</button>`:'';
  const repeatBadge=!prepDay&&recurring?`<span class="repeatMark" title="${esc(repeatRuleLabel(e))}">↻</span>`:'';
  const carryBadge=inLabel?`<span class="carryBadge carryIn" title="${esc(inLabel)}">↪</span>`:'';
  const amountInline=!prepDay&&payment&&Number(e.paymentAmount)>0?`<span class="inlineMeta">₩${Number(e.paymentAmount).toLocaleString('ko-KR')}</span>`:'';
  return `<div class="item ${done?'done':''} ${missed?'prepMissedItem':''} kind-${esc(e.kind||'event')} ${recurring&&!prepDay?'recurringItem':''} ${payment&&!prepDay?'paymentItem':''} ${e.fixedId?'manualPlacedItem':''} ${e.flexibleId?'flexiblePlacedItem':''} ${inLabel?'carriedIn':''} ${outRecord?'carriedOut':''} ${prepDay?'prepDayItem':''} ${prepDeadlineDay?'prepDeadlineDayItem':''} ${deadlineItem?'prepDeadlineItem':''}" draggable="${drag}" data-eid="${esc(e.id)}" data-occurrence="${esc(e._occurrenceStart||e.date)}" data-render-date="${esc(renderDate)}" data-cal-id="${esc(e.calId)}" data-lane="${payment?'payment':'work'}" data-prep-day="${prepDay?'1':''}" data-prep-key="${prepDay?esc(e._prepKey||''):''}" data-prep-source-date="${prepDay?esc(e._prepSourceDate||''):''}" data-prep-type="${prepDay?esc(e._prepType||''):''}" data-prep-rule-id="${prepDay?esc(e._prepRuleId||''):''}" data-prep-event="${e.prepEnabled?'1':''}" data-purchase-due="${purchaseDue?'1':''}" data-purchase-id="${purchaseDue?esc(e.purchaseId||''):''}" style="--item-color:${esc(c.color)};border-left-color:${esc(c.color)}">
    <div class="itemRow">${dragHandle}${!prepDay&&e.important?`<button type="button" class="importanceBtn on" data-action="importance" aria-label="중요 표시 해제" title="중요 표시 해제">★</button>`:''}${mainCheck}${missed?`<span class="prepMissedMark" title="못함">✕</span>`:''}<div class="itemTitle" title="${esc(tooltip)}">${timePrefix}<span class="durationPrefix">${esc(durationPrefix)}</span>${!prepDay&&payment?'₩ ':(!checkable&&!prepDay?kindPrefix(e):'')}${esc(shownTitle)}</div>${amountInline}${repeatBadge}${carryBadge}${checklistButton}</div>
    ${expanded?checklistHtml(e,false):''}
  </div>`;
}
function appointmentLaneHtml(es, compact=false){
  const items=(es||[]).filter(e=>e.kind==='appointment'&&!isPreparationManagedItem(e));
  if(!items.length) return '';
  return `<div class="appointmentLane ${compact?'compactAppointmentLane':''}"><div class="appointmentLaneHead"><span>예약 · 약속</span><small>${items.length}건</small></div><div class="appointmentLaneItems">${items.map(e=>eventItemHtml(e,compact)).join('')}</div></div>`;
}
function calendarGroupedItemsHtml(items, compact=false){
  const xs=items||[];
  if(!xs.length) return '';
  const purchaseItems=xs.filter(e=>e._purchaseDue||e.sourceType==='purchase');
  const normalItems=xs.filter(e=>!e._purchaseDue&&e.sourceType!=='purchase');
  const order=new Map(cals().map((c,i)=>[c.id,i]));
  const groups=new Map();
  for(const e of normalItems){ if(!groups.has(e.calId)) groups.set(e.calId,[]); groups.get(e.calId).push(e); }
  const purchaseHtml=purchaseItems.length?`<div class="quickCalGroup purchaseQuickGroup" data-quick-cal="purchase"><div class="quickCalLabel purchaseQuickLabel">구매목록</div>${purchaseItems.map(e=>eventItemHtml(e,compact)).join('')}</div>`:'';
  const normalHtml=[...groups.entries()].sort((a,b)=>(order.get(a[0])??9999)-(order.get(b[0])??9999)).map(([calId,events])=>{
    const c=cal(calId);
    return `<div class="quickCalGroup" data-quick-cal="${esc(calId)}"><div class="quickCalLabel" style="--quick-cal-color:${esc(c.color)}">${esc(c.name)}</div>${events.map(e=>eventItemHtml(e,compact)).join('')}</div>`;
  }).join('');
  return purchaseHtml+normalHtml;
}
function quickLaneHtml(es, compact=false, force=false){
  const quick=(es||[]).filter(e=>e.kind==='todo'&&!isPreparationManagedItem(e));
  if(!quick.length && !force) return '';
  return `<div class="quickLane ${compact?'compactQuickLane':''} ${!quick.length?'emptyLane':''}"><div class="quickLaneHead"><span>Quick</span><small>${quick.length}건</small></div><div class="quickLaneItems">${calendarGroupedItemsHtml(quick,compact)}</div></div>`;
}
function anniversaryLaneHtml(es, compact=false){
  const items=(es||[]).filter(e=>e.kind==='anniversary'&&!isPreparationManagedItem(e));
  if(!items.length) return '';
  return `<div class="anniversaryLane ${compact?'compactAnniversaryLane':''}"><div class="anniversaryLaneHead"><span>♥ D-Day · 기념일</span><small>${items.length}건</small></div><div class="anniversaryLaneItems">${items.map(e=>eventItemHtml(e,compact)).join('')}</div></div>`;
}
function commonTopLaneHtml(es, compact=false, force=false){
  const anniversaries=(es||[]).filter(e=>e.kind==='anniversary'&&!isPreparationManagedItem(e));
  const appointments=(es||[]).filter(e=>e.kind==='appointment'&&!isPreparationManagedItem(e));
  const count=anniversaries.length+appointments.length;
  if(!count && !force) return '';
  const anniversaryRows=anniversaries.map(e=>eventItemHtml(e,compact)).join('');
  const appointmentRows=appointments.map(e=>eventItemHtml(e,compact)).join('');
  return `<div class="commonTopLane ${compact?'compactCommonTopLane':''} ${!count?'emptyLane':''}"><div class="commonTopLaneHead"><span>공통 일정</span><small>${count}건</small></div><div class="commonTopLaneItems">${anniversaryRows}${appointmentRows}</div></div>`;
}
function nonQuickItemsHtml(es, compact=false){
  return (es||[]).filter(e=>e.kind!=='todo' && e.kind!=='appointment' && e.kind!=='anniversary').map(e=>eventItemHtml(e,compact)).join('');
}
function paymentLaneHtml(es, compact=false, force=false){
  const payments=(es||[]).filter(e=>e.kind==='payment'&&!isPreparationManagedItem(e));
  if(!payments.length && !force) return '';
  return `<div class="paymentLane ${compact?'compactPaymentLane':''} ${!payments.length?'emptyLane':''}"><div class="paymentLaneHead"><span>₩ 납부</span><small>${payments.length}건</small></div><div class="paymentLaneItems">${payments.map(e=>eventItemHtml(e,compact)).join('')}</div></div>`;
}
function prepLaneHtml(es, compact=false, force=false){
  const items=(es||[]).filter(e=>isPreparationLaneItem(e));
  if(!items.length && !force) return '';
  return `<div class="prepLane ${compact?'compactPrepLane':''} ${!items.length?'emptyLane':''}"><div class="prepLaneHead"><span>준비일정</span><small>${items.length}건</small></div><div class="prepLaneItems">${items.map(e=>eventItemHtml(e,compact)).join('')}</div></div>`;
}
function capacityText(sum, cap, unknown=false){
  if(unknown) return `<span class="capacityUnknown">${fmtH(sum)} / 미정</span>`;
  const n=Number(cap)||0;
  if(!n) return `<span>${fmtH(sum)}</span>`;
  return `<span class="${sum>n?'over':'ok'}">${fmtH(sum)} / ${fmtH(n)}</span>`;
}
function dayCalHeadHtml(date,c,sum,cap,unknown,label=''){
  const collapsed=isDayCalCollapsed(date,c.id);
  return `<button type="button" class="dayCalToggle" data-daycal-toggle="1" data-date="${esc(date)}" data-cal-id="${esc(c.id)}" aria-expanded="${collapsed?'false':'true'}" title="${esc(c.name)} 접기/펴기"><span class="dayCalHeadLabel">${label}${esc(c.name)} · ${esc(c.period)}</span><span class="dayCalHeadRight">${capacityText(sum,cap,unknown)} <b>${collapsed?'▸':'▾'}</b></span></button>`;
}
function daySubCalHeadHtml(date,c,label='↳ '){
  const collapsed=isDayCalCollapsed(date,c.id);
  return `<button type="button" class="dayCalToggle" data-daycal-toggle="1" data-date="${esc(date)}" data-cal-id="${esc(c.id)}" aria-expanded="${collapsed?'false':'true'}" title="${esc(c.name)} 접기/펴기 · 가용시간은 상위 캘린더와 공유"><span class="dayCalHeadLabel">${label}${esc(c.name)}</span><span class="dayCalHeadRight sharedCapacityText">상위 공유 <b>${collapsed?'▸':'▾'}</b></span></button>`;
}
function groupHtml(date, es){
  const filtering=calendarFocusIds.size>0;
  const commonTopHtml=commonTopLaneHtml(es,false,true);
  const prepHtml=prepLaneHtml(es,false,!filtering);
  const quickHtml=quickLaneHtml(es,false,!filtering);
  const paymentHtml=paymentLaneHtml(es,false,!filtering);
  const appointmentEvents=(es||[]).filter(e=>e.kind==='appointment'&&!isPreparationManagedItem(e));
  const quickEvents=(es||[]).filter(e=>e.kind==='todo'&&!isPreparationManagedItem(e));
  const workEvents=(es||[]).filter(e=>!isPreparationManagedItem(e) && e.kind!=='payment' && e.kind!=='appointment' && e.kind!=='anniversary' && e.kind!=='todo');
  let html='';
  const visible=displayCals(), visibleIds=new Set(visible.map(c=>c.id));
  let total=appointmentEvents.reduce((sum,e)=>sum+workloadDuration(e),0) + quickEvents.reduce((sum,e)=>sum+workloadDuration(e),0), totalCapacity=0, hasUnknownCapacity=false, blockedRootCount=0;
  for(const root of topLevelCals()){
    const members=[root,...descendants(root.id)].filter(c=>visibleIds.has(c.id));
    if(!members.length) continue;
    const memberIds=new Set(members.map(c=>c.id));
    const groupEvents=workEvents.filter(e=>memberIds.has(e.calId));
    if(!groupEvents.length) continue;
    const rootSum=groupEvents.filter(e=>!isPreparationManagedItem(e)).reduce((sum,e)=>sum+workloadDuration(e),0);
    total+=rootSum;
    const rootCapInfo=capacityForDate(root,date);
    if(rootCapInfo.blocked) blockedRootCount++;
    if(rootCapInfo.unknown) hasUnknownCapacity=true; else totalCapacity+=rootCapInfo.hours;
    const singleChildOnly=!visibleIds.has(root.id)&&members.length===1;
    const displayCal=singleChildOnly?members[0]:root;
    const rootCollapsed=isDayCalCollapsed(date,displayCal.id);
    const blockedTitle=rootCapInfo.blocked?' · 가용시간 차단 일정 있음':'';
    html += `<div class="group calendarTreeGroup ${rootCollapsed?'collapsed':''}" style="--group-color:${esc(displayCal.color)}"><div class="groupHead" style="background:${esc(displayCal.color)}55" title="${esc(displayCal.name)}${blockedTitle}">${dayCalHeadHtml(date,displayCal,rootSum,rootCapInfo.hours,rootCapInfo.unknown)}</div><div class="dayCalGroupBody">`;
    if(singleChildOnly){
      html += nonQuickItemsHtml(groupEvents,false);
    }else{
      const direct=groupEvents.filter(e=>e.calId===root.id);
      if(direct.length) html += nonQuickItemsHtml(direct,false);
      for(const child of members.filter(c=>c.id!==root.id)){
        const xs=groupEvents.filter(e=>e.calId===child.id); if(!xs.length) continue;
        const depth=Math.max(1,calendarDepth(child.id));
        const childCollapsed=isDayCalCollapsed(date,child.id);
        html += `<div class="subCalGroup ${childCollapsed?'collapsed':''}" style="--sub-depth:${depth}"><div class="subCalHead" style="border-left-color:${esc(child.color)};background:color-mix(in srgb, ${esc(child.color)} 14%, white)">${daySubCalHeadHtml(date,child,'↳ ')}</div><div class="dayCalGroupBody">${nonQuickItemsHtml(xs,false)}</div></div>`;
      }
    }
    html += `</div></div>`;
  }
  const overallOver=!hasUnknownCapacity && totalCapacity>0 && total>totalCapacity;
  let capacitySummary=hasUnknownCapacity
    ? `${totalCapacity?` · 확인된 가용 ${fmtH(totalCapacity)}`:''} · 일부 가용시간 미정`
    : (totalCapacity?` / 캘린더 가용 ${fmtH(totalCapacity)}`:'');
  if(blockedRootCount) capacitySummary += ` · 가용차단 ${blockedRootCount}개`;
  return commonTopHtml + prepHtml + quickHtml + paymentHtml + html + `<div class="dayTotal ${overallOver?'overallOver':''}">총 계획 ${fmtH(total)}${capacitySummary}</div>`;
}

function calendarOptionsHtml(){
  return cals().map(c=>{
    const depth=calendarDepth(c.id), prefix=depth?`${'　'.repeat(Math.max(0,depth-1))}↳ `:'';
    return `<option value="${esc(c.id)}">${prefix}${esc(c.name)}</option>`;
  }).join('');
}
function syncSelects(){
  const opts=calendarOptionsHtml();
  $('#cal').innerHTML=opts; $('#fcal').innerHTML=opts;
  const rootOpts=topLevelCals().map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  if($('#availabilityTarget')) $('#availabilityTarget').innerHTML=rootOpts;
  if($('#flexcal')) $('#flexcal').innerHTML=opts;
  // v1.60: 좌측 목록은 이미 캘린더별 그룹으로 나뉘므로 중복되는 '전체 캘린더' 필터는 제거.
  selectedFixedFilter='all';
  selectedFlexibleFilter='all';
  selectedPaymentFilter='all';
}
function renderSide(){
  applySidebarSectionOrder();
  bindSidebarSectionReorder();
  bindSidebarSectionCollapse();
  syncSelects();
  const hidden=new Set(state.settings.hiddenCalendars||[]);
  sanitizeCalendarFocus();
  $('#calList').classList.toggle('hasCalendarSelection',calendarFocusIds.size>0);
  $('#calList').innerHTML=cals().map(c=>{
    const depth=calendarDepth(c.id), focused=calendarFocusIds.has(c.id);
    return `<div class="calRow ${depth?'subCalendarRow':''} ${focused?'calendarFocused':''}" data-cid="${esc(c.id)}" style="--cal-depth:${depth}"><input class="calVisible" type="checkbox" ${isCalendarHidden(c.id)?'':'checked'} title="표시/숨김"><i class="dot" style="background:${esc(c.color)}"></i><button type="button" class="calNameBtn" aria-pressed="${focused?'true':'false'}" title="${esc(c.name)} 필터 선택/해제 · 여러 캘린더 동시 선택 가능">${esc(c.name)}</button><small>${esc(c.period)}</small><button type="button" class="calEdit" title="캘린더 수정" aria-label="${esc(c.name)} 수정">✎</button></div>`;
  }).join('');
  $$('.calRow').forEach(row=>{
    row.querySelector('.calVisible').onclick=e=>{
      e.stopPropagation();
      const id=row.dataset.cid, set=new Set(state.settings.hiddenCalendars||[]);
      // 표시 체크는 각 캘린더별로 독립 동작합니다.
      // 상위 캘린더를 꺼도 부속캘린더 체크박스는 개별적으로 다시 켤 수 있습니다.
      if(e.target.checked) set.delete(id); else set.add(id);
      state.settings.hiddenCalendars=[...set];
      save();
    };
    row.querySelector('.calNameBtn').onclick=e=>{
      e.stopPropagation();
      const id=row.dataset.cid;
      // 이름 클릭은 필터를 토글한다. 다른 캘린더를 이어서 눌러 여러 개를 동시에 선택할 수 있다.
      if(calendarFocusIds.has(id)) calendarFocusIds.delete(id);
      else calendarFocusIds.add(id);
      // 선택한 캘린더(및 부속)가 숨김 상태라면 즉시 보이도록 복구한다.
      const showIds=[id,...descendants(id).map(c=>c.id)];
      const set=new Set(state.settings.hiddenCalendars||[]);
      const before=set.size;
      showIds.forEach(x=>set.delete(x));
      state.settings.hiddenCalendars=[...set];
      if(set.size!==before) save({rerender:false});
      render();
      // 다중 선택을 이어서 할 수 있도록 사이드바를 자동으로 닫지 않는다.
    };
    row.querySelector('.calEdit').onclick=e=>{ e.stopPropagation(); openCal(row.dataset.cid); };
  });
  state.settings.fixedPanelsCollapsed=state.settings.fixedPanelsCollapsed||{};
  state.settings.fixedPanelsCollapsed.flexible=false;
  state.settings.fixedPanelsCollapsed.purchase=false;
  state.settings.fixedPanelsCollapsed.payment=false;
  renderFixed(); renderFlexible(); renderPurchases(); renderPayments(); renderDdays(); renderDiaryArchive();
}
function currentMonthRange(){
  const start=new Date(cursor.getFullYear(),cursor.getMonth(),1);
  const end=new Date(cursor.getFullYear(),cursor.getMonth()+1,0);
  return {start,end,startKey:ds(start),endKey:ds(end)};
}
function occurrenceSortKey(e){
  const {startKey,endKey}=currentMonthRange();
  const inMonth=generateOccurrenceStarts(e,startKey,endKey)
    .map(ds)
    .filter(k=>k>=startKey && k<=endKey && !(e.excludedDates||[]).includes(k))
    .sort();
  if(inMonth.length) return inMonth[0];
  return nextOccurrenceFor(e,startKey,740) || '9999-12-31';
}
function manualPlacementSortKey(x){
  const month=`${cursor.getFullYear()}-${pad(cursor.getMonth()+1)}`;
  const dates=state.events.filter(e=>e.fixedId===x.id && (e.date||'').startsWith(month)).map(e=>e.date).filter(Boolean).sort();
  return dates[0] || '9999-12-31';
}
// v2.58: 일정 한 회차를 다른 날짜로 옮기면 기존 회차가 excludedDates에
// 기록되고 새 단일 일정이 detachedFromRepeatId로 연결된다. 월별 집계는
// 실제 이동 후 날짜의 완료 기록도 포함해야 한다. 과거 저장 데이터도 재집계한다.
function recurringMonthProgress(e){
  const {startKey,endKey}=currentMonthRange();
  const starts=generateOccurrenceStarts(e,startKey,endKey).filter(d=>{
    const k=ds(d);
    return k>=startKey && k<=endKey && !(e.excludedDates||[]).includes(k);
  });
  const doneSet=new Set(e.doneDates||[]);
  let total=starts.length;
  let done=starts.reduce((n,d)=>n+(doneSet.has(ds(d))?1:0),0);
  // 이동된 회차는 반복 원본에 더 이상 속하지 않지만 원본 업무의 실적이다.
  // 이동된 날짜를 기준으로 집계하며, 완료/미완료 모두 반영한다.
  const moved=state.events.filter(x=>
    x.id!==e.id && String(x.detachedFromRepeatId||'')===String(e.id) &&
    (x.repeat||'none')==='none' &&
    typeof x.date==='string' && x.date>=startKey && x.date<=endKey
  );
  total+=moved.length;
  done+=moved.filter(x=>isDone(x)).length;
  if(!total){
    // 원래 생성되어야 했던 월 회차가 사용자의 삭제로 제외된 경우만 '삭제됨'.
    // 날짜 이동은 detachedFromRepeatId 연결을 확인해 삭제로 오인하지 않는다.
    const scheduled=generateOccurrenceStarts(e,startKey,endKey).map(ds).filter(k=>k>=startKey&&k<=endKey);
    const excluded=new Set(e.excludedDates||[]);
    const movedOrigins=new Set(state.events.filter(x=>String(x.detachedFromRepeatId||'')===String(e.id)).map(x=>x.detachedOccurrence||x.detachedOriginalDate||x.originalOccurrenceDate||x.originalDate||x.movedFromDate).filter(Boolean));
    const removed=scheduled.filter(k=>excluded.has(k)&&!movedOrigins.has(k));
    if(removed.length) return {total:0,done:0,label:`이번 달 삭제됨 (${removed.length}건)`,complete:false};
    return {total:0,done:0,label:'이번 달 해당 없음',complete:false};
  }
  if(done===total) return {total,done,label:`✓ 이번 달 완료 ${done}/${total}`,complete:true};
  return {total,done,label:`이번 달 ${done}/${total} 완료`,complete:false};
}
function manualMonthProgress(placed){
  if(!placed.length) return {label:'이번 달 미배치',complete:false};
  const done=placed.filter(e=>isDone(e)).length;
  if(done===placed.length) return {label:`✓ 이번 달 완료${placed.length>1?` ${done}/${placed.length}`:''}`,complete:true};
  return {label:placed.length>1?`이번 달 ${done}/${placed.length} 완료`:'이번 달 미완료',complete:false};
}

// v2.77: restore last archive collapse choice even when an older Firebase snapshot arrives.
function archivedRecurringLocalKey(){
  return `calendar-archive-collapsed-v274:${currentUser?.uid||'local'}`;
}
function readArchivedRecurringLocalState(){
  try{
    const v=localStorage.getItem(archivedRecurringLocalKey());
    return v==='true'?true:v==='false'?false:null;
  }catch(_){return null;}
}
function writeArchivedRecurringLocalState(value){
  try{localStorage.setItem(archivedRecurringLocalKey(),String(!!value));}catch(_){}
}

function sidebarCalendarCollapseMap(section){
  state.settings.sidebarCalendarGroupsCollapsed=state.settings.sidebarCalendarGroupsCollapsed||{recurring:{},archivedRecurring:{},manual:{},flexible:{},payment:{}};
  state.settings.sidebarCalendarGroupsCollapsed[section]=state.settings.sidebarCalendarGroupsCollapsed[section]||{};
  return state.settings.sidebarCalendarGroupsCollapsed[section];
}
function sidebarCalendarGroupHtml(section,c,bodyHtml,count){
  const collapsed=!!sidebarCalendarCollapseMap(section)[c.id];
  const path=calendarPath(c.id);
  const manualCalendarButton=section==='manual'
    ? `<button type="button" class="manualCalPreviewBtn" data-manual-preview-cal="${esc(c.id)}" title="${esc(path)}의 날짜 지정 배치만 달력으로 보기" aria-label="${esc(path)} 배치 달력 보기">▦</button>` : '';
  return `<div class="sidebarCalGroup ${collapsed?'collapsed':''}" style="--group-color:${esc(c.color)}">
    <div class="sidebarCalGroupToolbar">
      <button type="button" class="sidebarCalGroupHead" data-sidebar-cal-toggle="${esc(section)}" data-cal-id="${esc(c.id)}" aria-expanded="${collapsed?'false':'true'}" title="${esc(path)} 접기/펴기">
        <span class="sidebarCalGroupTitle"><i class="dot" style="background:${esc(c.color)}"></i><span>${esc(path)}</span></span>
        <span class="sidebarCalGroupMeta">${count}건 ${collapsed?'▸':'▾'}</span>
      </button>
      ${manualCalendarButton}
    </div>
    <div class="sidebarCalGroupBody">${bodyHtml}</div>
  </div>`;
}
function bindSidebarCalendarGroupToggles(scope=document){
  scope.querySelectorAll('[data-sidebar-cal-toggle]').forEach(btn=>btn.onclick=()=>{
    const section=btn.dataset.sidebarCalToggle, calId=btn.dataset.calId;
    const map=sidebarCalendarCollapseMap(section);
    map[calId]=!map[calId];
    save();
  });
}
function groupedCalendarHtml(section,items,rowBuilder,emptyText){
  if(!items.length) return `<div class="empty compactEmpty">${esc(emptyText)}</div>`;
  const byCal=new Map();
  for(const item of items){
    const id=item.calId||'';
    if(!byCal.has(id)) byCal.set(id,[]);
    byCal.get(id).push(item);
  }
  const groups=[];
  for(const c of cals()){
    const xs=byCal.get(c.id); if(!xs?.length) continue;
    groups.push(sidebarCalendarGroupHtml(section,c,xs.map(rowBuilder).join(''),xs.length));
    byCal.delete(c.id);
  }
  // 삭제된 캘린더를 가리키는 오래된 데이터가 있어도 목록에서 유실되지 않도록 처리합니다.
  for(const [id,xs] of byCal){
    const c=cal(id);
    groups.push(sidebarCalendarGroupHtml(section,c,xs.map(rowBuilder).join(''),xs.length));
  }
  return groups.join('');
}

// v2.61: 특정 반복업무 한 건만 보여주는 월별 배치 미리보기.
let recurringPreviewId=null;
let manualPreviewMode=false;
let manualPreviewCalId='';
let recurringPreviewCursor=null;
function openRecurringPreview(id){
  if(!state.events.some(e=>String(e.id)===String(id)))return;
  manualPreviewMode=false;
  recurringPreviewId=id;
  recurringPreviewCursor=new Date(cursor.getFullYear(),cursor.getMonth(),1);
  renderRecurringPreview();
  openDialog($('#recurringPreviewDlg'));
}
function manualPreviewCalendars(){
  const ids=new Set((state.fixed||[]).map(f=>String(f.calId||'')));
  return cals().filter(c=>ids.has(String(c.id)));
}
function openManualPlacementPreview(calId=''){
  manualPreviewMode=true;
  recurringPreviewId=null;
  const available=manualPreviewCalendars();
  // When opened from the global header, show the first calendar, not a mixed list.
  manualPreviewCalId=available.some(c=>String(c.id)===String(calId))?String(calId):(available[0]?.id||'');
  recurringPreviewCursor=new Date(cursor.getFullYear(),cursor.getMonth(),1);
  renderRecurringPreview();
  openDialog($('#recurringPreviewDlg'));
}
function renderManualPlacementPreview(){
  const box=$('#recurringPreviewContent');if(!box)return;
  const date=recurringPreviewCursor||new Date(),y=date.getFullYear(),m=date.getMonth();
  const first=new Date(y,m,1),s=startWeek(first),last=new Date(y,m+1,0);
  const weeks=Math.ceil(((first.getDay()+6)%7+last.getDate())/7);
  const begin=ds(s),end=ds(add(s,weeks*7-1));
  const available=manualPreviewCalendars();
  if(!available.some(c=>String(c.id)===String(manualPreviewCalId)))manualPreviewCalId=available[0]?.id||'';
  const chosen=available.find(c=>String(c.id)===String(manualPreviewCalId));
  // Only source templates in the selected calendar are considered. This works even
  // when an individual placed occurrence has been moved to another date.
  const relevantFixedIds=new Set((state.fixed||[])
    .filter(f=>String(f.calId||'')===String(manualPreviewCalId))
    .map(f=>String(f.id)));
  const byDay=new Map();
  state.events.filter(e=>e.fixedId && relevantFixedIds.has(String(e.fixedId)) &&
    typeof e.date==='string' && e.date>=begin && e.date<=end)
    .forEach(e=>{const list=byDay.get(e.date)||[];list.push(e);byDay.set(e.date,list);});
  const days=Array.from({length:weeks*7},(_,i)=>{
    const d=add(s,i),k=ds(d),other=d.getMonth()!==m;
    const entries=byDay.get(k)||[];
    return `<div class="recurringPreviewDay ${other?'other':''}" style="min-height:78px;overflow:hidden"><span class="previewDayNumber">${d.getDate()}</span>${entries.map(e=>`<div class="manualPreviewItem" style="border-left-color:${esc(cal(e.calId).color)}" title="${esc(e.title)}">${isDone(e)?'✓ ':''}${esc(e.title)}</div>`).join('')}</div>`;
  }).join('');
  $('#recurringPreviewTitle').textContent=`날짜 지정 배치 · ${chosen?calendarPath(chosen.id):'캘린더 선택'}`;
  $('#recurringPreviewMonth').textContent=`${y}년 ${m+1}월`;
  const options=available.map(c=>`<option value="${esc(c.id)}" ${String(c.id)===String(manualPreviewCalId)?'selected':''}>${esc(calendarPath(c.id))}</option>`).join('');
  box.innerHTML=`<label class="manualPreviewFilter">캘린더별 보기 <select id="manualPreviewCalSelect" aria-label="날짜 지정 배치 캘린더 선택">${options}</select></label><div class="recurringPreviewWeekdays">${['월','화','수','목','금','토','일'].map(x=>`<span>${x}</span>`).join('')}</div><div class="recurringPreviewGrid">${days}</div><p class="recurringPreviewNote">${chosen?esc(calendarPath(chosen.id))+'의 ':''}날짜 지정 배치 일정만 표시합니다. 다른 캘린더의 일정은 표시하지 않습니다.</p>`;
  box.querySelector('#manualPreviewCalSelect')?.addEventListener('change',ev=>{
    manualPreviewCalId=ev.target.value;
    renderManualPlacementPreview();
  });
}
function recurringPreviewEntries(e,start,end){
  const byDate=new Map();
  const addEntry=(date,status)=>{
    if(!date||date<start||date>end)return;
    const prior=byDate.get(date);
    const rank={deleted:0,planned:1,failed:2,done:3};
    if(!prior||rank[status]>rank[prior])byDate.set(date,status);
  };
  const excluded=new Set(e.excludedDates||[]),done=new Set(e.doneDates||[]);
  for(const d of generateOccurrenceStarts(e,start,end)){
    const k=ds(d);
    const moved=state.events.some(x=>String(x.detachedFromRepeatId||'')===String(e.id)&&x.detachedOccurrence===k);
    if(!moved)addEntry(k,excluded.has(k)?'deleted':done.has(k)?'done':'planned');
  }
  for(const x of state.events){
    if(String(x.detachedFromRepeatId||'')!==String(e.id))continue;
    addEntry(x.date,x.failed||x.notDone||x.skipped?'failed':isDone(x)?'done':'planned');
  }
  return byDate;
}
function renderRecurringPreview(){
  if(manualPreviewMode){renderManualPlacementPreview();return;}
  const e=state.events.find(x=>String(x.id)===String(recurringPreviewId));
  const box=$('#recurringPreviewContent');if(!box||!e)return;
  const date=recurringPreviewCursor||new Date();
  const y=date.getFullYear(),m=date.getMonth(),first=new Date(y,m,1);
  const s=startWeek(first),last=new Date(y,m+1,0),weekCount=Math.ceil(((first.getDay()+6)%7+last.getDate())/7);
  const begin=ds(s),end=ds(add(s,weekCount*7-1));
  const items=recurringPreviewEntries(e,begin,end);
  const names=['월','화','수','목','금','토','일'];
  const cells=Array.from({length:weekCount*7},(_,i)=>{
    const d=add(s,i),k=ds(d),st=items.get(k),other=d.getMonth()!==m;
    return `<div class="recurringPreviewDay ${other?'other':''} ${st?'status-'+st:''}" title="${k}${st?' · '+({done:'완료',planned:'예정',failed:'못함',deleted:'삭제된 회차'}[st]):''}"><span class="previewDayNumber">${d.getDate()}</span>${st?`<span class="previewDayMarker">${{done:'✓ 완료',planned:'● 배치',failed:'✕ 못함',deleted:'— 삭제'}[st]}</span>`:''}</div>`;
  }).join('');
  $('#recurringPreviewTitle').textContent=e.title;
  $('#recurringPreviewMonth').textContent=`${y}년 ${m+1}월`;
  box.innerHTML=`<div class="recurringPreviewWeekdays">${names.map(x=>`<span>${x}</span>`).join('')}</div><div class="recurringPreviewGrid">${cells}</div><div class="recurringPreviewLegend"><span>● 예정</span><span>✓ 완료</span><span>✕ 못함</span><span>— 삭제</span></div><p class="recurringPreviewNote">선택한 반복업무만 표시합니다. 날짜를 옮긴 회차도 이동 후 날짜에 표시돼요.</p>`;
}
$('#recurringPreviewPrev').onclick=()=>{recurringPreviewCursor=new Date(recurringPreviewCursor.getFullYear(),recurringPreviewCursor.getMonth()-1,1);renderRecurringPreview();};
$('#recurringPreviewNext').onclick=()=>{recurringPreviewCursor=new Date(recurringPreviewCursor.getFullYear(),recurringPreviewCursor.getMonth()+1,1);renderRecurringPreview();};
$('#recurringPreviewClose').onclick=()=>closeDialog($('#recurringPreviewDlg'));

// v2.61 — 종료된 반복일정은 삭제하지 않고 별도 목록으로 분류한다.
function isArchivedRecurring260(e){
  if((e.repeat||'none')==='none') return false;
  const rule=normalizedRule(e), today=ds(new Date());
  if(rule.endType==='date' && rule.until) return rule.until < today;
  if(rule.endType==='count'){
    const dates=generateOccurrenceStarts(e,e.date,today);
    const limit=Math.max(1,Number(rule.count)||10);
    return dates.length>=limit && ds(dates[limit-1])<today;
  }
  return false;
}

function renderFixed(){
  const f=selectedFixedFilter||'all';
  const month=`${cursor.getFullYear()}-${pad(cursor.getMonth()+1)}`;
  const allowed=f==='all'?null:new Set([f,...descendants(f).map(c=>c.id)]);
  const recurring=state.events.filter(e=>(e.repeat||'none')!=='none' && e.kind!=='payment' && e.kind!=='anniversary' && (!allowed||allowed.has(e.calId)))
    .sort((a,b)=>occurrenceSortKey(a).localeCompare(occurrenceSortKey(b)) || String(a.title||'').localeCompare(String(b.title||''),'ko'));
  const archivedRecurring=recurring.filter(isArchivedRecurring260);
  const activeRecurring=recurring.filter(e=>!isArchivedRecurring260(e));
  const manual=state.fixed.filter(x=>!allowed||allowed.has(x.calId))
    .sort((a,b)=>manualPlacementSortKey(a).localeCompare(manualPlacementSortKey(b)) || String(a.name||'').localeCompare(String(b.name||''),'ko'));
  const collapsed=state.settings.fixedPanelsCollapsed||{recurring:false,manual:false};

  const recurringRowBuilder=e=>{
    const c=cal(e.calId), rule=repeatRuleLabel(e);
    const kindLabel={event:'일정',appointment:'예약,약속',todo:'Quick',habit:'습관/루틴',anniversary:'기념일/D-Day',payment:'납부일정'}[e.kind]||'일정';
    const progress=e.kind==='anniversary'?{label:'완료체크 대상 아님',complete:false}:recurringMonthProgress(e);
    return `<div class="fixed recurringFixed ${progress.complete?'monthComplete':'monthPending'}" data-eid="${esc(e.id)}" style="border-left-color:${esc(c.color)}" title="${esc(`${calendarPath(c.id)} · ${rule} · ${durationLabel(e)} · ${progress.label}`)}"><button type="button" class="recurringInspectBtn" title="이 반복업무만 월 달력에서 보기"><b>${e.important?'★ ':''}${esc(e.title)}</b><small>${esc(kindLabel)} · ${esc(rule)} · ${esc(durationLabel(e))}</small><span class="monthProgress ${progress.complete?'complete':''}">${esc(progress.label)}</span></button><button type="button" class="recurringEditBtn" title="반복업무 수정" aria-label="${esc(e.title)} 수정">✎</button></div>`;
  };
  const recurringRows=groupedCalendarHtml('recurring',activeRecurring,recurringRowBuilder,'진행 중인 자동반복 일정이 없습니다.');
  const archiveRows=groupedCalendarHtml('archivedRecurring',archivedRecurring,recurringRowBuilder,'종료된 자동반복 일정이 없습니다.');
  const localArchivedCollapsed=readArchivedRecurringLocalState();
  if(localArchivedCollapsed!==null) collapsed.archivedRecurring=localArchivedCollapsed;
  if(typeof collapsed.archivedRecurring!=='boolean') collapsed.archivedRecurring=true;

  const manualRows=groupedCalendarHtml('manual',manual,x=>{
    const c=cal(x.calId);
    const placed=state.events
      .filter(e=>e.fixedId===x.id && (e.date||'').startsWith(month))
      .sort((a,b)=>String(a.date).localeCompare(String(b.date)));
    const used=placed.length>0;
    let placedLabel='';
    if(used){
      const d=parse(placed[0].date);
      const dayNames=['일','월','화','수','목','금','토'];
      placedLabel=`${d.getMonth()+1}/${d.getDate()}(${dayNames[d.getDay()]})`;
      if(placed.length>1) placedLabel+=` 외 ${placed.length-1}건`;
    }
    const usedText=used?` · 배치완료 ${placedLabel}`:'';
    const progress=manualMonthProgress(placed);
    const tip=used?`배치완료: ${placedLabel}에 배치됨 · ${progress.label}. 달력에서 해당 배치 일정을 삭제하면 다시 활성화됩니다.`:'원하는 날짜로 드래그하세요.';
    return `<div class="fixed manualFixed ${used?'used disabledFixed':''} ${progress.complete?'monthComplete':'monthPending'}" draggable="${used?'false':'true'}" aria-disabled="${used?'true':'false'}" data-used="${used?'1':'0'}" data-fid="${esc(x.id)}" style="border-left-color:${esc(c.color)}" title="${esc(tip)}"><b>${used?'✓ 배치완료 · ':''}${x.important?'★ ':''}${esc(x.name)}</b><small>${esc(durationLabel(x))}${x.checklist?.length?` · 체크 ${x.checklist.length}개`:''}${esc(usedText)}</small><span class="monthProgress ${progress.complete?'complete':''}">${esc(progress.label)}</span></div>`;
  },'날짜 지정 업무를 등록하세요.');

  $('#fixedList').innerHTML=`
    <div class="fixedGroup">
      <button type="button" class="fixedGroupHead" data-fixed-toggle="recurring" aria-expanded="${collapsed.recurring?'false':'true'}"><span>자동반복 <em>달력에 자동 배치</em></span><span class="fixedGroupMeta">${activeRecurring.length}건 ${collapsed.recurring?'▸':'▾'}</span></button>
      <div class="fixedGroupBody ${collapsed.recurring?'collapsed':''}" data-fixed-panel="recurring">${recurringRows}</div>
    </div>
    ${archivedRecurring.length?`<div class="fixedGroup archivedRecurringGroup">
      <button type="button" class="fixedGroupHead" data-fixed-toggle="archivedRecurring" aria-expanded="${collapsed.archivedRecurring?'false':'true'}"><span>종료된 반복일정 <em>과거 기록 유지</em></span><span class="fixedGroupMeta">${archivedRecurring.length}건 ${collapsed.archivedRecurring?'▸':'▾'}</span></button>
      <div class="fixedGroupBody ${collapsed.archivedRecurring?'collapsed':''}" data-fixed-panel="archivedRecurring">${archiveRows}</div>
    </div>`:''}
    <div class="fixedGroup">
      <button type="button" class="fixedGroupHead" data-fixed-toggle="manual" aria-expanded="${collapsed.manual?'false':'true'}"><span>날짜 지정 배치 <em>드래그해서 넣기</em></span><span class="fixedGroupMeta">${manual.length}건 ${collapsed.manual?'▸':'▾'}</span></button>
      <div class="fixedGroupBody ${collapsed.manual?'collapsed':''}" data-fixed-panel="manual">${manualRows}</div>
    </div>`;

  $$('.recurringFixed').forEach(x=>{
    x.querySelector('.recurringInspectBtn')?.addEventListener('click',()=>openRecurringPreview(x.dataset.eid));
    x.querySelector('.recurringEditBtn')?.addEventListener('click',ev=>{ev.stopPropagation();openEvent(null,x.dataset.eid);});
  });
  $$('.manualFixed').forEach(x=>{
    if(x.dataset.used!=='1'){
      x.ondragstart=e=>{
        activeDrag={type:'fixed',id:x.dataset.fid};
        x.classList.add('dragging');
        e.dataTransfer.effectAllowed='copy';
        try{ e.dataTransfer.setData('application/x-calendar-fixed',x.dataset.fid); }catch(_e){}
        e.dataTransfer.setData('text/plain',`calendar-fixed:${x.dataset.fid}`);
      };
      x.ondragend=()=>{ activeDrag=null; x.classList.remove('dragging'); $$('.dropReady').forEach(el=>el.classList.remove('dropReady')); };
    }
    x.ondblclick=()=>openFixed(x.dataset.fid);
  });
  $('#fixedList').querySelectorAll('[data-manual-preview-cal]').forEach(btn=>{
    btn.addEventListener('click',ev=>{
      ev.stopPropagation();
      openManualPlacementPreview(btn.dataset.manualPreviewCal);
    });
  });
  $$('[data-fixed-toggle]').forEach(btn=>btn.onclick=()=>{
    const key=btn.dataset.fixedToggle;
    state.settings.fixedPanelsCollapsed=state.settings.fixedPanelsCollapsed||{};
    state.settings.fixedPanelsCollapsed[key]=!state.settings.fixedPanelsCollapsed[key];
    if(key==='archivedRecurring') writeArchivedRecurringLocalState(state.settings.fixedPanelsCollapsed[key]);
    save();
  });
  bindSidebarCalendarGroupToggles($('#fixedList'));
}

function flexHistoryDates(item){
  return [...new Set(state.events
    .filter(e=>e.flexibleId===item.id && isDone(e))
    .map(e=>e.date)
    .filter(Boolean))]
    .sort();
}
function shortDateKo(date){
  const d=parse(date), names=['일','월','화','수','목','금','토'];
  return `${d.getMonth()+1}/${d.getDate()}(${names[d.getDay()]})`;
}
function renderFlexible(){
  const box=$('#flexibleList'); if(!box) return;
  const f=selectedFlexibleFilter||'all';
  const allowed=f==='all'?null:new Set([f,...descendants(f).map(c=>c.id)]);
  const items=(state.flexible||[]).filter(x=>!allowed||allowed.has(x.calId));
  const collapsed=!!state.settings?.fixedPanelsCollapsed?.flexible;
  const rows=groupedCalendarHtml('flexible',items,x=>{
    const c=cal(x.calId), dates=flexHistoryDates(x);
    const history=dates.length?dates.map(shortDateKo).join(' · '):'아직 완료기록 없음';
    const tip=dates.length?`완료기록: ${dates.join(', ')}`:'원하는 날짜로 드래그하세요. 완료 체크한 날짜가 여기에 누적됩니다.';
    return `<div class="fixed flexibleFixed" draggable="true" data-flexid="${esc(x.id)}" style="border-left-color:${esc(c.color)}" title="${esc(tip)}"><b>${x.important?'★ ':''}${esc(x.name)}</b><small>${esc(durationLabel(x))}${x.checklist?.length?` · 체크 ${x.checklist.length}개`:''}</small><span class="flexHistory">${dates.length?`완료기록 ${esc(history)}`:esc(history)}</span></div>`;
  },'시간날때 할 업무를 등록하세요.');
  box.innerHTML=`<div class="flexiblePanel ${collapsed?'collapsed':''}">${rows}</div>`;
  box.classList.toggle('collapsed',collapsed);
  const toggle=$('#toggleFlexible'); if(toggle){ toggle.textContent=collapsed?'▸':'▾'; toggle.title=collapsed?'시간날때 업무 펴기':'시간날때 업무 접기'; }
  $$('.flexibleFixed').forEach(x=>{
    x.ondragstart=e=>{
      activeDrag={type:'flexible',id:x.dataset.flexid}; x.classList.add('dragging'); e.dataTransfer.effectAllowed='copy';
      try{e.dataTransfer.setData('application/x-calendar-flexible',x.dataset.flexid)}catch(_e){}
      e.dataTransfer.setData('text/plain',`calendar-flexible:${x.dataset.flexid}`);
    };
    x.ondragend=()=>{ activeDrag=null; x.classList.remove('dragging'); $$('.dropReady').forEach(el=>el.classList.remove('dropReady')); };
    x.ondblclick=()=>openFlexible(x.dataset.flexid);
  });
  bindSidebarCalendarGroupToggles(box);
}

function renderPayments(){
  const box=$('#paymentList'); if(!box) return;
  const {startKey,endKey}=currentMonthRange();
  const pf=selectedPaymentFilter||'all';
  const allowed=pf==='all'?null:new Set([pf,...descendants(pf).map(c=>c.id)]);
  const payments=state.events.filter(e=>e.kind==='payment' && (!allowed||allowed.has(e.calId)));
  const collapsed=!!state.settings?.fixedPanelsCollapsed?.payment;
  const archivedPayments=payments.filter(isArchivedRecurring260);
  const activePayments=payments.filter(e=>!isArchivedRecurring260(e));
  const archiveRows=[];
  const byCal=new Map();
  const push=(calId,sortKey,html)=>{ if(!byCal.has(calId)) byCal.set(calId,[]); byCal.get(calId).push({sortKey,html}); };
  for(const e of payments){
    const isArchived=archivedPayments.includes(e);
    const starts=generateOccurrenceStarts(e,startKey,endKey)
      .map(ds)
      .filter(k=>k>=startKey && k<=endKey && !(e.excludedDates||[]).includes(k))
      .sort();
    if(starts.length){
      const doneSet=new Set(e.doneDates||[]);
      for(const occ of starts){
        const done=(e.repeat||'none')==='none'?!!e.done:doneSet.has(occ);
        const c=cal(e.calId);
        const amount=Number(e.paymentAmount)>0?`₩${Number(e.paymentAmount).toLocaleString('ko-KR')}`:'금액 미입력';
        const method=e.paymentMethod?` · ${esc(e.paymentMethod)}`:'';
        (isArchived ? (sortKey,html)=>archiveRows.push({sortKey,html}) : (sortKey,html)=>push(e.calId,sortKey,html))(occ,`<div class="paymentRow ${done?'paid':''}" data-eid="${esc(e.id)}" data-occ="${esc(occ)}" style="border-left-color:${esc(c.color)}"><button type="button" class="paymentCheck" title="${done?'납부완료 취소':'납부완료 체크'}">${done?'☑':'☐'}</button><button type="button" class="paymentOpen"><b>${e.important?'★ ':''}${esc(e.title)}</b><small>${esc(occ)} · ${amount}${method}${(e.repeat||'none')!=='none'?` · ${esc(repeatRuleLabel(e))}`:''}</small></button></div>`);
      }
    }else{
      // 이동된 반복 납부 회차가 이번 달에 있으면 원본의 제외 회차를
      // 별도의 '이번 달 삭제됨' 행으로 중복 표시하지 않는다.
      const movedThisMonth=state.events.some(x=>
        String(x.detachedFromRepeatId||'')===String(e.id) &&
        (x.repeat||'none')==='none' && x.kind==='payment' &&
        String(x.date||'')>=startKey && String(x.date||'')<=endKey
      );
      if(movedThisMonth) continue;
      // 현재 표시 중인 월에 예정 회차도 삭제 기록도 없으면 목록에 표시하지 않는다.
      // 미래 납부일을 '이번 달 해당 없음'으로 미리 나열하지 않는다.
      const deletedThisMonth=(e.excludedDates||[]).some(d=>d>=startKey && d<=endKey);
      if(!isArchived && !deletedThisMonth) continue;
      const next=nextOccurrenceFor(e,ds(new Date()),740);
      const c=cal(e.calId);
      (isArchived ? (sortKey,html)=>archiveRows.push({sortKey,html}) : (sortKey,html)=>push(e.calId,sortKey,html))(next||'9999-12-31',`<div class="paymentRow paymentNoMonth" data-eid="${esc(e.id)}" data-occ="${esc(next||e.date)}" style="border-left-color:${esc(c.color)}"><span class="paymentCheck muted">·</span><button type="button" class="paymentOpen"><b>${e.important?'★ ':''}${esc(e.title)}</b><small>${(e.excludedDates||[]).some(d=>d>=startKey&&d<=endKey)?'이번 달 삭제됨':'이번 달 해당 없음'}${next?` · 다음 ${esc(next)}`:''} · ${esc(repeatRuleLabel(e))}</small></button></div>`);
    }
  }
  const groups=[];
  for(const c of cals()){
    const rows=byCal.get(c.id); if(!rows?.length) continue;
    rows.sort((a,b)=>a.sortKey.localeCompare(b.sortKey));
    groups.push(sidebarCalendarGroupHtml('payment',c,rows.map(r=>r.html).join(''),rows.length));
    byCal.delete(c.id);
  }
  for(const [id,rows] of byCal){ rows.sort((a,b)=>a.sortKey.localeCompare(b.sortKey)); groups.push(sidebarCalendarGroupHtml('payment',cal(id),rows.map(r=>r.html).join(''),rows.length)); }
  const html=groups.join('')||'<div class="empty compactEmpty">등록된 납부일정이 없습니다.</div>';
  box.innerHTML=`<div class="paymentPanel ${collapsed?'collapsed':''}">${html}</div><details class="archivedPaymentPanel" style="margin-top:8px;border:1px solid #d6dce5;padding:7px"><summary style="cursor:pointer;font-weight:600">종료된 납부일정 (${archivedPayments.length})</summary><div style="margin-top:6px">${archiveRows.sort((a,b)=>a.sortKey.localeCompare(b.sortKey)).map(r=>r.html).join('')||'종료된 납부일정 없음'}</div></details>`;
  box.classList.toggle('collapsed',collapsed);
  const toggle=$('#togglePayment'); if(toggle){ toggle.textContent=collapsed?'▸':'▾'; toggle.title=collapsed?'납부일정 펼치기':'납부일정 접기'; }
  $$('.paymentRow').forEach(row=>{
    row.querySelector('.paymentCheck')?.addEventListener('click',ev=>{ ev.stopPropagation(); if(row.classList.contains('paymentNoMonth')) return; toggleDone(row.dataset.eid,row.dataset.occ); });
    row.querySelector('.paymentOpen')?.addEventListener('click',()=>openEvent(row.dataset.occ,row.dataset.eid));
  });
  bindSidebarCalendarGroupToggles(box);
}

function renderPurchases(){
  const box=$('#purchaseList'); if(!box) return;
  const collapsed=!!state.settings?.fixedPanelsCollapsed?.purchase;
  const toggle=$('#togglePurchase'); if(toggle){ toggle.textContent=collapsed?'▸':'▾'; toggle.title=collapsed?'구매목록 펼치기':'구매목록 접기'; }
  if(collapsed){ box.innerHTML=''; return; }
  const rows=[...(state.purchases||[])].sort((a,b)=>(Number(a.order)||0)-(Number(b.order)||0) || String(a.createdAt||'').localeCompare(String(b.createdAt||'')) || a.name.localeCompare(b.name,'ko'));
  box.innerHTML=rows.map(p=>`<div class="purchaseRow" data-pid="${esc(p.id)}"><span class="purchaseDragHandle" draggable="true" title="드래그해서 순서 변경" aria-label="순서 변경">⋮⋮</span><button type="button" class="purchaseCheck" title="구매완료 처리">☐</button><button type="button" class="purchaseOpen" title="구매항목 수정"><span>${esc(p.name)}</span><small>${p.qty>1?`${p.qty}개 · `:''}${p.dueDate?`~ ${esc(p.dueDate.slice(5).replace('-','/'))}`:'기한 없음'}</small></button></div>`).join('') || '<div class="empty">등록된 구매항목이 없습니다.</div>';
  let dragId='';
  const applyOrder=(sourceId,targetId,after=false)=>{
    if(!sourceId || !targetId || sourceId===targetId) return;
    const ordered=[...(state.purchases||[])].sort((a,b)=>(Number(a.order)||0)-(Number(b.order)||0) || String(a.createdAt||'').localeCompare(String(b.createdAt||'')) || a.name.localeCompare(b.name,'ko'));
    const from=ordered.findIndex(x=>x.id===sourceId), targetObj=ordered.find(x=>x.id===targetId);
    if(from<0 || !targetObj) return;
    const [moved]=ordered.splice(from,1);
    let to=ordered.findIndex(x=>x.id===targetId);
    if(to<0) to=ordered.length;
    if(after) to+=1;
    ordered.splice(Math.min(to,ordered.length),0,moved);
    ordered.forEach((p,i)=>p.order=i);
    state.purchases=ordered;
    save();
  };
  $$('.purchaseRow').forEach(row=>{
    row.querySelector('.purchaseCheck')?.addEventListener('click',()=>openPurchaseComplete(row.dataset.pid));
    row.querySelector('.purchaseOpen')?.addEventListener('click',()=>openPurchase(row.dataset.pid));
    const handle=row.querySelector('.purchaseDragHandle');
    handle?.addEventListener('dragstart',e=>{
      dragId=row.dataset.pid||'';
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed='move';
      try{e.dataTransfer.setData('text/plain',`purchase:${dragId}`);}catch{}
    });
    handle?.addEventListener('dragend',()=>{ dragId=''; row.classList.remove('dragging'); $$('.purchaseRow').forEach(x=>x.classList.remove('purchaseDropBefore','purchaseDropAfter')); });
    row.addEventListener('dragover',e=>{
      if(!dragId || dragId===row.dataset.pid) return;
      e.preventDefault(); e.dataTransfer.dropEffect='move';
      const r=row.getBoundingClientRect(), after=e.clientY>r.top+r.height/2;
      row.classList.toggle('purchaseDropBefore',!after); row.classList.toggle('purchaseDropAfter',after);
    });
    row.addEventListener('dragleave',()=>row.classList.remove('purchaseDropBefore','purchaseDropAfter'));
    row.addEventListener('drop',e=>{
      if(!dragId || dragId===row.dataset.pid) return;
      e.preventDefault();
      const r=row.getBoundingClientRect(), after=e.clientY>r.top+r.height/2;
      const source=dragId; dragId='';
      $$('.purchaseRow').forEach(x=>x.classList.remove('purchaseDropBefore','purchaseDropAfter'));
      applyOrder(source,row.dataset.pid,after);
    });
  });
}
function openPurchase(id=''){
  const p=(state.purchases||[]).find(x=>x.id===id);
  $('#purchaseTitle').textContent=p?'구매항목 수정':'구매항목 추가';
  $('#purchaseId').value=p?.id||''; $('#purchaseName').value=p?.name||''; $('#purchaseQty').value=p?.qty||1; $('#purchaseDueDate').value=p?.dueDate||''; $('#purchaseMemo').value=p?.memo||'';
  $('#deletePurchase').style.visibility=p?'visible':'hidden'; openDialog($('#purchaseDlg'));
}
function actualWorkValue(date,rootId){
  const row=state.actualWork?.[date];
  if(!row || !Object.prototype.hasOwnProperty.call(row,rootId)) return null;
  const n=Number(row[rootId]);
  return Number.isFinite(n)?Math.max(0,n):null;
}
function setActualWorkValue(date,rootId,value){
  state.actualWork=state.actualWork||{};
  const raw=String(value??'').trim();
  if(raw===''){
    if(state.actualWork[date]){
      delete state.actualWork[date][rootId];
      if(!Object.keys(state.actualWork[date]).length) delete state.actualWork[date];
    }
    save(); return;
  }
  const n=Math.max(0,Math.min(24,Number(raw)||0));
  state.actualWork[date]=state.actualWork[date]||{};
  state.actualWork[date][rootId]=Math.round(n*100)/100;
  save();
}
function workloadRootMembers(root){ return [root,...descendants(root.id)]; }
function plannedHoursForRootDate(root,date,map){
  const ids=new Set(workloadRootMembers(root).map(c=>c.id));
  return (map[date]||[]).filter(e=>ids.has(e.calId)&&!isPreparationManagedItem(e)&&!['payment','anniversary'].includes(e.kind)).reduce((a,e)=>a+workloadDuration(e),0);
}
function workloadChildBreakdown(root,date,map){
  const out=[];
  for(const c of workloadRootMembers(root)){
    const sum=(map[date]||[]).filter(e=>e.calId===c.id&&!isPreparationManagedItem(e)&&!['payment','anniversary'].includes(e.kind)).reduce((a,e)=>a+workloadDuration(e),0);
    if(sum>0) out.push({c,sum});
  }
  return out;
}
function workloadPeriodBounds(mode){
  if(mode==='month') return {start:new Date(cursor.getFullYear(),cursor.getMonth(),1),end:new Date(cursor.getFullYear(),cursor.getMonth()+1,0)};
  if(mode==='year') return {start:new Date(cursor.getFullYear(),0,1),end:new Date(cursor.getFullYear(),11,31)};
  const start=startWeek(cursor); return {start,end:add(start,6)};
}
function workloadPeriodLabel(mode,start,end){
  if(mode==='month') return `${start.getFullYear()}년 ${start.getMonth()+1}월`;
  if(mode==='year') return `${start.getFullYear()}년`;
  return `${start.getMonth()+1}.${start.getDate()}–${end.getMonth()+1}.${end.getDate()}`;
}
function workloadSummaryForRoot(root,start,end,map){
  let planned=0,actual=0,recordedPlanned=0,recordedCount=0,missingCount=0;
  const todayKey=ds(new Date());
  for(let d=new Date(start); d<=end; d=add(d,1)){
    const date=ds(d), p=plannedHoursForRootDate(root,date,map), a=actualWorkValue(date,root.id);
    planned+=p;
    if(a!==null){ actual+=a; recordedPlanned+=p; recordedCount++; }
    else if(p>0 && date<=todayKey) missingCount++;
  }
  return {planned,actual,recordedPlanned,recordedCount,missingCount,diff:actual-recordedPlanned};
}
function diffHoursHtml(diff){
  const n=Math.round((Number(diff)||0)*100)/100;
  const cls=n>0?'workDiffPlus':n<0?'workDiffMinus':'workDiffZero';
  const sign=n>0?'+':n<0?'-':'';
  return `<span class="${cls}">${sign}${fmtH(Math.abs(n))}</span>`;
}
function renderLoad(){
  const mode=['week','month','year'].includes(state.settings?.workloadRange)?state.settings.workloadRange:'week';
  const {start,end}=workloadPeriodBounds(mode), startS=ds(start), endS=ds(end);
  const map=buildOccurrenceMap(startS,endS,{includePreparations:false});
  const roots=topLevelCals();
  const periodLabel=workloadPeriodLabel(mode,start,end);
  const modeButtons=`<div class="workloadTabs"><button type="button" data-workload-range="week" class="${mode==='week'?'on':''}">주</button><button type="button" data-workload-range="month" class="${mode==='month'?'on':''}">월</button><button type="button" data-workload-range="year" class="${mode==='year'?'on':''}">연</button></div>`;
  let html=`${modeButtons}<div class="workloadPeriodTitle">${esc(periodLabel)}</div>`;
  if(mode==='week'){
    let weekPlanned=0, weekActual=0, weekRecordedPlanned=0, weekMissing=0;
    const todayKey=ds(new Date());
    for(let i=0;i<7;i++){
      const d=add(start,i), date=ds(d), dow=['일','월','화','수','목','금','토'][d.getDay()];
      let dayPlanned=0, dayActual=0, dayRecordedPlanned=0, dayRecorded=0, dayMissing=0;
      const rows=[];
      for(const root of roots){
        const planned=plannedHoursForRootDate(root,date,map), actual=actualWorkValue(date,root.id), cap=capacityForDate(root,date);
        const details=workloadChildBreakdown(root,date,map);
        dayPlanned+=planned;
        if(actual!==null){ dayActual+=actual; dayRecordedPlanned+=planned; dayRecorded++; }
        else if(planned>0 && date<=todayKey) dayMissing++;
        const capText=cap.blocked?'가용 0h · 차단':cap.unknown?'가용 미정':`가용 ${fmtH(cap.hours)}`;
        const diff=actual===null?'':` · 차이 ${diffHoursHtml(actual-planned)}`;
        const childText=details.length?`<div class="workloadBreakdown">${details.map(({c,sum})=>`<span style="--work-cal:${esc(c.color)}"><i></i>${esc(c.name)} ${fmtH(sum)}</span>`).join('')}</div>`:'';
        rows.push(`<div class="workloadCalRow" style="--work-cal:${esc(root.color)}"><div class="workloadCalTop"><span class="workloadCalName"><i></i><b>${esc(root.name)}</b></span><span class="workloadPlan">배치 ${fmtH(planned)}</span></div><div class="workloadCalMeta"><span>${capText}</span><label>실제 <input class="actualWorkInput" type="number" min="0" max="24" step="0.25" inputmode="decimal" data-work-date="${date}" data-work-root="${esc(root.id)}" value="${actual===null?'':String(actual)}" placeholder="미입력"> h</label>${diff}</div>${childText}</div>`);
      }
      weekPlanned+=dayPlanned; weekActual+=dayActual; weekRecordedPlanned+=dayRecordedPlanned; weekMissing+=dayMissing;
      const dayDiff=dayRecorded?` · 기록분 차이 ${diffHoursHtml(dayActual-dayRecordedPlanned)}`:'';
      html+=`<div class="workloadDay"><div class="workloadDayHead"><b>${dow} ${d.getMonth()+1}/${d.getDate()}</b><span>배치 ${fmtH(dayPlanned)} · 실제 ${fmtH(dayActual)}${dayDiff}${dayMissing?` · 미입력 ${dayMissing}`:''}</span></div>${rows.join('')}</div>`;
    }
    html+=`<div class="workloadGrand"><b>주 합계</b><div><span>배치 <strong>${fmtH(weekPlanned)}</strong></span><span>실제 <strong>${fmtH(weekActual)}</strong></span><span>기록분 차이 ${diffHoursHtml(weekActual-weekRecordedPlanned)}</span>${weekMissing?`<span class="workMissing">미입력 ${weekMissing}건</span>`:''}</div></div>`;
  }else{
    let totalPlanned=0,totalActual=0,totalRecordedPlanned=0,totalMissing=0;
    const rows=[];
    for(const root of roots){
      const x=workloadSummaryForRoot(root,start,end,map);
      totalPlanned+=x.planned; totalActual+=x.actual; totalRecordedPlanned+=x.recordedPlanned; totalMissing+=x.missingCount;
      rows.push(`<div class="workloadAggregateRow" style="--work-cal:${esc(root.color)}"><div class="workloadAggName"><i></i><b>${esc(root.name)}</b></div><div class="workloadAggNums"><span>배치 <strong>${fmtH(x.planned)}</strong></span><span>실제 <strong>${fmtH(x.actual)}</strong></span><span>기록분 차이 ${diffHoursHtml(x.diff)}</span>${x.missingCount?`<span class="workMissing">미입력 ${x.missingCount}건</span>`:''}</div></div>`);
    }
    html+=rows.join('')||'<div class="empty">등록된 캘린더가 없습니다.</div>';
    html+=`<div class="workloadGrand"><b>${mode==='month'?'월':'연'} 합계</b><div><span>배치 <strong>${fmtH(totalPlanned)}</strong></span><span>실제 <strong>${fmtH(totalActual)}</strong></span><span>기록분 차이 ${diffHoursHtml(totalActual-totalRecordedPlanned)}</span>${totalMissing?`<span class="workMissing">미입력 ${totalMissing}건</span>`:''}</div></div>`;
    html+=`<p class="workloadHint">실제시간은 주 보기에서 날짜·상위캘린더별로 입력합니다. 부속캘린더의 배치시간은 상위캘린더에 합산됩니다.</p>`;
  }
  $('#weekLoad').innerHTML=html;
  $$('#weekLoad [data-workload-range]').forEach(btn=>btn.onclick=()=>{ state.settings.workloadRange=btn.dataset.workloadRange; save(); });
  $$('#weekLoad .actualWorkInput').forEach(inp=>{
    inp.addEventListener('change',()=>setActualWorkValue(inp.dataset.workDate,inp.dataset.workRoot,inp.value));
    inp.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); inp.blur(); } });
  });
}

function nextOccurrenceFor(e, from=ds(new Date()), horizonDays=740){
  const ends=ds(add(parse(from),horizonDays));
  const starts=generateOccurrenceStarts(e,from,ends).filter(d=>ds(d)>=from);
  return starts.length?ds(starts[0]):null;
}
function selectedDdayInfo(){
  const id=String(state.settings?.selectedDdayId||'');
  if(!id) return null;
  const e=state.events.find(x=>x.id===id && x.kind==='anniversary');
  if(!e) return null;
  const today=ds(new Date());
  const target=(e.repeat||'none')==='none' ? e.date : nextOccurrenceFor(e,today,740);
  return target ? {e,target} : null;
}
function selectedDdayOffset(date){
  const info=selectedDdayInfo();
  if(!info || !date) return '';
  const diff=diffDays(date,info.target);
  return diff===0?'D-Day':diff>0?`D-${diff}`:`D+${Math.abs(diff)}`;
}
function selectedDdayMarkerHtml(date, extraClass=''){
  const info=selectedDdayInfo();
  if(!info) return '';
  const label=selectedDdayOffset(date);
  return `<span class="selectedDdayMarker ${esc(extraClass)}" title="${esc(info.e.title)} · ${esc(info.target)} 기준">${esc(label)}</span>`;
}
function renderDdays(){
  const today=ds(new Date());
  const selectedId=String(state.settings?.selectedDdayId||'');
  const rows=state.events.filter(e=>e.kind==='anniversary').map(e=>{
    let target;
    if((e.repeat||'none')==='none') target=e.date;
    else target=nextOccurrenceFor(e,today,740);
    if(!target) return null;
    return {e,target,diff:diffDays(today,target)};
  }).filter(Boolean).sort((a,b)=>Math.abs(a.diff)-Math.abs(b.diff)).slice(0,8);
  $('#ddayList').innerHTML=rows.map(({e,target,diff})=>{
    const selected=e.id===selectedId;
    const ddayText=diff===0?'D-Day':diff>0?`D-${diff}`:`D+${Math.abs(diff)}`;
    return `<div class="ddayRow ${selected?'selectedDday':''}" data-eid="${esc(e.id)}" role="button" tabindex="0" title="클릭: 달력 D-Day 기준 ${selected?'해제':'선택'}"><div class="ddayInfo">${esc(e.title)}<small>${target}</small>${selected?'<em class="ddaySelectedTag">기준</em>':''}</div><div class="ddayActions"><b>${ddayText}</b><button type="button" class="ddayEditBtn" data-dday-edit="${esc(e.id)}" title="D-Day 수정" aria-label="D-Day 수정">✎</button></div></div>`;
  }).join('')||'<div class="empty">등록된 기념일이 없습니다.</div>';
  $$('.ddayRow').forEach(x=>{
    const toggle=()=>{
      const id=x.dataset.eid||'';
      state.settings.selectedDdayId=state.settings.selectedDdayId===id?'':id;
      save();
    };
    x.onclick=e=>{ if(e.target.closest('.ddayEditBtn')) return; toggle(); };
    x.onkeydown=e=>{ if((e.key==='Enter'||e.key===' ') && !e.target.closest('.ddayEditBtn')){ e.preventDefault(); toggle(); } };
  });
  $$('.ddayEditBtn').forEach(btn=>btn.onclick=e=>{ e.preventDefault(); e.stopPropagation(); openEvent(null,btn.dataset.ddayEdit); });
}

function diaryEntries(){
  return Object.entries(state.diary||{})
    .filter(([date,d])=>/^\d{4}-\d{2}-\d{2}$/.test(date) && String(d?.text||'').trim())
    .map(([date,d])=>({date,text:String(d.text||'').trim(),updatedAt:String(d.updatedAt||'')}))
    .sort((a,b)=>b.date.localeCompare(a.date));
}
function diaryPreview(text,max=90){
  const preview=String(text||'').replace(/\s+/g,' ').trim();
  return preview.length>max?preview.slice(0,max)+'…':preview;
}
function renderDiaryArchive(){
  const filter=$('#diaryMonthFilter'), box=$('#diaryArchiveList');
  if(!filter || !box) return;
  const entries=diaryEntries();

  const monthCounts=new Map();
  entries.forEach(x=>{ const m=x.date.slice(0,7); monthCounts.set(m,(monthCounts.get(m)||0)+1); });
  const months=[...monthCounts.keys()].sort((a,b)=>b.localeCompare(a));
  if(selectedDiaryMonth!=='all' && !monthCounts.has(selectedDiaryMonth)) selectedDiaryMonth='all';
  filter.innerHTML=`<option value="all">전체 (${entries.length})</option>`+months.map(m=>{
    const [y,mo]=m.split('-');
    return `<option value="${esc(m)}">${Number(y)}년 ${Number(mo)}월 (${monthCounts.get(m)})</option>`;
  }).join('');
  filter.value=selectedDiaryMonth;
  filter.onchange=()=>{ selectedDiaryMonth=filter.value||'all'; renderDiaryArchive(); };

  const visible=selectedDiaryMonth==='all'?entries:entries.filter(x=>x.date.startsWith(selectedDiaryMonth+'-'));
  box.innerHTML=visible.map(x=>{
    const d=parse(x.date);
    return `<button type="button" class="diaryArchiveRow" data-diary-archive="${esc(x.date)}" title="${esc(x.text)}"><b class="diaryArchiveDate">${d.getMonth()+1}.${d.getDate()}</b><small class="diaryArchivePreview">${esc(diaryPreview(x.text,54))}</small></button>`;
  }).join('') || `<div class="empty compactEmpty">${selectedDiaryMonth==='all'?'작성된 다이어리가 없습니다.':'이 달에 작성된 다이어리가 없습니다.'}</div>`;
  box.querySelectorAll('[data-diary-archive]').forEach(row=>{
    row.onclick=()=>openDiary(row.dataset.diaryArchive);
  });
  const openMain=$('#diaryOpenMain');
  if(openMain){
    openMain.onclick=e=>{
      e.preventDefault(); e.stopPropagation();
      if(selectedDiaryMonth!=='all'){
        const [y,m]=selectedDiaryMonth.split('-').map(Number);
        cursor=new Date(y,m-1,1);
      }else if(entries.length){
        const d=parse(entries[0].date); cursor=new Date(d.getFullYear(),d.getMonth(),1);
      }
      view='diary'; render();
    };
  }
}

function diaryMonthInfo(){
  const y=cursor.getFullYear(), m=cursor.getMonth(), first=new Date(y,m,1), s=startWeek(first);
  const monthDays=new Date(y,m+1,0).getDate(), mondayOffset=(first.getDay()+6)%7;
  const weekCount=Math.ceil((mondayOffset+monthDays)/7), total=weekCount*7;
  return {y,m,s,weekCount,total};
}
function bindDiaryMainActions(){
  $$('[data-diary-main-mode]').forEach(b=>b.onclick=()=>{ diaryMainMode=b.dataset.diaryMainMode; renderDiaryMain(); });
  $$('[data-diary-main-date]').forEach(x=>x.onclick=()=>openDiary(x.dataset.diaryMainDate));
}
function renderDiaryMain(){
  const {y,m,s,weekCount,total}=diaryMonthInfo();
  const entries=diaryEntries(), byDate=new Map(entries.map(x=>[x.date,x]));
  const monthPrefix=`${y}-${pad(m+1)}`;
  const monthEntries=entries.filter(x=>x.date.startsWith(monthPrefix+'-'));
  setRangeLabel(`다이어리 · ${y}년 ${m+1}월`,`다이어리 ${m+1}월`);
  $('#main').className='diaryMainView';
  const toolbar=`<div class="diaryMainToolbar"><div class="diaryMainHeading"><b>다이어리</b><small>${y}년 ${m+1}월 · ${monthEntries.length}일 작성</small></div><div class="diaryMainActions"><button type="button" data-diary-main-mode="calendar" class="${diaryMainMode==='calendar'?'on':''}">달력형</button><button type="button" data-diary-main-mode="list" class="${diaryMainMode==='list'?'on':''}">목록형</button></div></div>`;
  if(diaryMainMode==='list'){
    const rows=monthEntries.map(x=>{
      const d=parse(x.date), dow=['일','월','화','수','목','금','토'][d.getDay()];
      return `<button type="button" class="diaryWideListRow" data-diary-main-date="${esc(x.date)}" title="${esc(x.text)}"><span class="diaryWideDate"><b>${d.getMonth()+1}.${d.getDate()}</b><small>${dow}요일</small></span><span class="diaryWidePreview">${esc(diaryPreview(x.text,180))}</span><span class="diaryWideOpen">${diaryIconHtml(true)}</span></button>`;
    }).join('');
    $('#main').innerHTML=toolbar+`<div class="diaryWideList">${rows||'<div class="diaryMainEmpty">이 달에 작성된 다이어리가 없습니다.</div>'}</div>`;
  }else{
    const heads=['월','화','수','목','금','토','일'].map((x,i)=>`<div class="diaryCalendarWeekday ${i===5?'saturday':i===6?'sunday':''}">${x}</div>`).join('');
    const cells=[...Array(total)].map((_,i)=>{
      const d=add(s,i), key=ds(d), item=byDate.get(key), has=!!item, dow=d.getDay();
      const classes=[d.getMonth()!==m?'other':'',key===ds(new Date())?'today':'',dow===0?'sunday':'',dow===6?'saturday':'',has?'hasDiary':''].filter(Boolean).join(' ');
      return `<div class="diaryCalendarCell ${classes}" data-diary-main-date="${key}" title="${has?esc(item.text):'다이어리 작성'}"><div class="diaryCalendarCellHead"><b>${d.getDate()}</b><span class="diaryCalendarGlyph">${diaryIconHtml(has)}</span></div><div class="diaryCalendarCellPreview">${has?esc(diaryPreview(item.text,64)):'<span class="diaryEmptyHint">미작성</span>'}</div></div>`;
    }).join('');
    $('#main').style.setProperty('--diary-weeks',String(weekCount));
    $('#main').innerHTML=toolbar+`<div class="diaryCalendarGrid">${heads}${cells}</div>`;
  }
  bindDiaryMainActions();
}

function readDragPayload(dt){
  if(activeDrag) return activeDrag;
  try{
    const fixed=dt.getData('application/x-calendar-fixed'); if(fixed) return {type:'fixed',id:fixed};
    const flexible=dt.getData('application/x-calendar-flexible'); if(flexible) return {type:'flexible',id:flexible};
    const event=dt.getData('application/x-calendar-event'); if(event){ try{ const p=JSON.parse(event); if(p?.id) return {type:'event',id:p.id,occurrence:p.occurrence||'',day:p.day||'',calId:p.calId||'',lane:p.lane||''}; }catch(_e){ return {type:'event',id:event}; } }
    const plain=dt.getData('text/plain')||'';
    if(plain.startsWith('calendar-fixed:')) return {type:'fixed',id:plain.slice('calendar-fixed:'.length)};
    if(plain.startsWith('calendar-flexible:')) return {type:'flexible',id:plain.slice('calendar-flexible:'.length)};
    if(plain.startsWith('calendar-event:')){
      const parts=plain.slice('calendar-event:'.length).split(':');
      return {type:'event',id:parts[0]||'',occurrence:parts[1]||'',day:parts[2]||''};
    }
  }catch(_e){}
  return null;
}
function occurrenceKey(e){ return `${e.id}|${e._occurrenceStart||e.date}`; }
function eventOrderGroupKey(e){
  if(!e) return '';
  if(e.kind==='anniversary' || e.kind==='appointment') return 'common';
  if(e.kind==='todo') return 'quick';
  if(e.kind==='payment') return 'payment';
  const root=topAncestor(e.calId);
  return `cal:${root?.id||e.calId||''}`;
}
let pendingRepeatOrder=null;
function reorderDropBefore(payload,targetItem){
  if(!payload?.id || !payload.day || !targetItem) return null;
  const day=targetItem.dataset.renderDate||'';
  if(!day || day!==payload.day) return null;
  const src=state.events.find(x=>x.id===payload.id), target=state.events.find(x=>x.id===targetItem.dataset.eid);
  if(!src||!target) return null;
  const sourceGroup=eventOrderGroupKey(src), targetGroup=eventOrderGroupKey(target);
  if(!sourceGroup || sourceGroup!==targetGroup) return null;

  // v1.67: 계산된 데이터 순서가 아니라 사용자가 현재 보고 있는 DOM 순서를 우선한다.
  // 위에 보이는 카드를 아래 카드로 끌면 무조건 '대상 뒤', 아래 카드를 위로 끌면 '대상 앞'.
  const occ=payload.occurrence||src.date;
  const candidates=[...document.querySelectorAll('.item')].filter(el=>
    el.dataset.eid===payload.id &&
    (el.dataset.occurrence||'')===String(occ) &&
    (el.dataset.renderDate||'')===day
  );
  const sourceItem=candidates.find(el=>el!==targetItem) || candidates[0];
  if(sourceItem && sourceItem!==targetItem){
    const pos=sourceItem.compareDocumentPosition(targetItem);
    if(pos & Node.DOCUMENT_POSITION_FOLLOWING) return false; // source가 위 -> target 뒤
    if(pos & Node.DOCUMENT_POSITION_PRECEDING) return true;  // source가 아래 -> target 앞
  }

  // DOM 판정이 불가능한 경우에만 데이터 순서로 보정한다.
  const map=buildOccurrenceMap(day,day,{calendarIds:focusedCalendarIds(),includePreparations:false});
  const list=[]; const seen=new Set();
  for(const e of (map[day]||[])){
    if(eventOrderGroupKey(e)!==sourceGroup) continue;
    const k=occurrenceKey(e); if(seen.has(k)) continue; seen.add(k); list.push(e);
  }
  const sourceKey=`${payload.id}|${occ}`;
  const targetKey=`${targetItem.dataset.eid}|${targetItem.dataset.occurrence||target.date}`;
  const from=list.findIndex(e=>occurrenceKey(e)===sourceKey), to=list.findIndex(e=>occurrenceKey(e)===targetKey);
  if(from<0||to<0||from===to) return null;
  return from>to;
}
function buildReorderContext(payload,targetItem,before=true){
  if(!payload?.id || !payload.day) return null;
  const day=targetItem.dataset.renderDate||'';
  if(!day || day!==payload.day) return null;
  const src=state.events.find(x=>x.id===payload.id), target=state.events.find(x=>x.id===targetItem.dataset.eid);
  if(!src||!target||src.id===target.id&&String(payload.occurrence||'')===String(targetItem.dataset.occurrence||'')) return null;
  const sourceGroup=eventOrderGroupKey(src), targetGroup=eventOrderGroupKey(target);
  if(!sourceGroup || sourceGroup!==targetGroup) return null;
  const map=buildOccurrenceMap(day,day,{calendarIds:focusedCalendarIds(),includePreparations:false});
  const list=[]; const seen=new Set();
  for(const e of (map[day]||[])){
    if(eventOrderGroupKey(e)!==sourceGroup) continue;
    const k=occurrenceKey(e); if(seen.has(k)) continue; seen.add(k); list.push(e);
  }
  const sourceKey=`${payload.id}|${payload.occurrence||src.date}`;
  const targetKey=`${targetItem.dataset.eid}|${targetItem.dataset.occurrence||target.date}`;
  const from=list.findIndex(e=>occurrenceKey(e)===sourceKey), to=list.findIndex(e=>occurrenceKey(e)===targetKey);
  if(from<0||to<0) return null;
  const [moved]=list.splice(from,1);
  let insertAt=list.findIndex(e=>occurrenceKey(e)===targetKey);
  if(insertAt<0) insertAt=list.length;
  if(!before) insertAt++;
  list.splice(Math.min(insertAt,list.length),0,moved);
  return {day,src,target,sourceGroup,list};
}
function buildReorderToEndContext(payload,day){
  if(!payload?.id || !day || payload.day!==day) return null;
  const src=state.events.find(x=>x.id===payload.id); if(!src) return null;
  const sourceGroup=eventOrderGroupKey(src); if(!sourceGroup) return null;
  const map=buildOccurrenceMap(day,day,{calendarIds:focusedCalendarIds(),includePreparations:false});
  const list=[]; const seen=new Set();
  for(const e of (map[day]||[])){
    if(eventOrderGroupKey(e)!==sourceGroup) continue;
    const k=occurrenceKey(e); if(seen.has(k)) continue; seen.add(k); list.push(e);
  }
  const sourceKey=`${payload.id}|${payload.occurrence||src.date}`;
  const from=list.findIndex(e=>occurrenceKey(e)===sourceKey);
  if(from<0 || from===list.length-1) return null;
  const [moved]=list.splice(from,1); list.push(moved);
  return {day,src,target:null,sourceGroup,list};
}
function commitReorderContext(ctx){
  if(!ctx) return false;
  if((ctx.src.repeat||'none')!=='none'){
    pendingRepeatOrder=ctx;
    $('#repeatOrderInfo').textContent=`${ctx.day} 순서 변경을 이 날짜에만 적용할지, 다른 반복 날짜에도 적용할지 선택하세요.`;
    openDialog($('#repeatOrderDlg'));
    return true;
  }
  return applyReorderContext(ctx,'day');
}
function applyReorderContext(ctx,scope='day'){
  if(!ctx) return false;
  ctx.list.forEach((occ,i)=>{
    const base=state.events.find(x=>x.id===occ.id); if(!base) return;
    base.orderByDate=(base.orderByDate&&typeof base.orderByDate==='object')?base.orderByDate:{};
    base.orderByDate[ctx.day]=(i+1)*10;
    if(scope==='series') base.repeatOrder=(i+1)*10;
  });
  save();
  return true;
}
function reorderOccurrenceInDay(payload,targetItem,before=true){
  return commitReorderContext(buildReorderContext(payload,targetItem,before));
}
$('#orderOccurrenceOnly').onclick=()=>{
  if(pendingRepeatOrder) applyReorderContext(pendingRepeatOrder,'day');
  pendingRepeatOrder=null; closeDialog($('#repeatOrderDlg'));
};
$('#orderSeries').onclick=()=>{
  if(pendingRepeatOrder) applyReorderContext(pendingRepeatOrder,'series');
  pendingRepeatOrder=null; closeDialog($('#repeatOrderDlg'));
};
$('#cancelRepeatOrder').onclick=()=>{ pendingRepeatOrder=null; closeDialog($('#repeatOrderDlg')); render(); };


let eventPopoverState={id:'',occ:''};

let activePrepPlanId='';
let activePrepPlanDate='';
function openPreparationPlan(id,focusDate=''){
  const e=state.events.find(x=>x.id===id && x.prepEnabled); if(!e) return;
  if(activePrepPlanId!==id) activePrepPlanDate='';
  activePrepPlanId=id;
  if(focusDate) activePrepPlanDate=String(focusDate);
  const entries=preparationEntries(e);
  $('#prepPlanTitle').textContent=e.title;
  const prepProgress=preparationProgress(e);
  const prepComplete=prepProgress.total>0 && prepProgress.done===prepProgress.total && prepProgress.missed===0;
  const prepDlg=$('#prepPlanDlg'), completeBadge=$('#prepPlanCompleteBadge');
  prepDlg?.classList.toggle('complete',prepComplete);
  if(completeBadge) completeBadge.classList.toggle('hidden',!prepComplete);
  $('#prepPlanSummary').textContent=`${preparationSummary(e)}${prepProgress.total?` · 완료 ${prepProgress.done}/${prepProgress.total}`:''}${prepProgress.missed?` · 못함 ${prepProgress.missed}`:''}`;
  const memo=$('#prepPlanGeneralMemo');
  memo.textContent=''; memo.classList.add('hidden');
  const rows=entries.map(entry=>{
    const note=String(entry.text||'').trim(), done=preparationEntryDone(e,entry.key), missed=preparationEntryMissed(e,entry.key);
    const rule=entry.ruleLabel&&entry.type!=='auto'?`<small class="prepPlanRule">${esc(entry.ruleLabel)}${entry.moved?' · 이동':''}</small>`:(entry.moved?`<small class="prepPlanRule">이동</small>`:'');
    const focused=activePrepPlanDate&&entry.date===activePrepPlanDate;
    return `<div class="prepPlanRow ${done?'done':''} ${missed?'missed':''} ${focused?'focused':''}"><div class="prepPlanStatus"><button type="button" class="prepPlanCheck" data-prep-plan-check="${esc(entry.key)}" title="${done?'완료 해제':missed?'못함 해제 후 완료 선택 가능':'완료 처리'}" ${missed?'disabled aria-disabled="true"':''}>${done?'☑':'☐'}</button><button type="button" class="prepPlanMissed ${missed?'on':''}" data-prep-plan-missed="${esc(entry.key)}" title="${missed?'못함 해제':done?'완료 해제 후 못함 선택 가능':'못함 처리'}" ${done?'disabled aria-disabled="true"':''}>${missed?'☑':'☐'}</button></div><div class="prepPlanDate">${esc(preparationDateLabel(entry.date))}${focused?'<span class="prepPlanSelectedBadge">선택한 날짜</span>':''}<small>${esc(entry.date)}</small>${rule}</div><div class="prepPlanText ${note?'':'muted'}">${esc(note||'계획 미입력')}</div></div>`;
  });
  if(!rows.length) rows.push(`<div class="prepPlanRow"><span class="prepPlanCheckSpacer"></span><div class="prepPlanDate">준비일정</div><div class="prepPlanText muted">등록된 준비 일정이 없습니다.</div></div>`);
  const deadline=e.prepDeadline||e.date, deadlineFocused=activePrepPlanDate&&deadline===activePrepPlanDate;
  const deadlineMemo=String(e.memo||'').trim();
  rows.push(`<div class="prepPlanRow deadline ${prepComplete?'done completeDeadline':''} ${deadlineFocused?'focused':''}"><span class="prepPlanCheckSpacer">${prepComplete?'✓':''}</span><div class="prepPlanDate">마감일<small>${esc(deadline)}</small></div><div class="prepPlanText"><b>${esc(e.title)}</b>${e.place?`<br>${esc(e.place)}`:''}${deadlineMemo?`<div class="prepDeadlineMemo"><span>메모</span>${esc(deadlineMemo)}</div>`:''}</div></div>`);
  $('#prepPlanList').innerHTML=rows.join('');
  $('#prepPlanList').onclick=ev=>{
    const doneBtn=ev.target.closest('[data-prep-plan-check]');
    if(doneBtn){ ev.preventDefault(); ev.stopPropagation(); if(doneBtn.disabled) return; togglePreparationDone(e.id,doneBtn.dataset.prepPlanCheck||''); return; }
    const missedBtn=ev.target.closest('[data-prep-plan-missed]');
    if(missedBtn){ ev.preventDefault(); ev.stopPropagation(); if(missedBtn.disabled) return; togglePreparationMissed(e.id,missedBtn.dataset.prepPlanMissed||''); }
  };
  openDialog($('#prepPlanDlg'));
  // 선택한 날짜가 목록 아래에 있어도 팝업 안에서 바로 보이도록 이동한다.
  if(activePrepPlanDate){
    requestAnimationFrame(()=>{
      const dlg=$('#prepPlanDlg');
      const form=dlg?.querySelector('form');
      const target=dlg?.querySelector('.prepPlanRow.focused');
      if(!dlg?.open || !form || !target) return;
      const containerRect=form.getBoundingClientRect();
      const targetRect=target.getBoundingClientRect();
      const position=form.scrollTop+targetRect.top-containerRect.top;
      form.scrollTop=Math.max(0,position-Math.max(16,(form.clientHeight-target.offsetHeight)/2));
    });
  }
}
$('#closePrepPlan').onclick=()=>closeDialog($('#prepPlanDlg'));
$('#closePrepPlanBottom').onclick=()=>closeDialog($('#prepPlanDlg'));
$('#editPrepPlan').onclick=()=>{ const id=activePrepPlanId; closeDialog($('#prepPlanDlg')); if(id) openEvent(null,id); };

function closeEventPopover(){
  const p=$('#eventPopover'); if(p) p.classList.add('hidden');
  eventPopoverState={id:'',occ:''};
}
function eventKindLabel(e){
  return {event:'일정',appointment:'예약 · 약속',todo:'Quick',habit:'습관/루틴',anniversary:'D-Day · 기념일',payment:'납부일정'}[e?.kind]||'일정';
}
function positionEventPopover(anchor){
  const pop=$('#eventPopover'); if(!pop||!anchor) return;
  pop.classList.remove('hidden');
  const ar=anchor.getBoundingClientRect(), pr=pop.getBoundingClientRect();
  const pad=8;
  let left=Math.min(window.innerWidth-pr.width-pad,Math.max(pad,ar.left));
  let top=ar.bottom+6;
  if(top+pr.height>window.innerHeight-pad) top=Math.max(pad,ar.top-pr.height-6);
  pop.style.left=`${left}px`; pop.style.top=`${top}px`;
}
function openEventPopover(anchor,id,occ){
  const base=state.events.find(x=>x.id===id); if(!base) return;
  const occurrence=occ||base.date;
  const e={...base,_occurrenceStart:occurrence,_renderDate:anchor?.dataset?.renderDate||occurrence};
  eventPopoverState={id,occ:occurrence};
  $('#eventPopoverTitle').textContent=base.title;
  $('#eventPopoverKind').textContent=eventKindLabel(base);
  const meta=[];
  meta.push(occurrence);
  if(!base.allDay && base.start) meta.push(base.start+(base.end?`–${base.end}`:''));
  if(base.kind==='payment'){
    if(Number(base.paymentAmount)>0) meta.push(`₩${Number(base.paymentAmount).toLocaleString('ko-KR')}`);
    if(base.paymentMethod) meta.push(base.paymentMethod);
  }else if(base.noDuration) meta.push('소요시간 미체크');
  else if(duration(base)>0) meta.push(fmtH(duration(base)));
  meta.push(base.sourceType==='purchase'?'구매목록':calendarPath(base.calId));
  if((base.repeat||'none')!=='none') meta.push(repeatRuleLabel(base));
  $('#eventPopoverMeta').textContent=meta.filter(Boolean).join(' · ');
  const details=$('#eventPopoverDetails');
  const placeRow=$('#eventPopoverPlace'), memoRow=$('#eventPopoverMemo');
  const placeText=String(base.place||'').trim(), memoText=String(base.memo||'').trim();
  if(placeRow){ placeRow.classList.toggle('hidden',!placeText); const span=placeRow.querySelector('span'); if(span) span.textContent=placeText; }
  if(memoRow){ memoRow.classList.toggle('hidden',!memoText); const span=memoRow.querySelector('span'); if(span) span.textContent=memoText; }
  if(details) details.classList.toggle('hidden',!(placeText||memoText));
  const planBtn=$('#eventPopoverPlan'); if(planBtn) planBtn.classList.toggle('hidden',!base.prepEnabled);
  const doneWrap=$('#eventPopoverDoneWrap'), done=$('#eventPopoverDone'), doneText=$('#eventPopoverDoneText');
  const canComplete=true;
  doneWrap.classList.toggle('hidden',false);
  done.checked=!!isDone(e); doneText.textContent=base.kind==='payment'?'납부완료':'완료';
  positionEventPopover(anchor);
}
$('#eventPopoverClose').onclick=closeEventPopover;
$('#eventPopoverEdit').onclick=()=>{
  const {id,occ}=eventPopoverState; if(!id) return;
  closeEventPopover(); openEvent(occ,id);
};
$('#eventPopoverPlan').onclick=()=>{ const {id,occ}=eventPopoverState; if(!id) return; closeEventPopover(); openPreparationPlan(id,occ||''); };
$('#eventPopoverDone').onchange=()=>{
  const {id,occ}=eventPopoverState; if(!id) return;
  const ev=state.events.find(x=>x.id===id); if(!ev) return;
  const current=isDone({...ev,_occurrenceStart:occ||ev.date});
  const want=!!$('#eventPopoverDone').checked;
  if(current!==want) toggleDone(id,occ||ev.date);
  closeEventPopover();
};
document.addEventListener('pointerdown',e=>{
  const pop=$('#eventPopover'); if(!pop || pop.classList.contains('hidden')) return;
  if(pop.contains(e.target) || e.target.closest?.('.item')) return;
  closeEventPopover();
});
window.addEventListener('resize',closeEventPopover);
window.addEventListener('resize',scheduleMultiWeekCellFit,{passive:true});
let weekdayResizeRefresh=0;
window.addEventListener('resize',()=>{ clearTimeout(weekdayResizeRefresh); weekdayResizeRefresh=setTimeout(()=>{ applyWeekdayWidths(); scheduleMultiWeekCellFit(); },60); },{passive:true});
const mobileBreakpoint=window.matchMedia('(max-width: 760px)');
mobileBreakpoint.addEventListener?.('change',()=>render());
document.addEventListener('scroll',e=>{ if(!$('#eventPopover')?.classList.contains('hidden') && !$('#eventPopover')?.contains(e.target)) closeEventPopover(); },true);

let multiWeekDragScrollFrame=0;
let multiWeekDragScrollSpeed=0;
function stopMultiWeekDragScroll(){
  multiWeekDragScrollSpeed=0;
  if(multiWeekDragScrollFrame){ cancelAnimationFrame(multiWeekDragScrollFrame); multiWeekDragScrollFrame=0; }
}
function runMultiWeekDragScroll(){
  if(!multiWeekDragScrollSpeed){ multiWeekDragScrollFrame=0; return; }
  const main=$('#main');
  if(!main || !main.classList.contains('multiLaneView')){ stopMultiWeekDragScroll(); return; }
  const before=main.scrollTop;
  main.scrollTop+=multiWeekDragScrollSpeed;
  // 끝까지 도달했으면 불필요한 반복을 멈춥니다.
  if(main.scrollTop===before) multiWeekDragScrollSpeed=0;
  multiWeekDragScrollFrame=multiWeekDragScrollSpeed?requestAnimationFrame(runMultiWeekDragScroll):0;
}
function updateMultiWeekDragScroll(clientY){
  const main=$('#main');
  if(!main || !main.classList.contains('multiLaneView')) return stopMultiWeekDragScroll();
  const rect=main.getBoundingClientRect();
  const edge=Math.max(72,Math.min(150,rect.height*.22));
  let speed=0;
  if(clientY<rect.top+edge){
    const ratio=Math.max(0,Math.min(1,(rect.top+edge-clientY)/edge));
    speed=-(4+Math.round(18*ratio));
  }else if(clientY>rect.bottom-edge){
    const ratio=Math.max(0,Math.min(1,(clientY-(rect.bottom-edge))/edge));
    speed=4+Math.round(18*ratio);
  }
  multiWeekDragScrollSpeed=speed;
  if(speed && !multiWeekDragScrollFrame) multiWeekDragScrollFrame=requestAnimationFrame(runMultiWeekDragScroll);
  if(!speed) stopMultiWeekDragScroll();
}
function bindMultiWeekDragAssist(){
  const main=$('#main'); if(!main || !main.classList.contains('multiLaneView')) return;
  // 2주/3주 화면은 세로로 길기 때문에 카드를 잡은 채 화면 가장자리로 가면 자동 스크롤합니다.
  main.ondragover=e=>{
    const payload=activeDrag||readDragPayload(e.dataTransfer);
    if(payload?.type==='event') updateMultiWeekDragScroll(e.clientY);
  };
  main.ondragleave=e=>{
    const r=main.getBoundingClientRect();
    if(e.clientY<r.top-8 || e.clientY>r.bottom+8 || e.clientX<r.left-8 || e.clientX>r.right+8) stopMultiWeekDragScroll();
  };
  main.ondrop=()=>stopMultiWeekDragScroll();
}

function bindItems(){
  $$('.item').forEach(item=>{
    item.onclick=e=>{
      const id=item.dataset.eid, occ=item.dataset.occurrence;
      if(item.dataset.purchaseDue==='1' && item.dataset.purchaseId){
        e.preventDefault(); e.stopPropagation();
        if($('#dayListDlg')?.open) closeDialog($('#dayListDlg'));
        openPurchase(item.dataset.purchaseId);
        return;
      }
      const sub=e.target.closest('[data-action="subtask"]');
      if(sub){ e.stopPropagation(); toggleSubtask(id,occ,sub.dataset.subtaskId); return; }
      if(e.target.closest('[data-action="importance"]')){ e.stopPropagation(); toggleImportant(id); return; }
      if(e.target.closest('[data-action="prep-toggle"]')){ e.stopPropagation(); togglePreparationDone(id,item.dataset.prepKey||''); return; }
      if(e.target.closest('[data-action="toggle"]')){ e.stopPropagation(); if($('#dayListDlg')?.open) closeDialog($('#dayListDlg')); toggleDone(id,occ); return; }
      if(e.target.closest('[data-action="checklist-toggle"]')){
        e.stopPropagation();
        const base=state.events.find(x=>x.id===id); if(!base) return;
        const key=`${id}|${occ||base.date}`;
        expandedChecklistKeys.has(key)?expandedChecklistKeys.delete(key):expandedChecklistKeys.add(key);
        render();
        return;
      }
      e.stopPropagation();
      if($('#dayListDlg')?.open) closeDialog($('#dayListDlg'));
      const baseEvent=state.events.find(x=>x.id===id);
      if(baseEvent?.prepEnabled){ openPreparationPlan(id,item.dataset.renderDate||occ||''); return; }
      openEventPopover(item,id,occ);
    };
    if(item.draggable){
      item.ondragstart=e=>{
        const payload={type:'event',id:item.dataset.eid,occurrence:item.dataset.occurrence,day:item.dataset.renderDate||'',calId:item.dataset.calId||'',lane:item.dataset.lane||'',prepKey:item.dataset.prepKey||'',prepSourceDate:item.dataset.prepSourceDate||'',prepType:item.dataset.prepType||'',prepRuleId:item.dataset.prepRuleId||''};
        activeDrag=payload;
        item.classList.add('dragging');
        document.body.classList.add('calendarEventDragging');
        e.dataTransfer.effectAllowed='move';
        try{ e.dataTransfer.setData('application/x-calendar-event',JSON.stringify(payload)); }catch(_e){}
        e.dataTransfer.setData('text/plain',`calendar-event:${payload.id}:${payload.occurrence||''}:${payload.day||''}`);
      };
      item.ondragover=e=>{
        const payload=activeDrag||readDragPayload(e.dataTransfer);
        if(payload?.prepKey) return;
        const sameDay=payload?.type==='event' && payload.day && payload.day===item.dataset.renderDate;
        const srcEvent=payload?.id?state.events.find(x=>x.id===payload.id):null;
        const targetEvent=state.events.find(x=>x.id===item.dataset.eid);
        const sameGroup=sameDay && !!srcEvent && !!targetEvent && eventOrderGroupKey(srcEvent)===eventOrderGroupKey(targetEvent);
        if(!sameGroup) return;
        e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect='move';
        const before=reorderDropBefore(payload,item);
        if(before===null) return;
        item.classList.toggle('orderDropBefore',before); item.classList.toggle('orderDropAfter',!before);
      };
      item.ondragleave=()=>item.classList.remove('orderDropBefore','orderDropAfter');
      item.ondrop=e=>{
        const payload=activeDrag||readDragPayload(e.dataTransfer);
        if(payload?.prepKey) return;
        const sameDay=payload?.type==='event' && payload.day && payload.day===item.dataset.renderDate;
        const srcEvent=payload?.id?state.events.find(x=>x.id===payload.id):null;
        const targetEvent=state.events.find(x=>x.id===item.dataset.eid);
        const sameGroup=sameDay && !!srcEvent && !!targetEvent && eventOrderGroupKey(srcEvent)===eventOrderGroupKey(targetEvent);
        item.classList.remove('orderDropBefore','orderDropAfter');
        if(!sameGroup) return;
        e.preventDefault(); e.stopPropagation();
        const before=reorderDropBefore(payload,item);
        if(before===null) return;
        reorderOccurrenceInDay(payload,item,before); activeDrag=null;
      };
      item.ondragend=()=>{ activeDrag=null; stopMultiWeekDragScroll(); document.body.classList.remove('calendarEventDragging'); item.classList.remove('dragging','orderDropBefore','orderDropAfter'); $$('.dropReady').forEach(el=>el.classList.remove('dropReady')); $$('.orderDropBefore,.orderDropAfter').forEach(el=>el.classList.remove('orderDropBefore','orderDropAfter')); };
    }
  });
  $$('[data-dropdate]').forEach(x=>{
    x.ondragenter=e=>{ e.preventDefault(); x.classList.add('dropReady'); };
    x.ondragover=e=>{
      e.preventDefault();
      const payload=activeDrag||readDragPayload(e.dataTransfer);
      if(payload?.type==='event') updateMultiWeekDragScroll(e.clientY);
      e.dataTransfer.dropEffect=(payload?.type==='fixed'||payload?.type==='flexible')?'copy':'move';
      x.classList.add('dropReady');
    };
    x.ondragleave=e=>{ if(!x.contains(e.relatedTarget)) x.classList.remove('dropReady'); };
    x.ondrop=e=>{
      e.preventDefault(); e.stopPropagation(); x.classList.remove('dropReady');
      const payload=activeDrag||readDragPayload(e.dataTransfer); activeDrag=null; stopMultiWeekDragScroll(); document.body.classList.remove('calendarEventDragging');
      if(!payload) return;
      if(payload.type==='fixed'){
        const f=state.fixed.find(z=>z.id===payload.id);
        if(f){
          state.events.push({id:uid(),title:f.name,calId:f.calId,date:x.dataset.dropdate,endDate:x.dataset.dropdate,allDay:true,start:'',end:'',hours:f.hours,noDuration:!!f.noDuration,kind:'event',place:'',repeat:'none',repeatRule:null,memo:f.memo||'',fixedId:f.id,important:!!f.important,done:false,doneDates:[],checklist:structuredClone(f.checklist||[]),checklistDoneByDate:{},orderByDate:{}});
          save();
        }
        return;
      }
      if(payload.type==='flexible'){
        const f=(state.flexible||[]).find(z=>z.id===payload.id);
        if(f){
          state.events.push({id:uid(),title:f.name,calId:f.calId,date:x.dataset.dropdate,endDate:x.dataset.dropdate,allDay:true,start:'',end:'',hours:f.hours,noDuration:!!f.noDuration,kind:'event',place:'',repeat:'none',repeatRule:null,memo:f.memo||'',flexibleId:f.id,important:!!f.important,done:false,doneDates:[],checklist:structuredClone(f.checklist||[]),checklistDoneByDate:{},orderByDate:{}});
          save();
        }
        return;
      }
      if(payload.type==='event' && payload.id){
        const dropDay=x.dataset.dropdate;
        if(payload.prepKey){ movePreparationEntry(payload.id,payload.prepKey,dropDay,payload.prepSourceDate||'',payload.prepType||'',payload.prepRuleId||''); return; }
        // 같은 날짜의 빈 공간/카드 아래쪽에 놓으면 해당 구역의 맨 아래로 보낸다.
        // 카드 자체에 놓은 경우에는 위의 item.ondrop이 먼저 처리한다.
        if(payload.day && payload.day===dropDay){
          const ctx=buildReorderToEndContext(payload,dropDay);
          if(ctx){ commitReorderContext(ctx); return; }
          return;
        }
        moveEventToDate(payload.id,dropDay,payload.occurrence||'',payload.day||'');
      }
    };
  });
  $$('[data-daycal-toggle]').forEach(b=>b.onclick=e=>{
    e.preventDefault(); e.stopPropagation();
    toggleDayCalCollapsed(b.dataset.date,b.dataset.calId);
  });
  $$('[data-more-date]').forEach(b=>b.onclick=e=>{e.stopPropagation();openDayList(b.dataset.moreDate);});
  $$('.diaryBtn').forEach(b=>b.onclick=e=>{e.stopPropagation();openDiary(b.dataset.diarydate);});
}
let pendingRepeatMove=null;
function shiftedDateString(date,delta){ return ds(add(parse(date),delta)); }
function shiftedDateArray(arr,delta,predicate=()=>true){
  return (Array.isArray(arr)?arr:[]).filter(predicate).map(d=>shiftedDateString(String(d),delta));
}
function shiftedDateMap(obj,delta,predicate=()=>true){
  const out={};
  for(const [k,v] of Object.entries((obj&&typeof obj==='object')?obj:{})) if(predicate(k)) out[shiftedDateString(k,delta)]=structuredClone(v);
  return out;
}
function shiftRepeatRuleForAnchor(e,oldAnchor,newAnchor){
  const r=normalizedRule(e), delta=diffDays(oldAnchor,newAnchor), nd=parse(newAnchor);
  if(r.endType==='date' && r.until) r.until=shiftedDateString(r.until,delta);
  if(e.repeat==='weekly'){
    r.weekdays=[...new Set((r.weekdays||[]).map(w=>(Number(w)+delta%7+7)%7))].sort((a,b)=>((a+6)%7)-((b+6)%7));
  }else if(e.repeat==='monthly'){
    if(r.monthlyMode==='date') r.monthDay=nd.getDate();
    else if(r.monthlyMode==='monthEnd'){
      const isMonthEnd=nd.getDate()===daysInMonth(nd.getFullYear(),nd.getMonth());
      if(!isMonthEnd){ r.monthlyMode='date'; r.monthDay=nd.getDate(); }
    }else if(r.monthlyMode==='nthWeekday'){
      r.weekday=nd.getDay(); r.nth=Math.floor((nd.getDate()-1)/7)+1;
    }else if(r.monthlyMode==='lastWeekday'){
      const last=lastWeekday(nd.getFullYear(),nd.getMonth(),nd.getDay());
      if(ds(last)===newAnchor) r.weekday=nd.getDay();
      else { r.monthlyMode='date'; r.monthDay=nd.getDate(); }
    }
  }else if(e.repeat==='yearly'){
    if(r.yearlyCalendar==='lunar'){
      const lp=lunarPartsFromSolar(nd);
      if(lp){ r.lunarMonth=lp.month; r.lunarDay=lp.day; r.lunarLeap=!!lp.leap; }
    }else{
      r.yearlyMonth=nd.getMonth()+1; r.yearlyDay=nd.getDate();
    }
  }
  return r;
}
function moveRecurringOccurrenceOnly(e,newDate,occ){
  const span=Math.max(0,diffDays(e.date,e.endDate||e.date));
  e.excludedDates=Array.isArray(e.excludedDates)?e.excludedDates:[];
  if(!e.excludedDates.includes(occ)) e.excludedDates.push(occ);
  const wasDone=(e.doneDates||[]).includes(occ);
  const movedChecklistDone=Array.isArray(e.checklistDoneByDate?.[occ])?[...e.checklistDoneByDate[occ]]:[];
  const detached={...structuredClone(e),id:uid(),date:newDate,endDate:ds(add(parse(newDate),span)),repeat:'none',repeatRule:null,excludedDates:[],done:wasDone,doneDates:[],checklistDoneByDate:movedChecklistDone.length?{[newDate]:movedChecklistDone}:{},orderByDate:{},repeatOrder:0,fixedId:null,detachedFromRepeatId:e.id,detachedOccurrence:occ};
  if(e.checklistDoneByDate?.[occ]) delete e.checklistDoneByDate[occ];
  detached.carryoverHistory=[];
  state.events.push(detached);
}
function moveRecurringFuture(e,newDate,occ){
  const span=Math.max(0,diffDays(e.date,e.endDate||e.date));
  const delta=diffDays(occ,newDate);
  const oldRule=normalizedRule(e);
  const future={...structuredClone(e),id:uid(),date:newDate,endDate:ds(add(parse(newDate),span))};
  future.repeatRule=shiftRepeatRuleForAnchor(e,occ,newDate);
  // 종료 횟수형은 이미 지나간 발생 횟수를 제외한 남은 횟수만 새 시리즈로 넘깁니다.
  if(oldRule.endType==='count'){
    const prevEnd=ds(add(parse(occ),-1));
    const beforeCount=generateOccurrenceStarts(e,e.date,prevEnd).length;
    future.repeatRule.endType='count';
    future.repeatRule.count=Math.max(1,Number(oldRule.count||1)-beforeCount);
  }
  future.excludedDates=shiftedDateArray(e.excludedDates,delta,d=>String(d)>=occ);
  future.doneDates=shiftedDateArray(e.doneDates,delta,d=>String(d)>=occ);
  future.checklistDoneByDate=shiftedDateMap(e.checklistDoneByDate,delta,d=>String(d)>=occ);
  future.orderByDate=shiftedDateMap(e.orderByDate,delta,d=>String(d)>=occ);
  future.detachedFromRepeatId=''; future.detachedOccurrence='';

  if(occ<=e.date){
    future.id=e.id;
    Object.keys(e).forEach(k=>delete e[k]); Object.assign(e,future);
  }else{
    const pastRule=normalizedRule(e);
    pastRule.endType='date'; pastRule.until=ds(add(parse(occ),-1));
    e.repeatRule=pastRule;
    e.excludedDates=(e.excludedDates||[]).filter(d=>String(d)<occ);
    e.doneDates=(e.doneDates||[]).filter(d=>String(d)<occ);
    e.checklistDoneByDate=Object.fromEntries(Object.entries(e.checklistDoneByDate||{}).filter(([k])=>k<occ));
    e.orderByDate=Object.fromEntries(Object.entries(e.orderByDate||{}).filter(([k])=>k<occ));
    state.events.push(future);
  }
}
function moveRecurringWholeSeries(e,newDate,occ){
  const delta=diffDays(occ,newDate);
  const shiftedRule=shiftRepeatRuleForAnchor(e,occ,newDate);
  const oldDate=e.date, oldEnd=e.endDate||e.date;
  e.date=shiftedDateString(oldDate,delta);
  e.endDate=shiftedDateString(oldEnd,delta);
  e.repeatRule=shiftedRule;
  e.excludedDates=shiftedDateArray(e.excludedDates,delta);
  e.doneDates=shiftedDateArray(e.doneDates,delta);
  e.checklistDoneByDate=shiftedDateMap(e.checklistDoneByDate,delta);
  e.orderByDate=shiftedDateMap(e.orderByDate,delta);
  if(e.carryoverHistory?.length){
    e.carryoverHistory=e.carryoverHistory.map(r=>({...r,fromDate:shiftedDateString(r.fromDate,delta),toDate:shiftedDateString(r.toDate,delta)}));
  }
}
function finishRepeatMove(){ pendingRepeatMove=null; closeDialog($('#repeatMoveDlg')); save(); }
let pendingPrepMissed=null;
function togglePreparationDone(id,key){
  const e=state.events.find(x=>x.id===id && x.prepEnabled); if(!e || !key) return;
  e.prepDone=(e.prepDone&&typeof e.prepDone==='object')?e.prepDone:{};
  e.prepMissed=(e.prepMissed&&typeof e.prepMissed==='object')?e.prepMissed:{};
  if(e.prepDone[key]) delete e.prepDone[key];
  else{ e.prepDone[key]=true; delete e.prepMissed[key]; }
  save({rerender:false});
  if($('#prepPlanDlg')?.open && activePrepPlanId===id) openPreparationPlan(id,activePrepPlanDate);
  else render();
}
function togglePreparationMissed(id,key){
  const e=state.events.find(x=>x.id===id && x.prepEnabled); if(!e || !key) return;
  e.prepMissed=(e.prepMissed&&typeof e.prepMissed==='object')?e.prepMissed:{};
  e.prepDone=(e.prepDone&&typeof e.prepDone==='object')?e.prepDone:{};
  const entry=preparationEntries(e).find(x=>x.key===key);
  if(e.prepMissed[key]){
    delete e.prepMissed[key];
    save({rerender:false});
    if($('#prepPlanDlg')?.open && activePrepPlanId===id) openPreparationPlan(id,activePrepPlanDate); else render();
    return;
  }
  e.prepMissed[key]=true;
  delete e.prepDone[key];
  pendingPrepMissed={id,key,date:entry?.date||'',text:String(entry?.text||'').trim()};
  save({rerender:false});
  if($('#prepPlanDlg')?.open && activePrepPlanId===id) openPreparationPlan(id,activePrepPlanDate);
  const label=[entry?.date,entry?.text].filter(Boolean).join(' · ');
  $('#prepMissedInfo').textContent=label?`${label} — 못함으로 기록했습니다.`:'못함으로 기록했습니다.';
  openDialog($('#prepMissedDlg'));
}
$('#prepMissedKeep').onclick=()=>{ pendingPrepMissed=null; closeDialog($('#prepMissedDlg')); render(); };
$('#prepMissedEditFuture').onclick=()=>{
  const p=pendingPrepMissed; pendingPrepMissed=null;
  closeDialog($('#prepMissedDlg')); closeDialog($('#prepPlanDlg'));
  if(!p?.id){ render(); return; }
  openEvent(null,p.id,{prepFocusDate:p.date||''});
};
function movePreparationEntry(id,key,newDate,sourceDate='',type='',ruleId=''){
  const e=state.events.find(x=>x.id===id && x.prepEnabled); if(!e || !key || !newDate) return;
  const current=preparationEntries(e).find(x=>x.key===key);
  if(current?.date===newDate) return;
  if(e.prepDeadline && newDate>e.prepDeadline){ alert('준비일정은 마감일 이후로 옮길 수 없습니다.'); return; }
  const entryType=type||current?.type||'';
  const rid=ruleId||current?.ruleId||'';
  if(entryType==='date' && rid){
    const task=(e.prepTasks||[]).find(x=>String(x.id)===String(rid));
    if(task){ task.date=newDate; }
    if(e.prepMoves) delete e.prepMoves[key];
  }else{
    const original=sourceDate||current?.sourceDate||'';
    e.prepMoves=(e.prepMoves&&typeof e.prepMoves==='object')?e.prepMoves:{};
    if(original && newDate===original) delete e.prepMoves[key]; else e.prepMoves[key]=newDate;
  }
  save();
}

function moveEventToDate(id,newDate,occurrence='',sourceDay=''){
  const e=state.events.find(x=>x.id===id); if(!e) return;
  if(sourceDay && sourceDay===newDate) return;
  const span=Math.max(0,diffDays(e.date,e.endDate||e.date));
  if((e.repeat||'none')==='none'){
    const oldDate=e.date; e.date=newDate; e.endDate=ds(add(parse(newDate),span));
    if(e.orderByDate){ delete e.orderByDate[oldDate]; delete e.orderByDate[newDate]; }
    if(e.checklistDoneByDate?.[oldDate]){ e.checklistDoneByDate[newDate]=e.checklistDoneByDate[oldDate]; delete e.checklistDoneByDate[oldDate]; }
    save(); return;
  }
  const occ=occurrence||e.date;
  pendingRepeatMove={id:e.id,newDate,occ,sourceDay};
  const delta=diffDays(occ,newDate);
  const dir=delta>0?`${delta}일 뒤로`:delta<0?`${Math.abs(delta)}일 앞으로`:'같은 날짜로';
  $('#repeatMoveInfo').textContent=`${occ} 일정을 ${newDate}(으)로 ${dir} 이동합니다. 적용 범위를 선택하세요.`;
  openDialog($('#repeatMoveDlg'));
}
$('#moveOccurrenceOnly').onclick=()=>{
  const p=pendingRepeatMove, e=p&&state.events.find(x=>x.id===p.id); if(!p||!e) return;
  moveRecurringOccurrenceOnly(e,p.newDate,p.occ); finishRepeatMove();
};
$('#moveFutureSeries').onclick=()=>{
  const p=pendingRepeatMove, e=p&&state.events.find(x=>x.id===p.id); if(!p||!e) return;
  moveRecurringFuture(e,p.newDate,p.occ); finishRepeatMove();
};
$('#moveWholeSeries').onclick=()=>{
  const p=pendingRepeatMove, e=p&&state.events.find(x=>x.id===p.id); if(!p||!e) return;
  moveRecurringWholeSeries(e,p.newDate,p.occ); finishRepeatMove();
};
$('#cancelRepeatMove').onclick=()=>{ pendingRepeatMove=null; closeDialog($('#repeatMoveDlg')); render(); };

function toggleImportant(id){
  const e=state.events.find(x=>x.id===id); if(!e) return;
  e.important=!e.important;
  save();
}
function toggleSubtask(id,occ,subtaskId){
  const e=state.events.find(x=>x.id===id); if(!e) return;
  const items=checklistItems(e); if(!items.some(x=>String(x.id)===String(subtaskId))) return;
  const key=occ||e.date;
  e.checklistDoneByDate=(e.checklistDoneByDate&&typeof e.checklistDoneByDate==='object')?e.checklistDoneByDate:{};
  const set=new Set(Array.isArray(e.checklistDoneByDate[key])?e.checklistDoneByDate[key].map(String):[]);
  set.has(String(subtaskId))?set.delete(String(subtaskId)):set.add(String(subtaskId));
  if(set.size) e.checklistDoneByDate[key]=[...set]; else delete e.checklistDoneByDate[key];
  syncDoneFromChecklist(e,key);
  save();
}
function toggleDone(id,occ){
  const e=state.events.find(x=>x.id===id); if(!e) return;
  const list=checklistItems(e);
  if(e.kind!=='payment' && list.length){
    const key=occ||e.date, currentlyDone=isDone({...e,_occurrenceStart:key});
    e.checklistDoneByDate=(e.checklistDoneByDate&&typeof e.checklistDoneByDate==='object')?e.checklistDoneByDate:{};
    if(currentlyDone) delete e.checklistDoneByDate[key];
    else e.checklistDoneByDate[key]=list.map(x=>String(x.id));
    setOccurrenceDoneState(e,key,!currentlyDone);
    save();
    return;
  }
  if((e.repeat||'none')==='none') e.done=!e.done;
  else {
    e.doneDates=Array.isArray(e.doneDates)?e.doneDates:[];
    const set=new Set(e.doneDates);
    set.has(occ)?set.delete(occ):set.add(occ);
    e.doneDates=[...set].sort();
  }
  save();
}


const LANE_MIN_HEIGHT=40;
const LANE_HEIGHT_DEFAULTS={common:72,prep:84,quick:64,payment:64,calendar:112};
function laneHeight(key,type='calendar'){
  state.settings.laneHeights=state.settings.laneHeights||{};
  const stored=Number(state.settings.laneHeights[key]);
  return stored?Math.max(LANE_MIN_HEIGHT,Math.min(2400,stored)):(LANE_HEIGHT_DEFAULTS[type]||112);
}
function laneIsCollapsed(key){
  state.settings.laneCollapsed=state.settings.laneCollapsed||{};
  return !!state.settings.laneCollapsed[key];
}
function laneCalendarMembers(root,visibleIds){
  return [root,...descendants(root.id)].filter(c=>visibleIds.has(c.id));
}
function laneCellCommonHtml(es){
  const xs=(es||[]).filter(e=>!isPreparationManagedItem(e)&&(e.kind==='anniversary'||e.kind==='appointment'));
  return xs.map(e=>eventItemHtml(e,false)).join('');
}
function laneCellPrepHtml(es){ return (es||[]).filter(e=>isPreparationLaneItem(e)).map(e=>eventItemHtml(e,false)).join(''); }
function laneCellQuickHtml(es){ const xs=(es||[]).filter(e=>!isPreparationManagedItem(e)&&e.kind==='todo'); return calendarGroupedItemsHtml(xs,false); }
function laneCellPaymentHtml(es){ return (es||[]).filter(e=>!isPreparationManagedItem(e)&&e.kind==='payment').map(e=>eventItemHtml(e,false)).join(''); }
function laneOrderedItemsHtml(events,rootId){
  let previousSubCalId='';
  return (events||[]).map(e=>{
    const c=cal(e.calId), isSub=e.calId!==rootId;
    const showSubTag=isSub && e.calId!==previousSubCalId;
    previousSubCalId=isSub?e.calId:'';
    return `<div class="laneOrderedItem ${isSub?'laneOrderedSubItem':'laneOrderedRootItem'} ${isSub&&!showSubTag?'sameSubCalendarContinuation':''}" data-lane-cal-id="${esc(e.calId)}" title="${esc(calendarPath(e.calId))}">${showSubTag?`<span class="laneInlineCalTag" style="--tag-color:${esc(c.color)}">↳ ${esc(c.name)}</span>`:''}${eventItemHtml(e,false)}</div>`;
  }).join('');
}
function rootLaneCellHtml(date,root,es,visibleIds){
  const members=laneCalendarMembers(root,visibleIds), memberIds=new Set(members.map(c=>c.id));
  const normal=(es||[]).filter(e=>!isPreparationManagedItem(e) && memberIds.has(e.calId) && !['anniversary','appointment','todo','payment'].includes(e.kind));
  const allForLoad=(es||[]).filter(e=>memberIds.has(e.calId) && !isPreparationManagedItem(e) && !['anniversary','payment'].includes(e.kind));
  const sum=allForLoad.reduce((a,e)=>a+workloadDuration(e),0), cap=capacityForDate(root,date);
  let body='';
  body=laneOrderedItemsHtml(normal,root.id);
  const capText=cap.unknown?`${fmtH(sum)} / 미정`:`${fmtH(sum)} / ${fmtH(cap.hours)}`;
  const cls=cap.unknown?'unknown':(Number(cap.hours)>0&&sum>Number(cap.hours)?'over':'ok');
  return `<div class="laneCellLoad ${cls}" title="${esc(root.name)} 가용시간">${capText}${cap.blocked?' · 차단':''}</div>${body}`;
}
function daySummaryHtml(date,es){
  const visible=displayCals(), visibleIds=new Set(visible.map(c=>c.id));
  let total=0,totalCap=0,unknown=false,blocked=0;
  for(const root of topLevelCals()){
    const members=laneCalendarMembers(root,visibleIds); if(!members.length) continue;
    const ids=new Set(members.map(c=>c.id));
    total+=(es||[]).filter(e=>ids.has(e.calId)&&!isPreparationManagedItem(e)&&!['anniversary','payment'].includes(e.kind)).reduce((a,e)=>a+workloadDuration(e),0);
    const ci=capacityForDate(root,date); if(ci.blocked) blocked++; if(ci.unknown) unknown=true; else totalCap+=Number(ci.hours)||0;
  }
  const txt=unknown?`총 ${fmtH(total)} · 일부 미정`:(totalCap?`총 ${fmtH(total)} / ${fmtH(totalCap)}`:`총 ${fmtH(total)}`);
  return `<span class="${!unknown&&totalCap&&total>totalCap?'over':'ok'}">${txt}${blocked?` · 차단 ${blocked}`:''}</span>`;
}
function laneLabelWidth(){
  state.settings=state.settings||{};
  const raw=Number(state.settings.laneLabelWidth);
  // v2.16: 세로 라벨 시절의 22~30px 저장값은 가로 이름에 너무 좁으므로
  // 한 번에 읽기 좋은 기본 폭으로 승계한다. 이후에는 사용자가 직접 너비를 조절한다.
  return raw>=48 ? Math.max(48,Math.min(180,raw)) : 72;
}
function laneVerticalTitleHtml(text){
  // 이름 영역 너비를 직접 조절할 수 있으므로 구역명은 한 줄 가로 표기로 단순화한다.
  return esc(String(text||''));
}
function scheduleLaneHtml(key,title,days,map,cellBuilder,{type='calendar',color='#d9d9d9',subtitle=''}={}){
  const collapsed=laneIsCollapsed(key), h=laneHeight(key,type);
  const cells=days.map(d=>{ const date=ds(d); return `<div class="scheduleLaneCell" data-dropdate="${date}">${cellBuilder(date,map[date]||[])}</div>`; }).join('');
  return `<section class="scheduleLane ${collapsed?'collapsed':''}" data-lane-key="${esc(key)}" style="--lane-h:${h}px;--lane-color:${esc(color)}">
    <aside class="scheduleLaneSide" style="--lane-color:${esc(color)}">
      <button type="button" class="scheduleLaneToggle" data-lane-toggle="${esc(key)}" title="구역 접기/펴기">
        <span class="scheduleLaneDot" style="background:${esc(color)}"></span>
        <span class="scheduleLaneName"><b aria-label="${esc(title)}">${laneVerticalTitleHtml(title)}</b>${subtitle?`<small>${esc(subtitle)}</small>`:''}</span>
      </button>
    </aside>
    <div class="scheduleLaneGrid">${cells}</div>
    <div class="laneHeightResizer" data-lane-resize="${esc(key)}" title="마우스로 드래그해 구역 높이 조절 · 더블클릭 기본높이"></div>
  </section>`;
}
function scheduleDateHeader(days){
  // 날짜 헤더 전체도 드롭 영역으로 사용합니다. 요일 헤더 경계는 PC에서 열 너비 조절 손잡이로 사용합니다.
  return `<div class="scheduleDateGrid"><div class="scheduleDateCorner"></div>${days.map((d,i)=>{const key=ds(d),hasDiary=!!state.diary[key]?.text,h=holidayLabel(key),dow=d.getDay(),dmark=selectedDdayMarkerHtml(key),dayClass=[key===ds(new Date())?'today':'',holidayClass(key),dow===0?'sunday':'',dow===6?'saturday':'',dmark?'ddayTracked':''].filter(Boolean).join(' ');return `<div class="scheduleDateHead ${dayClass}" data-weekday-index="${i}" data-dropdate="${key}" data-date-drop-head="1" title="${key} · 일정을 여기에 놓아 이동"><div class="dayTopLine compactDateTop"><span class="dateHeadLeft">${dmark}</span><span class="dateHeadCenter"><span class="dateNum">${d.getDate()}</span><span class="weekdayLabel">${['일','월','화','수','목','금','토'][dow]}</span></span><span class="dateHeadRight">${h?`<span class="holidayName" title="${esc(h)}">${esc(h)}</span>`:''}<button type="button" class="diaryBtn ${hasDiary?'hasDiary':''}" data-diarydate="${key}" title="${hasDiary?'다이어리 보기 · 작성됨':'다이어리 작성 · 미작성'}" aria-label="${hasDiary?'다이어리 작성됨':'다이어리 미작성'}">${diaryIconHtml(hasDiary)}</button></span></div><span class="weekdayWidthHandle" data-weekday-resize="${i}" title="좌우로 드래그해 이 요일만 너비 조절 · 더블클릭하면 전체 기본 너비로 초기화"></span></div>`}).join('')}</div>`;
}
function scheduleWeekBoard(days,map){
  const visible=displayCals(),visibleIds=new Set(visible.map(c=>c.id));
  const filtering=calendarFocusIds.size>0;
  const allEvents=Object.values(map).flat();
  const hasPrep=allEvents.some(e=>isPreparationLaneItem(e));
  const hasQuick=allEvents.some(e=>!isPreparationManagedItem(e)&&e.kind==='todo');
  const hasPayment=allEvents.some(e=>!isPreparationManagedItem(e)&&e.kind==='payment');
  let html=`<div class="scheduleBoard"><div class="laneLabelWidthResizer" data-lane-label-resize="1" title="좌우로 드래그해 캘린더 이름 영역 너비 조절 · 더블클릭 기본너비"></div>${scheduleDateHeader(days)}`;
  // 공통 일정은 캘린더 필터와 무관하게 항상 유지한다.
  html+=scheduleLaneHtml('common','공통일정',days,map,(date,es)=>laneCellCommonHtml(es),{type:'common',color:'#d9b5cc'});
  if(!filtering||hasPrep) html+=scheduleLaneHtml('prep','준비일정',days,map,(date,es)=>laneCellPrepHtml(es),{type:'prep',color:'#b8c8ef'});
  if(!filtering||hasQuick) html+=scheduleLaneHtml('quick','Quick',days,map,(date,es)=>laneCellQuickHtml(es),{type:'quick',color:'#cfd5dc'});
  if(!filtering||hasPayment) html+=scheduleLaneHtml('payment','납부',days,map,(date,es)=>laneCellPaymentHtml(es),{type:'payment',color:'#e6d399'});
  for(const root of topLevelCals()){
    const members=laneCalendarMembers(root,visibleIds); if(!members.length) continue;
    const subNames=members.filter(c=>c.id!==root.id).map(c=>c.name);
    const singleChildOnly=!visibleIds.has(root.id)&&members.length===1;
    const laneTitle=singleChildOnly?members[0].name:root.name;
    const laneTargetId=singleChildOnly?members[0].id:root.id;
    html+=scheduleLaneHtml(`cal:${laneTargetId}`,laneTitle,days,map,(date,es)=>rootLaneCellHtml(date,root,es,visibleIds),{type:'calendar',color:singleChildOnly?members[0].color:root.color,subtitle:filtering?'':(subNames.length?`부속 ${subNames.length}`:root.period)});
  }
  html+=`<div class="scheduleSummaryGrid"><div class="scheduleSummaryLabel">합계</div>${days.map(d=>{const date=ds(d);return `<div class="scheduleSummaryCell">${daySummaryHtml(date,map[date]||[])}</div>`}).join('')}</div></div>`;
  return html;
}
function openEventForSection(date,key){
  const laneKey=String(key||'');
  if(laneKey==='common') return openEvent(date,null,{preset:'common'});
  if(laneKey==='prep'){ alert('준비일정은 연결할 마감 일정의 수정 화면에서 추가해 주세요.'); return; }
  if(laneKey==='quick') return openEvent(date,null,{preset:'quick'});
  if(laneKey==='payment') return openEvent(date,null,{preset:'payment'});
  if(laneKey.startsWith('cal:')){
    const calId=laneKey.slice(4);
    return openEvent(date,null,{preset:'event',calId});
  }
  return openEvent(date);
}
function isBlankSectionDoubleClickTarget(target){
  return !target?.closest?.('.item,button,input,select,textarea,a,.dragHandle,.laneHeightResizer,.dayLaneHeightResizer');
}
function naturalStackHeight(el){
  if(!el) return 0;
  const cs=getComputedStyle(el);
  let total=(parseFloat(cs.paddingTop)||0)+(parseFloat(cs.paddingBottom)||0);
  const children=[...el.children].filter(ch=>{
    const st=getComputedStyle(ch);
    return st.display!=='none' && st.position!=='absolute' && st.position!=='fixed';
  });
  for(const ch of children){
    const st=getComputedStyle(ch);
    total+=ch.getBoundingClientRect().height+(parseFloat(st.marginTop)||0)+(parseFloat(st.marginBottom)||0);
  }
  return Math.ceil(total);
}
function measureLaneCellContentHeight(cell){
  if(!cell) return 0;
  // 현재 레인 높이(scrollHeight)를 출발점으로 쓰면 빈 칸도 그 높이만큼 필요하다고
  // 오판해서 자동맞춤 최소높이가 사실상 고정된다. 직접 자식의 자연 높이와 실제
  // 렌더된 마지막 요소 위치만 측정해 '내용 자체'가 필요한 높이만 계산한다.
  const cs=getComputedStyle(cell);
  const padBottom=parseFloat(cs.paddingBottom)||0;
  const rect=cell.getBoundingClientRect();
  let need=naturalStackHeight(cell);
  const rendered=[...cell.querySelectorAll('.quickCalLabel,.laneCellLoad,.laneInlineCalTag,.item')].filter(el=>{
    const st=getComputedStyle(el);
    return st.display!=='none' && st.visibility!=='hidden' && st.position!=='absolute' && st.position!=='fixed';
  });
  for(const el of rendered){
    const er=el.getBoundingClientRect();
    const st=getComputedStyle(el);
    const mb=parseFloat(st.marginBottom)||0;
    need=Math.max(need, er.bottom-rect.top+mb+padBottom);
  }
  return Math.ceil(need);
}
function measureLaneSideNaturalHeight(side){
  const toggle=side?.querySelector('.scheduleLaneToggle'); if(!toggle) return 0;
  const cs=getComputedStyle(toggle);
  let total=(parseFloat(cs.paddingTop)||0)+(parseFloat(cs.paddingBottom)||0);
  const gap=parseFloat(cs.rowGap||cs.gap)||0;
  const pieces=[];
  const dot=toggle.querySelector('.scheduleLaneDot');
  if(dot) pieces.push(Math.ceil(dot.getBoundingClientRect().height||0));
  const chars=[...toggle.querySelectorAll('.laneTitleChar')].filter(ch=>getComputedStyle(ch).display!=='none');
  if(chars.length) pieces.push(Math.ceil(chars.reduce((a,ch)=>a+Math.max(ch.getBoundingClientRect().height,ch.scrollHeight||0),0)));
  else{
    const name=toggle.querySelector('.scheduleLaneName');
    if(name) pieces.push(Math.ceil(Math.max(name.scrollHeight||0,name.getBoundingClientRect().height||0)));
  }
  const arrow=toggle.querySelector('.scheduleLaneArrow');
  if(arrow) pieces.push(Math.ceil(arrow.getBoundingClientRect().height||0));
  if(pieces.length) total+=pieces.reduce((a,b)=>a+b,0)+gap*Math.max(0,pieces.length-1);
  return Math.ceil(total);
}
function fitAllScheduleLaneHeights(){
  if(isMobileSchedule()) return;
  const lanes=$$('.scheduleLane').filter(lane=>!lane.classList.contains('collapsed'));
  if(!lanes.length) return;
  state.settings.laneHeights=state.settings.laneHeights||{};
  lanes.forEach(lane=>{
    const key=lane.dataset.laneKey||'';
    const cells=[...lane.querySelectorAll('.scheduleLaneCell')];
    const side=lane.querySelector('.scheduleLaneSide');
    const grid=lane.querySelector('.scheduleLaneGrid');
    if(!grid||!cells.length) return;
    // v2.63: 측정할 때 기존 고정높이 및 내부 스크롤의 영향을 완전히 제거한다.
    // 스크롤된 칸의 getBoundingClientRect() 좌표만으로 계산하면 실제 내용이 잘린다.
    const elements=[grid,...cells];
    const saved=elements.map(el=>({el,style:el.getAttribute('style')}));
    const sideTransition=side?.style.transition||'';
    try{
      grid.style.setProperty('transition','none','important');
      grid.style.setProperty('height','auto','important');
      grid.style.setProperty('min-height','0px','important');
      cells.forEach(cell=>{
        cell.scrollTop=0;
        cell.style.setProperty('height','auto','important');
        cell.style.setProperty('min-height','0px','important');
        cell.style.setProperty('overflow-y','visible','important');
      });
      void grid.offsetHeight;
      const need=Math.max(0,...cells.map(cell=>{
        const cs=getComputedStyle(cell);
        const border=(parseFloat(cs.borderTopWidth)||0)+(parseFloat(cs.borderBottomWidth)||0);
        return measureLaneCellContentHeight(cell)+border;
      }));
      // 여유 높이를 추가해 소수점 반올림, 글꼴 렌더링에 따른 스크롤을 막는다.
      const h=Math.max(LANE_MIN_HEIGHT,Math.min(2400,Math.ceil(need+4)));
      state.settings.laneHeights[key]=h;
    }finally{
      saved.forEach(({el,style})=>{
        if(style===null) el.removeAttribute('style');
        else el.setAttribute('style',style);
      });
      lane.style.setProperty('--lane-h',`${state.settings.laneHeights[key]||LANE_MIN_HEIGHT}px`);
      if(side){
        if(sideTransition) side.style.transition=sideTransition;
        else side.style.removeProperty('transition');
      }
    }
  });
  // 실제 크기로 한 번 더 검사해 숨은 내용이 남은 칸은 추가 보정한다.
  void document.body.offsetHeight;
  lanes.forEach(lane=>{
    const grid=lane.querySelector('.scheduleLaneGrid');
    if(!grid) return;
    const key=lane.dataset.laneKey||'';
    const excess=Math.max(0,...[...lane.querySelectorAll('.scheduleLaneCell')].map(cell=>cell.scrollHeight-cell.clientHeight));
    if(excess>1){
      const h=Math.min(2400,(state.settings.laneHeights[key]||LANE_MIN_HEIGHT)+Math.ceil(excess)+8);
      state.settings.laneHeights[key]=h;
      lane.style.setProperty('--lane-h',`${h}px`);
    }
  });
  save({rerender:false});
}
function runScheduleAutoFitAfterLayout(){
  const run=()=>fitAllScheduleLaneHeights();
  requestAnimationFrame(()=>requestAnimationFrame(()=>{ run(); setTimeout(run,90); setTimeout(run,220); }));
}


function bindScheduleLanes(){
  const main=$('#main');
  if(main) main.style.setProperty('--lane-label-w-user',`${laneLabelWidth()}px`);
  $('[data-auto-fit-lanes]')?.addEventListener('click',e=>{ e.preventDefault(); e.stopPropagation(); fitAllScheduleLaneHeights(); });
  $$('.scheduleLaneCell').forEach(cell=>{
    cell.ondblclick=e=>{
      if(!isBlankSectionDoubleClickTarget(e.target)) return;
      e.preventDefault(); e.stopPropagation();
      const date=cell.dataset.dropdate||ds(cursor);
      const key=cell.closest('.scheduleLane')?.dataset.laneKey||'';
      openEventForSection(date,key);
    };
  });
  $$('[data-lane-label-resize]').forEach(handle=>{
    handle.ondblclick=e=>{ e.preventDefault(); e.stopPropagation(); state.settings.laneLabelWidth=72; if(main) main.style.setProperty('--lane-label-w-user','72px'); save(); };
    handle.onpointerdown=e=>{
      if(window.matchMedia('(max-width:760px)').matches) return;
      e.preventDefault(); e.stopPropagation();
      const startX=e.clientX, startW=laneLabelWidth();
      handle.setPointerCapture?.(e.pointerId); document.body.classList.add('resizingLaneLabel');
      const move=ev=>{ const w=Math.max(48,Math.min(180,startW+(ev.clientX-startX))); if(main) main.style.setProperty('--lane-label-w-user',`${Math.round(w)}px`); };
      const up=ev=>{ document.removeEventListener('pointermove',move); document.removeEventListener('pointerup',up); document.body.classList.remove('resizingLaneLabel'); const raw=parseFloat(getComputedStyle(main).getPropertyValue('--lane-label-w-user'))||startW; state.settings.laneLabelWidth=Math.max(48,Math.min(180,Math.round(raw))); save(); };
      document.addEventListener('pointermove',move); document.addEventListener('pointerup',up,{once:true});
    };
  });
  $$('[data-lane-toggle]').forEach(btn=>btn.onclick=e=>{
    e.stopPropagation(); const key=btn.dataset.laneToggle; state.settings.laneCollapsed=state.settings.laneCollapsed||{}; state.settings.laneCollapsed[key]=!state.settings.laneCollapsed[key]; save();
  });
  $$('[data-lane-resize]').forEach(handle=>{
    handle.ondblclick=e=>{ e.preventDefault(); const key=handle.dataset.laneResize; const type=key==='common'?'common':key==='prep'?'prep':key==='quick'?'quick':key==='payment'?'payment':'calendar'; state.settings.laneHeights=state.settings.laneHeights||{}; fitAllScheduleLaneHeights(); };
    handle.onpointerdown=e=>{
      if(window.matchMedia('(max-width:760px)').matches) return;
      e.preventDefault(); e.stopPropagation();
      const lane=handle.closest('.scheduleLane'), key=handle.dataset.laneResize; if(!lane) return;
      const grid=lane.querySelector('.scheduleLaneGrid');
      const startY=e.clientY,startH=Math.max(LANE_MIN_HEIGHT,Math.round(grid?.getBoundingClientRect().height||laneHeight(key)));
      handle.setPointerCapture?.(e.pointerId); document.body.classList.add('resizingLane');
      const move=ev=>{ const h=Math.max(LANE_MIN_HEIGHT,Math.min(480,startH+(ev.clientY-startY))); lane.style.setProperty('--lane-h',`${Math.round(h)}px`); };
      const up=ev=>{ document.removeEventListener('pointermove',move); document.removeEventListener('pointerup',up); document.body.classList.remove('resizingLane'); const grid=lane.querySelector('.scheduleLaneGrid'); const h=Math.max(LANE_MIN_HEIGHT,Math.min(480,Math.round(grid?.getBoundingClientRect().height||startH))); state.settings.laneHeights=state.settings.laneHeights||{}; state.settings.laneHeights[key]=h; save(); };
      document.addEventListener('pointermove',move); document.addEventListener('pointerup',up,{once:true});
    };
  });
}

function isMobileSchedule(){ return window.matchMedia('(max-width:760px)').matches; }
function mobileSectionIsCollapsed(key){
  state.settings.mobileSectionsCollapsed=state.settings.mobileSectionsCollapsed||{};
  return !!state.settings.mobileSectionsCollapsed[key];
}
function mobileDayWorkStats(date,es){
  const visible=displayCals(), visibleIds=new Set(visible.map(c=>c.id));
  let total=0,totalCap=0,unknown=false,blocked=0;
  for(const root of topLevelCals()){
    const members=laneCalendarMembers(root,visibleIds); if(!members.length) continue;
    const ids=new Set(members.map(c=>c.id));
    total+=(es||[]).filter(e=>ids.has(e.calId)&&!isPreparationManagedItem(e)&&!['anniversary','payment'].includes(e.kind)).reduce((a,e)=>a+workloadDuration(e),0);
    const ci=capacityForDate(root,date); if(ci.blocked) blocked++; if(ci.unknown) unknown=true; else totalCap+=Number(ci.hours)||0;
  }
  return {total,totalCap,unknown,blocked};
}
function mobileDayDotsHtml(es){
  const colors=[];
  for(const e of (es||[])){
    const color=cal(e.calId).color||'#bbb';
    if(!colors.includes(color)) colors.push(color);
    if(colors.length>=4) break;
  }
  return colors.map(c=>`<i style="background:${esc(c)}"></i>`).join('');
}
function mobileWeekStripHtml(days,map){
  return `<div class="mobileWeekStripWrap"><div class="mobileWeekStrip" style="--mobile-day-count:${days.length}">${days.map(d=>{
    const key=ds(d), es=map[key]||[], st=mobileDayWorkStats(key,es), dow=d.getDay(), h=holidayLabel(key), hasDiary=!!state.diary[key]?.text, dmark=selectedDdayMarkerHtml(key,'mobileDdayOffset');
    const cls=[key===mobileSelectedDate?'selected':'',key===ds(new Date())?'today':'',dow===0?'sunday':'',dow===6?'saturday':'',h?'holiday':'',hasDiary?'hasDiary':'',dmark?'ddayTracked':''].filter(Boolean).join(' ');
    return `<button type="button" class="mobileDayTab ${cls}" data-mobile-date="${key}" title="${esc([h,hasDiary?'다이어리 작성됨':'다이어리 미작성'].filter(Boolean).join(' · '))}"><b>${d.getDate()}</b><span class="mobileDayDow">${['일','월','화','수','목','금','토'][dow]}</span>${dmark}<small>${fmtH(st.total)}</small><span class="mobileDiaryState" aria-hidden="true">${diaryIconHtml(hasDiary)}</span><span class="mobileDayDots">${mobileDayDotsHtml(es)}</span></button>`;
  }).join('')}</div></div>`;
}
function mobileSectionHtml(key,title,color,body,meta=''){
  const collapsed=mobileSectionIsCollapsed(key);
  return `<section class="mobileAgendaSection ${collapsed?'collapsed':''}" data-mobile-section="${esc(key)}" style="--section-color:${esc(color)}"><button type="button" class="mobileAgendaHead" data-mobile-section-toggle="${esc(key)}"><span><i></i><b>${esc(title)}</b></span>${meta?`<small>${esc(meta)}</small>`:''}<em>${collapsed?'▸':'▾'}</em></button><div class="mobileAgendaBody">${body||'<div class="mobileAgendaEmpty">일정 없음</div>'}</div></section>`;
}
function mobileCommonBodyHtml(es){
  const dday=(es||[]).filter(e=>e.kind==='anniversary');
  const appt=(es||[]).filter(e=>e.kind==='appointment');
  let html='';
  if(dday.length) html+=`<div class="mobileSubLabel">D-Day · 기념일</div>${dday.map(e=>eventItemHtml(e,false)).join('')}`;
  if(appt.length) html+=`<div class="mobileSubLabel">예약 · 약속</div>${appt.map(e=>eventItemHtml(e,false)).join('')}`;
  return html;
}
function mobileRootSectionHtml(date,root,es,visibleIds){
  const members=laneCalendarMembers(root,visibleIds), ids=new Set(members.map(c=>c.id));
  const normal=(es||[]).filter(e=>!isPreparationManagedItem(e)&&ids.has(e.calId)&&!['anniversary','appointment','todo','payment'].includes(e.kind));
  const allForLoad=(es||[]).filter(e=>ids.has(e.calId)&&!isPreparationManagedItem(e)&&!['anniversary','payment'].includes(e.kind));
  const sum=allForLoad.reduce((a,e)=>a+workloadDuration(e),0), cap=capacityForDate(root,date);
  const meta=cap.unknown?`${fmtH(sum)} / 미정`:`${fmtH(sum)} / ${fmtH(cap.hours)}${cap.blocked?' · 차단':''}`;
  const singleChildOnly=!visibleIds.has(root.id)&&members.length===1;
  const displayCal=singleChildOnly?members[0]:root;
  const body=normal.map(e=>{
    const c=cal(e.calId), isSub=!singleChildOnly&&e.calId!==root.id;
    return `<div class="mobileCalendarEvent ${isSub?'sub':''}">${isSub?`<span class="mobileCalTag" style="--tag-color:${esc(c.color)}">↳ ${esc(c.name)}</span>`:''}${eventItemHtml(e,false)}</div>`;
  }).join('');
  return mobileSectionHtml(`cal:${displayCal.id}`,displayCal.name,displayCal.color,body,meta);
}
function renderMobileSchedule(days,map){
  const keys=days.map(ds);
  const today=ds(new Date());
  if(!mobileSelectedDate || !keys.includes(mobileSelectedDate)){
    mobileSelectedDate=keys.includes(today)?today:keys[Math.min(keys.length-1,Math.max(0,diffDays(ds(days[0]),ds(cursor))))];
  }
  const selected=mobileSelectedDate, d=parse(selected), es=map[selected]||[], h=holidayLabel(selected), hasDiary=!!state.diary[selected]?.text;
  const visible=displayCals(), visibleIds=new Set(visible.map(c=>c.id));
  const common=es.filter(e=>!isPreparationManagedItem(e)&&(e.kind==='anniversary'||e.kind==='appointment'));
  const prep=es.filter(e=>isPreparationLaneItem(e));
  const quick=es.filter(e=>!isPreparationManagedItem(e)&&e.kind==='todo');
  const payments=es.filter(e=>!isPreparationManagedItem(e)&&e.kind==='payment');
  const stats=mobileDayWorkStats(selected,es);
  const dayMeta=stats.unknown?`${fmtH(stats.total)} · 일부 미정`:(stats.totalCap?`${fmtH(stats.total)} / ${fmtH(stats.totalCap)}`:fmtH(stats.total));
  let sections='';
  sections+=mobileSectionHtml('common','공통 일정','#d9b5cc',mobileCommonBodyHtml(common),`${common.length}건`);
  if(!calendarFocusIds.size||prep.length) sections+=mobileSectionHtml('prep','준비일정','#b8c8ef',prep.map(e=>eventItemHtml(e,false)).join(''),`${prep.length}건`);
  if(!calendarFocusIds.size||quick.length) sections+=mobileSectionHtml('quick','Quick','#cfd5dc',calendarGroupedItemsHtml(quick,false),`${quick.length}건`);
  if(!calendarFocusIds.size||payments.length) sections+=mobileSectionHtml('payment','납부','#e6d399',payments.map(e=>eventItemHtml(e,false)).join(''),`${payments.length}건`);
  for(const root of topLevelCals()) if(laneCalendarMembers(root,visibleIds).length) sections+=mobileRootSectionHtml(selected,root,es,visibleIds);
  const dow=d.getDay();
  $('#main').className='mobileScheduleView';
  $('#main').innerHTML=`${mobileWeekStripHtml(days,map)}<div class="mobileSelectedDayHead"><div><b>${d.getMonth()+1}월 ${d.getDate()}일 ${['일','월','화','수','목','금','토'][dow]}요일</b>${h?`<small class="${holidayClass(selected)}">${esc(h)}</small>`:''}${selectedDdayMarkerHtml(selected,'mobileSelectedDday')}</div><span class="mobileDayTotal">${esc(dayMeta)}</span><button type="button" class="mobileDiaryBtn ${hasDiary?'hasDiary':''}" data-diarydate="${selected}" title="${hasDiary?'다이어리 보기 · 작성됨':'다이어리 작성 · 미작성'}" aria-label="${hasDiary?'다이어리 작성됨':'다이어리 미작성'}">${diaryIconHtml(hasDiary)}</button><button type="button" class="mobileAddEvent" data-mobile-add="${selected}" aria-label="일정 추가">＋</button></div><div class="mobileAgenda" data-mobile-day-detail="1">${sections}</div>`;
  bindItems();
  $$('.mobileDayTab').forEach(btn=>btn.onclick=()=>{ mobileSelectedDate=btn.dataset.mobileDate; render(); });
  $$('.mobileAgendaHead').forEach(btn=>btn.onclick=()=>{ const key=btn.dataset.mobileSectionToggle; state.settings.mobileSectionsCollapsed=state.settings.mobileSectionsCollapsed||{}; state.settings.mobileSectionsCollapsed[key]=!mobileSectionIsCollapsed(key); save(); });
  $('.mobileAddEvent')?.addEventListener('click',()=>openEvent(selected));
  $('.mobileDiaryBtn')?.addEventListener('click',()=>openDiary(selected));
  const detail=$('[data-mobile-day-detail]');
  if(detail){
    let sx=0,sy=0;
    detail.addEventListener('touchstart',e=>{ const t=e.touches?.[0]; if(t){sx=t.clientX;sy=t.clientY;} },{passive:true});
    detail.addEventListener('touchend',e=>{ const t=e.changedTouches?.[0]; if(!t) return; const dx=t.clientX-sx,dy=t.clientY-sy; if(Math.abs(dx)<65||Math.abs(dx)<=Math.abs(dy)*1.35) return; const i=keys.indexOf(mobileSelectedDate), ni=dx<0?i+1:i-1; if(ni>=0&&ni<keys.length){ mobileSelectedDate=keys[ni]; render(); } },{passive:true});
  }
  requestAnimationFrame(()=>{ const active=$('.mobileDayTab.selected'); active?.scrollIntoView({block:'nearest',inline:'center'}); });
}

function normalizedWeekdayWidths(){
  const raw=Array.isArray(state.settings?.weekdayWidths)?state.settings.weekdayWidths:[];
  const max=state.settings?.weekdayWidthMode==='px'?700:400;
  return Array.from({length:7},(_,i)=>Math.max(40,Math.min(max,Number(raw[i])||100)));
}
function weekdayGridTemplate(forceFit=false){
  const widths=normalizedWeekdayWidths();
  // v2.49: Keep individually customized weekday proportions but ALWAYS
  // distribute them across the available seven-day width. Pixel widths
  // smaller than the viewport previously left a blank strip after Sunday.
  return widths.map(v=>`minmax(0,${Math.max(1,v)}fr)`).join(' ');
}
function weekdayWidthShouldFit(main){
  // Weekday column weights still honor saved user adjustments.
  return true;
}
function applyWeekdayWidths(){
  const main=$('#main'); if(!main) return;
  if(window.matchMedia('(max-width:760px)').matches){
    main.style.removeProperty('--weekday-cols');
    main.style.removeProperty('--weekday-total');
    main.style.removeProperty('--weekday-board-total');
    main.classList.remove('weekdayFitMode','weekdayFixedMode');
    return;
  }
  main.classList.add('weekdayFitMode');
  main.classList.remove('weekdayFixedMode');
  main.style.setProperty('--weekday-cols',weekdayGridTemplate(true));
  main.style.setProperty('--weekday-total','100%');
  main.style.setProperty('--weekday-board-total','100%');
}

function bindWeekdayWidthResizers(){
  if(window.matchMedia('(max-width:760px)').matches) return;
  const main=$('#main'); if(!main) return;
  applyWeekdayWidths();
  const handles=[...main.querySelectorAll('[data-weekday-resize]')];
  handles.forEach(handle=>{
    handle.onpointerdown=e=>{
      if(e.button!==0) return;
      e.preventDefault(); e.stopPropagation();
      const idx=Number(handle.dataset.weekdayResize);
      if(!(idx>=0&&idx<7)) return;
      const heads=[...main.querySelectorAll('[data-weekday-index]')]
        .filter((el,pos,arr)=>arr.findIndex(x=>x.dataset.weekdayIndex===el.dataset.weekdayIndex)===pos)
        .sort((a,b)=>Number(a.dataset.weekdayIndex)-Number(b.dataset.weekdayIndex));
      if(heads.length<7) return;
      const widths=heads.map(h=>Math.max(56,h.getBoundingClientRect().width));
      const startX=e.clientX, min=56, max=700;
      // v2.26: 첫 드래그 순간 현재 보이는 7개 너비를 px로 고정한 뒤,
      // 선택한 요일 하나만 변경한다. 다른 요일은 절대 같이 줄어들지 않는다.
      state.settings.weekdayWidthMode='px';
      state.settings.weekdayWidths=widths.slice();
      state.settings.weekdayWidthReference=Math.max(0,main.clientWidth||0);
      document.body.classList.add('resizingWeekdayWidth');
      try{ handle.setPointerCapture(e.pointerId); }catch{}
      const move=ev=>{
        const dx=ev.clientX-startX;
        const next=widths.slice();
        next[idx]=Math.max(min,Math.min(max,widths[idx]+dx));
        state.settings.weekdayWidths=next;
        applyWeekdayWidths();
        if(main.classList.contains('multiCompactView')) scheduleMultiWeekCellFit();
      };
      const end=ev=>{
        handle.removeEventListener('pointermove',move); handle.removeEventListener('pointerup',end); handle.removeEventListener('pointercancel',end);
        document.body.classList.remove('resizingWeekdayWidth');
        try{ handle.releasePointerCapture(ev.pointerId); }catch{}
        save({rerender:false});
      };
      handle.addEventListener('pointermove',move);
      handle.addEventListener('pointerup',end);
      handle.addEventListener('pointercancel',end);
    };
    handle.ondblclick=e=>{
      e.preventDefault(); e.stopPropagation();
      state.settings.weekdayWidths=[100,100,100,100,100,100,100];
      state.settings.weekdayWidthMode='ratio';
      state.settings.weekdayWidthReference=0;
      applyWeekdayWidths();
      if(main.classList.contains('multiCompactView')) scheduleMultiWeekCellFit();
      save({rerender:false});
    };
  });
}

function renderWeek(){
  if(!isMobileSchedule() && state.settings?.weekViewMode==='compact'){ renderMultiWeek(1); return; }
  const s=startWeek(cursor), days=[0,1,2,3,4,5,6].map(i=>add(s,i)), map=buildOccurrenceMap(ds(s),ds(days[6]),{calendarIds:focusedCalendarIds()});
  setRangeLabel(`${s.getFullYear()}. ${s.getMonth()+1}. ${s.getDate()} - ${days[6].getFullYear()}. ${days[6].getMonth()+1}. ${days[6].getDate()}${focusSuffix()}`,`${s.getMonth()+1}/${s.getDate()}–${days[6].getMonth()+1}/${days[6].getDate()}${compactFocusSuffix()}`);
  if(isMobileSchedule()){ renderMobileSchedule(days,map); return; }
  $('#main').className='laneView weekLaneView';
  $('#main').innerHTML=scheduleWeekBoard(days,map);
  bindItems(); bindScheduleLanes(); bindWeekdayWidthResizers();
}
// v2.45: 월 칸의 실제 남는 높이에 따라 표시 개수 자동 결정.
function monthCellEventsHtml(date, es){
  const priority=e=>e.kind==='anniversary'?0:e.kind==='appointment'?1:e.kind==='todo'?2:e.kind==='payment'?3:4;
  const ordered=[...(es||[])].filter(e=>!isPreparationDeadlineDuplicate(e)).sort((a,b)=>priority(a)-priority(b));
  const common=ordered.filter(e=>!isPreparationManagedItem(e)&&(e.kind==='anniversary' || e.kind==='appointment'));
  const prep=ordered.filter(e=>isPreparationLaneItem(e));
  const quick=ordered.filter(e=>!isPreparationManagedItem(e)&&e.kind==='todo');
  const payments=ordered.filter(e=>!isPreparationManagedItem(e)&&e.kind==='payment');
  const normal=ordered.filter(e=>!isPreparationManagedItem(e)&&e.kind!=='payment' && e.kind!=='appointment' && e.kind!=='anniversary' && e.kind!=='todo');
  return `${commonTopLaneHtml(common,true)}${prepLaneHtml(prep,true)}${quickLaneHtml(quick,true)}${paymentLaneHtml(payments,true)}${normal.map(e=>eventItemHtml(e,true)).join('')}<button type="button" class="moreEventsBtn" data-more-date="${esc(date)}" hidden></button>`;
}
// 모든 카드를 배치한 뒤 실제 셀의 높이로 판단한다. 넘치는 경우에만 +N 표시.
function fitMonthCellEvents(){
  const root=$('#main');
  if(!root?.classList.contains('month')) return;
  for(const cell of root.querySelectorAll('.cell')){
    const more=cell.querySelector('.moreEventsBtn');
    if(!more) continue;
    const items=[...cell.querySelectorAll('.item')];
    const lanes=[...cell.querySelectorAll('.commonTopLane,.prepLane,.quickLane,.paymentLane,.quickCalGroup')];
    for(const item of items) item.style.removeProperty('display');
    for(const lane of lanes) lane.style.removeProperty('display');
    more.hidden=true;
    more.textContent='';
    if(!items.length) continue;
    const pad=parseFloat(getComputedStyle(cell).paddingBottom)||0;
    const bottom=cell.getBoundingClientRect().bottom;
    const last=items[items.length-1];
    if(last.getBoundingClientRect().bottom<=bottom-pad+0.5) continue;
    // 버튼 높이를 확보한 상태에서 마지막 일정부터 하나씩 접는다.
    more.hidden=false;
    const limit=bottom-Math.max(pad,more.getBoundingClientRect().height+7);
    let hidden=0;
    for(let i=items.length-1;i>=0;i--){
      if(lastVisibleMonthItemBottom(items)<=limit+0.5) break;
      items[i].style.display='none';
      hidden++;
      for(const lane of lanes.slice().reverse()){
        if(!lane.querySelector('.item:not([style*="display: none"])')) lane.style.display='none';
      }
    }
    more.textContent=`+ ${hidden}건`;
    more.hidden=hidden===0;
  }
}
function lastVisibleMonthItemBottom(items){
  for(let i=items.length-1;i>=0;i--){
    if(items[i].getClientRects().length) return items[i].getBoundingClientRect().bottom;
  }
  return -Infinity;
}
let monthFitFrame=0;
function scheduleMonthCellFit(){
  cancelAnimationFrame(monthFitFrame);
  monthFitFrame=requestAnimationFrame(()=>{fitMonthCellEvents();});
}
window.addEventListener('resize',scheduleMonthCellFit);
function openDayList(date){
  const map=buildOccurrenceMap(date,date,{calendarIds:focusedCalendarIds(),includeCommon:view!=='month'||!calendarFocusIds.size||state.settings.monthShowCommonWithFocus!==false});
  const h=holidayLabel(date);
  $('#dayListTitle').textContent=`${date}${h?` · ${h}`:''}`;
  $('#dayListBody').innerHTML=groupHtml(date,map[date]||[]);
  openDialog($('#dayListDlg')); bindItems();
}
$('#closeDayList').onclick=()=>closeDialog($('#dayListDlg'));

// v2.46: 주간 압축 보기에서도 영역 순서(공통→준비→Quick→납부→캘린더)를 유지한다.
// 같은 캘린더에 속하는 일반 일정은 사용자 설정 캘린더 순서대로 모아서 보여준다.
function orderedMultiWeekEvents(es){
  const events=(es||[]).filter(e=>!isPreparationDeadlineDuplicate(e));
  const calPositions=new Map(cals().map((c,i)=>[c.id,i]));
  const laneRank=e=>{
    if(!isPreparationManagedItem(e)&&(e.kind==='anniversary'||e.kind==='appointment')) return 0;
    if(isPreparationLaneItem(e)) return 1;
    if(!isPreparationManagedItem(e)&&e.kind==='todo') return 2;
    if(!isPreparationManagedItem(e)&&e.kind==='payment') return 3;
    return 4;
  };
  return events.map((e,index)=>({e,index,lane:laneRank(e)}))
    .sort((a,b)=>{
      if(a.lane!==b.lane) return a.lane-b.lane;
      // 영역 안에서는 캘린더 설정에서 저장한 순서(부속 캘린더 포함)를 따른다.
      if(a.lane===2||a.lane===3||a.lane===4){
        const ca=calPositions.get(a.e.calId)??99999;
        const cb=calPositions.get(b.e.calId)??99999;
        if(ca!==cb) return ca-cb;
      }
      // 같은 영역/캘린더 안에서 사용자가 지정한 순서를 훼손하지 않는다.
      return a.index-b.index;
    }).map(x=>x.e);
}
function multiWeekCellEventsHtml(date, es, weeks){
  const ordered=orderedMultiWeekEvents(es);
  // 실제 셀에 들어가는 일정 개수는 기존 자동 높이 계산을 그대로 사용한다.
  return `<div class="multiCompactEvents">${ordered.map(e=>eventItemHtml(e,true)).join('')}</div><button type="button" class="multiCompactMore" data-more-date="${esc(date)}" hidden></button>`;
}
function fitMultiWeekCellEvents(){
  const root=$('#main');
  if(!root || !root.classList.contains('multiCompactView')) return;
  root.querySelectorAll('.multiCompactCell').forEach(cell=>{
    const box=cell.querySelector('.multiCompactEvents');
    const more=cell.querySelector('.multiCompactMore');
    if(!box || !more) return;
    const items=[...box.children].filter(el=>el.classList.contains('item'));
    items.forEach(el=>{ el.style.display=''; });
    more.hidden=true;
    more.textContent='';
    if(!items.length) return;

    const cellRect=cell.getBoundingClientRect();
    const cs=getComputedStyle(cell);
    const padBottom=parseFloat(cs.paddingBottom)||0;
    const naturalBottom=cellRect.bottom-padBottom;
    const lastBottom=items[items.length-1].getBoundingClientRect().bottom;
    // 전부 들어가면 +N 없이 모두 표시한다.
    if(lastBottom<=naturalBottom+0.5) return;

    // 넘치는 경우에만 +N 버튼 자리를 남기고 실제로 들어가는 개수를 계산한다.
    const moreH=14;
    const fitBottom=cellRect.bottom-Math.max(padBottom,moreH+4);
    let visibleCount=0;
    for(const item of items){
      if(item.getBoundingClientRect().bottom<=fitBottom+0.5) visibleCount++;
      else break;
    }
    items.forEach((item,i)=>{ if(i>=visibleCount) item.style.display='none'; });
    const hiddenCount=Math.max(0,items.length-visibleCount);
    if(hiddenCount){
      more.textContent=`+${hiddenCount}`;
      more.hidden=false;
    }
  });
}
let multiWeekFitRaf=0;
function scheduleMultiWeekCellFit(){
  cancelAnimationFrame(multiWeekFitRaf);
  multiWeekFitRaf=requestAnimationFrame(fitMultiWeekCellEvents);
}
function renderMultiWeek(weeks=2){
  const s=startWeek(cursor), total=weeks*7, allDays=[...Array(total)].map((_,i)=>add(s,i)), map=buildOccurrenceMap(ds(s),ds(allDays[allDays.length-1]),{calendarIds:focusedCalendarIds()});
  const last=allDays[allDays.length-1];
  setRangeLabel(`${s.getFullYear()}. ${s.getMonth()+1}. ${s.getDate()} - ${last.getFullYear()}. ${last.getMonth()+1}. ${last.getDate()}${focusSuffix()}`,`${s.getMonth()+1}/${s.getDate()}–${last.getMonth()+1}/${last.getDate()}${compactFocusSuffix()}`);
  if(isMobileSchedule()){ renderMobileSchedule(allDays,map); return; }
  $('#main').className=`multiCompactView weeks${weeks}`;
  $('#main').style.setProperty('--multi-weeks',String(weeks));
  const heads=['월','화','수','목','금','토','일'].map((x,i)=>`<div class="multiCompactWeekday ${i===5?'saturday':i===6?'sunday':''}" data-weekday-index="${i}">${x}<span class="weekdayWidthHandle" data-weekday-resize="${i}" title="좌우로 드래그해 ${x}요일만 너비 조절 · 더블클릭하면 전체 기본 너비로 초기화"></span></div>`).join('');
  const today=ds(new Date());
  const cells=allDays.map(d=>{
    const key=ds(d), es=map[key]||[], h=holidayLabel(key), dow=d.getDay();
    const cls=[key===today?'today':'',holidayClass(key),dow===0?'sunday':'',dow===6?'saturday':''].filter(Boolean).join(' ');
    return `<div class="multiCompactCell ${cls}" data-dropdate="${key}" ondblclick="window.__newEvent?.('${key}')"><div class="multiCompactDate"><span class="multiCompactDatePair"><span>${d.getDate()}</span><small>${['일','월','화','수','목','금','토'][dow]}</small></span><b title="${h?esc(h):''}">${h?esc(h):''}</b></div>${selectedDdayMarkerHtml(key,'multiDdayOffset')}${multiWeekCellEventsHtml(key,es,weeks)}</div>`;
  }).join('');
  $('#main').innerHTML=heads+cells;
  bindItems();
  $$('.multiCompactMore').forEach(btn=>btn.onclick=e=>{e.stopPropagation();openDayList(btn.dataset.moreDate)});
  scheduleMultiWeekCellFit();
  bindWeekdayWidthResizers();
}
function updateMonthCommonToggle(){
  const label=$('#monthCommonToggleLabel'), box=$('#monthCommonToggle');
  if(!label||!box) return;
  label.hidden=(view!=='month');
  box.disabled=(calendarFocusIds.size===0);
  label.title=calendarFocusIds.size===0?'특정 캘린더를 선택하면 공통일정 표시를 선택할 수 있습니다.':'선택한 캘린더와 공통일정을 함께 표시합니다.';
  box.checked=state.settings.monthShowCommonWithFocus!==false;
}
$('#monthCommonToggle')?.addEventListener('change',e=>{
  state.settings.monthShowCommonWithFocus=!!e.target.checked;
  save();
});
function renderMonth(){
  const y=cursor.getFullYear(),m=cursor.getMonth(),first=new Date(y,m,1),s=startWeek(first);
  // 현재 달이 실제로 차지하는 주 수(4/5/6주)만 렌더링합니다.
  // 예: 2026년 10월은 9/28~11/1의 5주만 보여주고, 11/2~11/8은 불필요하므로 만들지 않습니다.
  const monthDays=new Date(y,m+1,0).getDate();
  const mondayOffset=(first.getDay()+6)%7;
  const weekCount=Math.ceil((mondayOffset+monthDays)/7);
  const totalCells=weekCount*7;
  const showPurchasesInMonth=!calendarFocusIds.size||focusedCalendarList().some(c=>c.name.trim()==='구매목록');
  const end=add(s,totalCells-1),map=buildOccurrenceMap(ds(s),ds(end),{calendarIds:focusedCalendarIds(),includeCommon:!calendarFocusIds.size||state.settings.monthShowCommonWithFocus!==false,includePurchases:showPurchasesInMonth});
  setRangeLabel(`${y}년 ${m+1}월${focusSuffix()}`,`${y}.${m+1}${compactFocusSuffix()}`);
  $('#main').className='month';
  $('#main').style.setProperty('--month-weeks',String(weekCount));
  const heads=['월','화','수','목','금','토','일'].map((x,i)=>`<div class="weekdayHeader ${i===5?'saturday':i===6?'sunday':''}" data-weekday-index="${i}">${x}<span class="weekdayWidthHandle" data-weekday-resize="${i}" title="좌우로 드래그해 ${x}요일만 너비 조절 · 더블클릭하면 전체 기본 너비로 초기화"></span></div>`).join('');
  const cells=[...Array(totalCells)].map((_,i)=>{
    const d=add(s,i),key=ds(d),es=map[key]||[],hasDiary=!!state.diary[key]?.text,h=holidayLabel(key),dow=d.getDay();
    const cellClass=[d.getMonth()!==m?'other':'',holidayClass(key),dow===0?'sunday':'',dow===6?'saturday':''].filter(Boolean).join(' ');
    const ddayMarker=selectedDdayMarkerHtml(key,'monthDdayOffset');
    // v2.36: 월간 상단은 1줄. D-day는 날짜 왼쪽, 공휴일과 일기는 오른쪽.
    return `<div class="cell ${cellClass}" data-dropdate="${key}" ondblclick="window.__newEvent?.('${key}')"><div class="mhead monthInlineDateHead"><div class="monthHeadLeft">${ddayMarker}</div><span class="monthDateGroup"><span class="monthDateNumber">${d.getDate()}</span><span class="monthDateDow">${['일','월','화','수','목','금','토'][dow]}</span></span><div class="monthHeadRight">${h?`<span class="holidayName monthInlineHoliday" title="${esc(h)}">${esc(h)}</span>`:''}<button type="button" class="diaryBtn ${hasDiary?'hasDiary':''}" data-diarydate="${key}" title="${hasDiary?'다이어리 보기 · 작성됨':'다이어리 작성 · 미작성'}" aria-label="${hasDiary?'다이어리 작성됨':'다이어리 미작성'}">${diaryIconHtml(hasDiary)}</button></div></div>${monthCellEventsHtml(key,es)}</div>`;
  }).join('');
  $('#main').innerHTML=heads+cells; bindItems(); bindWeekdayWidthResizers(); scheduleMonthCellFit();
}

const DAY_LANE_HEIGHT_DEFAULTS={common:112,prep:132,quick:112,payment:112,calendar:176};
function dayLaneHeight(key,type='calendar'){
  state.settings.dayLaneHeights=state.settings.dayLaneHeights||{};
  const stored=Number(state.settings.dayLaneHeights[key]);
  return stored?Math.max(52,Math.min(640,stored)):(DAY_LANE_HEIGHT_DEFAULTS[type]||176);
}
function dayResizableSectionHtml(key,innerHtml,{type='calendar',color='#d9d9d9'}={}){
  const h=dayLaneHeight(key,type);
  state.settings.dayLaneManual=state.settings.dayLaneManual||{};
  const manual=!!state.settings.dayLaneManual[key];
  return `<section class="dayResizableSection ${manual?'manualDayHeight':''}" data-day-lane-key="${esc(key)}" style="--day-lane-h:${h}px;--day-lane-color:${esc(color)}"><div class="dayResizableContent">${innerHtml}</div><div class="dayLaneHeightResizer" data-day-lane-resize="${esc(key)}" data-day-lane-type="${esc(type)}" title="위아래로 드래그해 구역 높이 조절 · 더블클릭 자동높이"><span></span></div></section>`;
}
function dayViewGroupHtml(date,es){
  const filtering=calendarFocusIds.size>0;
  const commonTopHtml=dayResizableSectionHtml('common',commonTopLaneHtml(es,false,true),{type:'common',color:'#d9b5cc'});
  const prepInner=prepLaneHtml(es,false,!filtering), quickInner=quickLaneHtml(es,false,!filtering), paymentInner=paymentLaneHtml(es,false,!filtering);
  const prepHtml=prepInner?dayResizableSectionHtml('prep',prepInner,{type:'prep',color:'#b8c8ef'}):'';
  const quickHtml=quickInner?dayResizableSectionHtml('quick',quickInner,{type:'quick',color:'#cfd5dc'}):'';
  const paymentHtml=paymentInner?dayResizableSectionHtml('payment',paymentInner,{type:'payment',color:'#e6d399'}):'';
  const appointmentEvents=(es||[]).filter(e=>e.kind==='appointment'&&!isPreparationManagedItem(e));
  const quickEvents=(es||[]).filter(e=>e.kind==='todo'&&!isPreparationManagedItem(e));
  const workEvents=(es||[]).filter(e=>!isPreparationManagedItem(e) && e.kind!=='payment' && e.kind!=='appointment' && e.kind!=='anniversary' && e.kind!=='todo');
  let html='';
  const visible=displayCals(), visibleIds=new Set(visible.map(c=>c.id));
  let total=appointmentEvents.reduce((sum,e)=>sum+workloadDuration(e),0) + quickEvents.reduce((sum,e)=>sum+workloadDuration(e),0), totalCapacity=0, hasUnknownCapacity=false, blockedRootCount=0;
  for(const root of topLevelCals()){
    const members=[root,...descendants(root.id)].filter(c=>visibleIds.has(c.id));
    if(!members.length) continue;
    const memberIds=new Set(members.map(c=>c.id));
    const groupEvents=workEvents.filter(e=>memberIds.has(e.calId));
    if(!groupEvents.length) continue;
    const rootSum=groupEvents.filter(e=>!isPreparationManagedItem(e)).reduce((sum,e)=>sum+workloadDuration(e),0);
    total+=rootSum;
    const rootCapInfo=capacityForDate(root,date);
    if(rootCapInfo.blocked) blockedRootCount++;
    if(rootCapInfo.unknown) hasUnknownCapacity=true; else totalCapacity+=rootCapInfo.hours;
    const singleChildOnly=!visibleIds.has(root.id)&&members.length===1;
    const displayCal=singleChildOnly?members[0]:root;
    const rootCollapsed=isDayCalCollapsed(date,displayCal.id);
    const blockedTitle=rootCapInfo.blocked?' · 가용시간 차단 일정 있음':'';
    let body=`<div class="group calendarTreeGroup ${rootCollapsed?'collapsed':''}" style="--group-color:${esc(displayCal.color)}"><div class="groupHead" style="background:${esc(displayCal.color)}55" title="${esc(displayCal.name)}${blockedTitle}">${dayCalHeadHtml(date,displayCal,rootSum,rootCapInfo.hours,rootCapInfo.unknown)}</div><div class="dayCalGroupBody laneMergedDayItems">`;
    body+=laneOrderedItemsHtml(groupEvents,displayCal.id);
    body+=`</div></div>`;
    html+=dayResizableSectionHtml(`cal:${displayCal.id}`,body,{type:'calendar',color:displayCal.color});
  }
  const overallOver=!hasUnknownCapacity && totalCapacity>0 && total>totalCapacity;
  let capacitySummary=hasUnknownCapacity
    ? `${totalCapacity?` · 확인된 가용 ${fmtH(totalCapacity)}`:''} · 일부 가용시간 미정`
    : (totalCapacity?` / 캘린더 가용 ${fmtH(totalCapacity)}`:'');
  if(blockedRootCount) capacitySummary+=` · 가용차단 ${blockedRootCount}개`;
  return commonTopHtml+prepHtml+quickHtml+paymentHtml+html+`<div class="dayTotal ${overallOver?'overallOver':''}">총 계획 ${fmtH(total)}${capacitySummary}</div>`;
}
function fitAllDayLaneHeights(){
  const sections=$$('.dayResizableSection');
  if(!sections.length) return;
  state.settings.dayLaneHeights=state.settings.dayLaneHeights||{};
  state.settings.dayLaneManual=state.settings.dayLaneManual||{};
  sections.forEach(section=>{
    const key=section.dataset.dayLaneKey||'';
    const content=section.querySelector('.dayResizableContent');
    const resizer=section.querySelector('.dayLaneHeightResizer');
    const resizerH=Math.ceil(resizer?.getBoundingClientRect().height||8);
    const natural=naturalStackHeight(content);
    const h=Math.max(52,Math.min(640,natural+resizerH+2));
    state.settings.dayLaneHeights[key]=h;
    state.settings.dayLaneManual[key]=true;
    section.classList.add('manualDayHeight');
    section.style.setProperty('--day-lane-h',`${h}px`);
  });
  save({rerender:false});
}


function bindDayViewResizers(){
  $('[data-auto-fit-day-lanes]')?.addEventListener('click',e=>{ e.preventDefault(); e.stopPropagation(); fitAllDayLaneHeights(); });
  $$('.dayResizableSection').forEach(section=>{
    section.ondblclick=e=>{
      if(!isBlankSectionDoubleClickTarget(e.target)) return;
      e.preventDefault(); e.stopPropagation();
      const date=section.closest('.dayResizableBoard')?.dataset.dropdate||ds(cursor);
      const key=section.dataset.dayLaneKey||'';
      openEventForSection(date,key);
    };
  });
  $$('[data-day-lane-resize]').forEach(handle=>{
    handle.ondblclick=e=>{
      e.preventDefault(); e.stopPropagation();
      const key=handle.dataset.dayLaneResize;
      state.settings.dayLaneHeights=state.settings.dayLaneHeights||{};
      state.settings.dayLaneManual=state.settings.dayLaneManual||{};
      delete state.settings.dayLaneHeights[key];
      delete state.settings.dayLaneManual[key];
      const section=handle.closest('.dayResizableSection');
      section?.classList.remove('manualDayHeight');
      section?.style.removeProperty('--day-lane-h');
      save({rerender:false});
    };
    handle.onpointerdown=e=>{
      if(e.pointerType==='mouse' && e.button!==0) return;
      e.preventDefault(); e.stopPropagation();
      const section=handle.closest('.dayResizableSection'), key=handle.dataset.dayLaneResize;
      if(!section) return;
      state.settings.dayLaneManual=state.settings.dayLaneManual||{};
      state.settings.dayLaneManual[key]=true;
      section.classList.add('manualDayHeight');
      const startY=e.clientY, startH=Math.max(52,Math.round(section.getBoundingClientRect().height||dayLaneHeight(key,handle.dataset.dayLaneType||'calendar')));
      section.style.setProperty('--day-lane-h',`${startH}px`);
      let currentH=startH;
      handle.setPointerCapture?.(e.pointerId);
      document.body.classList.add('resizingDayLane');
      const move=ev=>{
        currentH=Math.max(52,Math.min(640,startH+(ev.clientY-startY)));
        section.style.setProperty('--day-lane-h',`${Math.round(currentH)}px`);
      };
      const up=ev=>{
        handle.removeEventListener('pointermove',move);
        handle.removeEventListener('pointerup',up);
        handle.removeEventListener('pointercancel',up);
        document.body.classList.remove('resizingDayLane');
        const h=Math.max(52,Math.min(640,Math.round(currentH)));
        state.settings.dayLaneHeights=state.settings.dayLaneHeights||{};
        state.settings.dayLaneHeights[key]=h;
        save({rerender:false});
        try{handle.releasePointerCapture?.(ev.pointerId)}catch{}
      };
      handle.addEventListener('pointermove',move);
      handle.addEventListener('pointerup',up,{once:true});
      handle.addEventListener('pointercancel',up,{once:true});
    };
    handle.onwheel=e=>{
      e.preventDefault(); e.stopPropagation();
      const section=handle.closest('.dayResizableSection'), key=handle.dataset.dayLaneResize;
      if(!section) return;
      state.settings.dayLaneHeights=state.settings.dayLaneHeights||{};
      state.settings.dayLaneManual=state.settings.dayLaneManual||{};
      state.settings.dayLaneManual[key]=true; section.classList.add('manualDayHeight');
      const current=Math.max(52,Math.round(section.getBoundingClientRect().height||dayLaneHeight(key,handle.dataset.dayLaneType||'calendar')));
      const next=Math.max(52,Math.min(640,current+(e.deltaY>0?16:-16)));
      state.settings.dayLaneHeights[key]=next; section.style.setProperty('--day-lane-h',`${next}px`); save({rerender:false});
    };
  });
}

function renderDay(){
  const d=ds(cursor),map=buildOccurrenceMap(d,d,{calendarIds:focusedCalendarIds()}),hasDiary=!!state.diary[d]?.text;
  const h=holidayLabel(d); setRangeLabel(`${d}${focusSuffix()}`,`${d.slice(5).replace('-', '/')}${compactFocusSuffix()}`); $('#main').className='daySingle';
  $('#main').innerHTML=`<div class="dayCompactTop"><span class="dayCompactDate">${d.slice(5).replace('-', '/')} <small class="dayCompactDow">${['일','월','화','수','목','금','토'][parse(d).getDay()]}</small></span><span class="dayCompactDday">${selectedDdayMarkerHtml(d,'dayViewDdayOffset')}</span><span class="dayCompactRight">${h?`<span class="dayCompactHoliday" title="${esc(h)}">${esc(h)}</span>`:''}<button type="button" class="diaryBtn ${hasDiary?'hasDiary':''}" data-diarydate="${d}" title="${hasDiary?'다이어리 보기 · 작성됨':'다이어리 작성 · 미작성'}">${diaryIconHtml(hasDiary)}</button></span></div><div class="dayResizableBoard" data-dropdate="${d}" ondblclick="window.__newEvent?.('${d}')">${dayViewGroupHtml(d,map[d]||[])}</div>`; bindItems(); bindDayViewResizers();
}
function renderList(){
  const start=ds(add(new Date(),-30)),end=ds(add(new Date(),365));
  const allowed=focusedCalendarIds();
  const selected=focusedCalendarList();
  const map=buildOccurrenceMap(start,end,{calendarIds:allowed});
  const rows=[]; for(const [date,es] of Object.entries(map)) for(const e of es){ if((e._occurrenceStart||e.date)===date) rows.push({date,e}); }
  const label=focusLabel();
  setRangeLabel(selected.length?`${label} 관련 일정`:'일정 목록',selected.length?`${label} 목록`:'목록'); $('#main').className='listView';
  let last='';
  let top='';
  if(selected.length){
    const sourceEvents=state.events.filter(e=>allowed?.has(e.calId));
    const manualFixed=state.fixed.filter(f=>allowed?.has(f.calId));
    const color=selected[0]?.color||'#d9d9d9';
    top=`<div class="calendarFocusHeader" style="border-left-color:${esc(color)}"><div><b>${esc(label)}</b><small>선택 ${selected.length}개 · 관련 일정 ${sourceEvents.length}개 · 날짜지정 ${manualFixed.length}개 · 공통 일정은 항상 함께 표시</small></div><button id="clearCalendarFocus" type="button">전체 일정 보기</button></div>`;
    if(manualFixed.length){
      top+=`<div class="calendarFocusFixed"><b>날짜 지정 배치 업무</b>${manualFixed.map(f=>`<button type="button" class="focusFixedItem" data-fid="${esc(f.id)}" style="border-left-color:${esc(cal(f.calId).color)}"><span>${esc(f.name)}</span><small>${esc(calendarPath(f.calId))} · ${esc(durationLabel(f))}</small></button>`).join('')}</div>`;
    }
  }
  const note=`<div class="listNote">오늘 기준 과거 30일 ~ 앞으로 1년의 ${selected.length?'선택한 캘린더 관련 일정과 공통 ':'전체 '}일정입니다. 반복 일정도 각 발생일에 표시됩니다.</div>`;
  $('#main').innerHTML=top+note+(rows.map(({date,e})=>{let h='';if(last!==date){last=date;h=`<div class="listDate ${holidayClass(date)}">${date}${holidayLabel(date)?` · ${esc(holidayLabel(date))}`:''}</div>`}return h+eventItemHtml(e);}).join('')||'<div class="empty">등록된 일정이 없습니다.</div>');
  $('#clearCalendarFocus')?.addEventListener('click',()=>{calendarFocusIds.clear(); render();});
  $$('.focusFixedItem').forEach(x=>x.onclick=()=>openFixed(x.dataset.fid));
  bindItems();
}
function render(){
  const sidebar=$('#sidebar'), main=$('#main');
  const keep={sidebarTop:sidebar?.scrollTop||0,sidebarLeft:sidebar?.scrollLeft||0,mainTop:main?.scrollTop||0,mainLeft:main?.scrollLeft||0};
  renderSide();
  $$('#currentViewMenu [data-view], .primaryViewButtons [data-view]').forEach(b=>b.classList.toggle('on',b.dataset.view===view));
  setCurrentViewButtonLabel();
  updateMonthCommonToggle();
  const weekBtn=$('.primaryViewButtons [data-view="week"]');
  if(weekBtn){
    const compact=state.settings?.weekViewMode==='compact';
    weekBtn.title=view==='week' ? `주 보기 · 다시 누르면 ${compact?'상세 구역형':'간결 달력형'}으로 전환` : `주 보기 (${compact?'간결 달력형':'상세 구역형'})`;
    weekBtn.setAttribute('aria-label',weekBtn.title);
    weekBtn.classList.toggle('weekCompactActive',view==='week'&&compact);
  }
  const viewSwitch=$('#diaryMainShortcut');
  if(viewSwitch){
    const inDiary=view==='diary';
    viewSwitch.classList.remove('hidden');
    viewSwitch.classList.toggle('scheduleReturn',inDiary);
    viewSwitch.title=inDiary?'일정으로':'다이어리로';
    viewSwitch.setAttribute('aria-label',inDiary?'일정으로':'다이어리로');
    viewSwitch.innerHTML=inDiary?'<span class="calendarSwitchGlyph" aria-hidden="true">📅</span>':diaryIconHtml(true);
  }
  ({week:renderWeek,'2week':()=>renderMultiWeek(2),'3week':()=>renderMultiWeek(3),'4week':()=>renderMultiWeek(4),month:renderMonth,day:renderDay,list:renderList,diary:renderDiaryMain}[view]||renderWeek)();
  const sidebar2=$('#sidebar'), main2=$('#main');
  if(sidebar2){ sidebar2.scrollTop=keep.sidebarTop; sidebar2.scrollLeft=keep.sidebarLeft; }
  if(main2){ main2.scrollTop=keep.mainTop; main2.scrollLeft=keep.mainLeft; }
}

function timedHoursFromForm(){
  if($('#allDay').checked || !$('#start').value || !$('#end').value) return null;
  const startDate=$('#date').value||ds(new Date()), endDate=$('#endDate').value||startDate;
  const [sh,sm]=$('#start').value.split(':').map(Number), [eh,em]=$('#end').value.split(':').map(Number);
  const mins=diffDays(startDate,endDate)*1440 + (eh*60+em) - (sh*60+sm);
  return mins>0 ? mins/60 : null;
}
function updateDurationMode(){
  const payment=$('#kind').value==='payment';
  const autoHours=timedHoursFromForm();
  const cb=$('#noDuration'), h=$('#hoursH'), m=$('#hoursM'), hint=$('#durationAutoHint');
  if(payment){
    cb.checked=true; cb.disabled=true; h.disabled=true; m.disabled=true;
    hint.textContent='납부일정은 업무량 계산에서 제외됩니다.'; hint.classList.remove('hidden');
    return;
  }
  if(autoHours!==null){
    cb.checked=false; cb.disabled=true; setDurationInputs(autoHours); h.disabled=true; m.disabled=true;
    hint.textContent=`시작·종료시간 기준 자동 계산: ${fmtH(autoHours)}`; hint.classList.remove('hidden');
    return;
  }
  cb.disabled=false; hint.textContent=''; hint.classList.add('hidden'); updateDurationUI();
}
function updateAvailabilityBlockUI(){
  const unavailableKind=['payment','anniversary'].includes($('#kind').value);
  const field=$('#availabilityBlockFields'), cb=$('#availabilityBlock'), wrap=$('#availabilityTargetWrap');
  if(!field||!cb||!wrap) return;
  field.classList.toggle('hidden',unavailableKind);
  if(unavailableKind) cb.checked=false;
  wrap.classList.toggle('hidden',unavailableKind || !cb.checked);
}
function defaultAvailabilityTargetForSelectedCalendar(){
  const root=topAncestor($('#cal')?.value||'');
  return root?.id || topLevelCals()[0]?.id || '';
}
function updateKindUI(){
  const payment=$('#kind').value==='payment';
  $('#paymentFields').classList.toggle('hidden',!payment);
  $('#carryEvent').classList.toggle('paymentHidden',payment);
  updateAvailabilityBlockUI();
  updateDurationMode();
  if($('#prepFields')) updatePrepUI();
}
function updateAllDayUI(){ $('#timeFields').classList.toggle('hidden',$('#allDay').checked); updateDurationMode(); }
function updateMonthlyRepeatUI(){
  const date=$('#date').value||ds(new Date()), d=parse(date);
  const mode=$('#monthlyMode').value;
  const monthEnd=$('#monthlyMonthEnd');
  const wrap=$('#monthlyMonthEndWrap');
  const nth=Math.floor((d.getDate()-1)/7)+1;
  const isDateMode=mode==='date';
  wrap.classList.toggle('hidden',!isDateMode);
  if(!isDateMode) monthEnd.checked=false;
  if(mode==='nthWeekday'){
    $('#monthlyHint').textContent=`매월 ${getNthLabel(nth)} ${weekdayName(d.getDay())}에 반복됩니다.`;
  }else if(mode==='lastWeekday'){
    $('#monthlyHint').textContent=`매월 마지막 ${weekdayName(d.getDay())}에 반복됩니다.`;
  }else if(monthEnd.checked){
    $('#monthlyHint').textContent='매월 말일에 반복됩니다.';
  }else{
    $('#monthlyHint').textContent=`매월 ${d.getDate()}일에 반복됩니다.${d.getDate()>=29?' 해당 날짜가 없는 달은 건너뜁니다.':''}`;
  }
}
function updateLunarYearlyHint(){
  const hint=$('#lunarYearlyHint'); if(!hint) return;
  if(!lunarFormatter){ hint.textContent='이 브라우저에서는 음력 변환을 지원하지 않습니다.'; return; }
  const base=parse($('#date').value||ds(new Date()));
  const baseParts=lunarPartsFromSolar(base);
  const lunarYear=baseParts?.year || base.getFullYear();
  const month=clamp(Number($('#lunarMonth').value)||baseParts?.month||1,1,12);
  const day=clamp(Number($('#lunarDay').value)||baseParts?.day||1,1,30);
  const leap=!!$('#lunarLeap').checked;
  const solar=solarDateForLunarYear(lunarYear,month,day,leap);
  hint.textContent=solar
    ? `${lunarLabel(month,day,leap)} → ${ds(solar)} · 이후 매년 음력 기준으로 반복됩니다.${leap?' 윤달이 없는 해에는 표시되지 않습니다.':''}`
    : `${lunarLabel(month,day,leap)}은 음력 ${lunarYear}년에 존재하지 않습니다.${leap?' 윤달이 있는 해에만 표시됩니다.':''}`;
}
function updateYearlyCalendarUI(){
  const isLunar=$('#yearlyCalendar').value==='lunar';
  $('#solarYearlyOptions').classList.toggle('hidden',isLunar);
  $('#lunarYearlyOptions').classList.toggle('hidden',!isLunar);
  if(isLunar) updateLunarYearlyHint();
}
let eventSpanDaysDraft=0;
let lastRepeatFormType='none';
function internalEventEndDateFromForm(){
  const start=$('#date').value||ds(new Date());
  if($('#repeat').value==='none') return $('#endDate').value||start;
  return ds(add(parse(start),Math.max(0,Number(eventSpanDaysDraft)||0)));
}
function syncTopEndDateWithRepeat(){
  const repeat=$('#repeat').value;
  if(repeat==='none'){
    const start=$('#date').value;
    if(start) $('#endDate').value=ds(add(parse(start),Math.max(0,Number(eventSpanDaysDraft)||0)));
    return;
  }
  const endType=$('#repeatEndType').value;
  $('#endDate').value=endType==='date'?($('#repeatEndDate').value||''):'';
}
function handleRepeatTypeChange(){
  const next=$('#repeat').value;
  if(lastRepeatFormType==='none' && next!=='none'){
    const start=$('#date').value, end=$('#endDate').value||start;
    if(start&&end) eventSpanDaysDraft=Math.max(0,diffDays(start,end));
  }
  lastRepeatFormType=next;
  updateRepeatUI();
}
function syncRepeatEndFromTop(){
  if($('#repeat').value==='none') return;
  const v=$('#endDate').value;
  if(v){ $('#repeatEndType').value='date'; $('#repeatEndDate').value=v; }
  else { $('#repeatEndType').value='never'; $('#repeatEndDate').value=''; }
  updateRepeatEndUI();
}
function updateRepeatUI(){
  const type=$('#repeat').value, date=$('#date').value||ds(new Date()), d=parse(date);
  $('#repeatDetails').classList.toggle('hidden',type==='none');
  $('#weeklyOptions').classList.toggle('hidden',type!=='weekly');
  $('#monthlyOptions').classList.toggle('hidden',type!=='monthly');
  $('#yearlyOptions').classList.toggle('hidden',type!=='yearly');
  $('#repeatUnitLabel').value={daily:'일마다',weekly:'주마다',monthly:'개월마다',yearly:'년마다'}[type]||'';
  if(type==='monthly') updateMonthlyRepeatUI();
  if(!$('#yearlyMonth').value) $('#yearlyMonth').value=d.getMonth()+1;
  if(!$('#yearlyDay').value) $('#yearlyDay').value=d.getDate();
  const lp=lunarPartsFromSolar(d);
  if(!$('#lunarMonth').value) $('#lunarMonth').value=lp?.month||1;
  if(!$('#lunarDay').value) $('#lunarDay').value=lp?.day||1;
  if(type==='yearly') updateYearlyCalendarUI();
  updateRepeatEndUI();
  syncTopEndDateWithRepeat();
}
function updateRepeatEndUI(){
  const t=$('#repeatEndType').value;
  $('#repeatEndDateWrap').classList.toggle('hidden',t!=='date');
  $('#repeatCountWrap').classList.toggle('hidden',t!=='count');
  syncTopEndDateWithRepeat();
}
function getRepeatRule(){
  const date=$('#date').value, d=parse(date), nth=Math.floor((d.getDate()-1)/7)+1;
  const weekdays=$$('#weeklyOptions input[type=checkbox]:checked').map(x=>Number(x.value));
  return {
    interval:Math.max(1,Number($('#repeatInterval').value)||1),
    weekdays:weekdays.length?weekdays:[d.getDay()],
    monthlyMode:($('#monthlyMode').value==='date' && $('#monthlyMonthEnd').checked)?'monthEnd':$('#monthlyMode').value,
    monthDay:d.getDate(),
    nth,
    weekday:d.getDay(),
    yearlyCalendar:$('#yearlyCalendar').value==='lunar'?'lunar':'solar',
    yearlyMonth:clamp(Number($('#yearlyMonth').value)||d.getMonth()+1,1,12),
    yearlyDay:clamp(Number($('#yearlyDay').value)||d.getDate(),1,31),
    lunarMonth:clamp(Number($('#lunarMonth').value)||lunarPartsFromSolar(d)?.month||1,1,12),
    lunarDay:clamp(Number($('#lunarDay').value)||lunarPartsFromSolar(d)?.day||1,1,30),
    lunarLeap:!!$('#lunarLeap').checked,
    endType:$('#repeatEndType').value,
    until:$('#repeatEndDate').value,
    count:Math.max(1,Number($('#repeatCount').value)||10)
  };
}
function setRepeatRule(e){
  const rule=normalizedRule(e);
  $('#repeatInterval').value=rule.interval;
  $$('#weeklyOptions input[type=checkbox]').forEach(x=>x.checked=rule.weekdays.includes(Number(x.value)));
  $('#monthlyMode').value=rule.monthlyMode==='monthEnd'?'date':(rule.monthlyMode||'date');
  $('#monthlyMonthEnd').checked=rule.monthlyMode==='monthEnd';
  $('#yearlyCalendar').value=rule.yearlyCalendar==='lunar'?'lunar':'solar';
  $('#yearlyMonth').value=rule.yearlyMonth;
  $('#yearlyDay').value=rule.yearlyDay;
  $('#lunarMonth').value=rule.lunarMonth||1;
  $('#lunarDay').value=rule.lunarDay||1;
  $('#lunarLeap').checked=!!rule.lunarLeap;
  $('#repeatEndType').value=rule.endType||'never';
  $('#repeatEndDate').value=rule.until||'';
  $('#repeatCount').value=rule.count||10;
  updateRepeatUI();
}

let prepDraftNotes={};
let prepDraftTasks=[];
let prepDraftMoves={};
let prepDraftAutoEnabled=false;
let prepEditingTaskId='';
let prepEditingTaskType='';
function collectPrepDailyNotes(){
  const next={...prepDraftNotes};
  $$('#prepDailyRows [data-prep-date]').forEach(inp=>{ next[inp.dataset.prepDate]=inp.value; });
  prepDraftNotes=next;
  return next;
}
function prepFormDates(){
  return preparationDatesFromValues($('#prepDeadline')?.value||$('#date')?.value,Number($('#prepDays')?.value)||5,!!$('#prepWeekdaysOnly')?.checked,!!$('#prepIncludeDeadline')?.checked);
}
function prepCustomEntriesFromForm(){
  return prepTaskEntriesFromValues($('#prepDeadline')?.value||$('#date')?.value,prepDraftTasks);
}
function prepRepeatResolvedStart(task,deadline){
  if(!task || !deadline) return task?.startDate||'';
  if(task.startMode==='before') return ds(add(parse(deadline),-Math.max(0,Number(task.beforeDays)||0)));
  return task.startDate||'';
}
function prepRuleDescription(task,deadline){
  if(task.type==='date') return `${preparationDateLabel(task.date)} · ${task.text}`;
  const entries=prepTaskEntriesFromValues(deadline,[task]);
  const first=entries[0]?.date||prepRepeatResolvedStart(task,deadline)||task.startDate||'';
  const last=entries.at(-1)?.date||'';
  const count=entries.length;
  if(task.type==='weekly') return `매주 ${weekdayName(Number(task.weekday)||0)} · ${task.startDate}부터 · ${count?`${count}회${first&&last?` (${first}${first!==last?`~${last}`:''})`:''}`:'해당일 없음'} · ${task.text}`;
  const type=task.repeatType||'daily', interval=Math.max(1,Number(task.interval)||1);
  const weekdays=[...new Set((task.weekdays||[]).map(Number).filter(n=>n>=0&&n<=6))];
  let repeatLabel=type==='daily'?(interval===1?'매일':`${interval}일마다`):type==='weekdays'?'평일마다':type==='weekends'?'주말마다':`${interval===1?'매주':`${interval}주마다`} ${(weekdays.length?weekdays:[parse(first||deadline).getDay()]).map(weekdayName).join('·')}`;
  const startLabel=task.startMode==='before'?`마감 ${Math.max(0,Number(task.beforeDays)||0)}일 전부터`:`${task.startDate}부터`;
  const endLabel=task.endType==='date'&&task.endDate?`${task.endDate}까지`:(task.includeDeadline?'마감 당일까지':'마감 전까지');
  return `${startLabel} · ${repeatLabel} · ${endLabel} · ${count?`${count}회${first&&last?` (${first}${first!==last?`~${last}`:''})`:''}`:'해당일 없음'} · ${task.text}`;
}
function renderPrepTaskRules(){
  const list=$('#prepRuleList'); if(list){ list.innerHTML=''; list.classList.add('hidden'); }
}
function renderPrepDailyRows(){
  const wrap=$('#prepDailyRows'), summary=$('#prepCalcSummary'); if(!wrap||!summary) return;
  collectPrepDailyNotes();
  const enabled=!!$('#prepEnabled')?.checked;
  $('#prepDetails')?.classList.toggle('hidden',!enabled);
  if(!enabled){ wrap.innerHTML=''; summary.textContent=''; return; }
  const mode=$('#prepMode')?.value==='custom'?'custom':'auto';
  $('#prepAutoFields')?.classList.toggle('hidden',mode!=='auto');
  $('#prepCustomFields')?.classList.toggle('hidden',mode!=='custom');
  if($('#prepAutoEnabled')) $('#prepAutoEnabled').checked=!!prepDraftAutoEnabled;
  const deadline=$('#prepDeadline').value||$('#date').value;
  if(!deadline){ summary.textContent='기한 날짜를 입력하세요.'; summary.classList.add('warn'); wrap.innerHTML=''; return; }
  summary.classList.remove('warn');
  const autoDates=prepDraftAutoEnabled?prepFormDates():[];
  const manualEntries=prepCustomEntriesFromForm();
  const baseCombined=[];
  autoDates.forEach(date=>baseCombined.push({date,sourceDate:date,type:'auto',text:String(prepDraftNotes[date]||'').trim(),key:`auto:${date}`,ruleId:date,ruleLabel:'자동'}));
  manualEntries.forEach(entry=>baseCombined.push({...entry}));
  const combined=baseCombined.map(entry=>{
    const moved=typeof prepDraftMoves?.[entry.key]==='string'&&prepDraftMoves[entry.key]?prepDraftMoves[entry.key]:'';
    return moved?{...entry,date:moved,moved:true}:{...entry,moved:false};
  }).filter(entry=>!deadline||entry.date<=deadline);
  combined.sort((a,b)=>a.date.localeCompare(b.date)||(a.type==='auto'?-1:b.type==='auto'?1:a.text.localeCompare(b.text)));
  const uniqueDates=[...new Set(combined.map(x=>x.date))];
  const autoLabel=prepDraftAutoEnabled?`자동 ${autoDates.length}일`:'';
  const extraLabel=manualEntries.length?`추가 ${manualEntries.length}건`:'';
  summary.textContent=combined.length?`준비 진행계획 ${combined.length}건 · ${uniqueDates.length}일${autoLabel||extraLabel?' · ':''}${[autoLabel,extraLabel].filter(Boolean).join(' + ')} → 마감 ${deadline}`:`준비 진행계획을 추가하세요. → 마감 ${deadline}`;
  const seenRule=new Set();
  wrap.innerHTML=combined.length?combined.map(entry=>{
    const firstForRule=!seenRule.has(entry.ruleId); seenRule.add(entry.ruleId);
    const sourceDate=String(entry.sourceDate||entry.date||'');
    if(entry.type==='auto'){
      const movedMark=entry.moved?`<small class="prepEditorRule">이동</small>`:'<small>자동</small>';
      return `<label class="prepDailyRow prepPlanEditorRow"><span class="prepDailyDate">${esc(preparationDateLabel(entry.date))}${movedMark}</span><input data-prep-date="${esc(sourceDate)}" value="${esc(prepDraftNotes[sourceDate]||'')}" placeholder="이날 진행할 내용"></label>`;
    }
    const rule=entry.ruleLabel?`<small class="prepEditorRule">${esc(entry.ruleLabel)}${entry.moved?' · 이동':''}</small>`:'';
    const edit=firstForRule?`<button type="button" class="prepRuleDelete prepInlineEdit" data-prep-task-edit="${esc(entry.ruleId)}" title="이 준비업무 설정 수정" aria-label="준비업무 수정">✎</button>`:'';
    const del=firstForRule?`<button type="button" class="prepRuleDelete prepInlineDelete" data-prep-task-delete="${esc(entry.ruleId)}" title="${entry.type==='repeat'||entry.type==='weekly'?'이 반복 준비업무 전체 삭제':'이 준비업무 삭제'}">×</button>`:'';
    const actions=firstForRule?`<div class="prepPlanEditorActions">${edit}${del}</div>`:'';
    return `<div class="prepDailyRow prepPlanEditorRow prepManualPlanRow"><span class="prepDailyDate">${esc(preparationDateLabel(entry.date))}${rule}</span><div class="prepPlanEditorText">${esc(entry.text||'계획 미입력')}</div>${actions}</div>`;
  }).join(''):`<div class="prepRuleEmpty">아직 준비 진행계획이 없습니다. 위의 추가 방식에서 계획을 만들어 주세요.</div>`;
  renderPrepTaskRules();
}
function updatePrepUI(){
  const supported=!['anniversary','payment'].includes($('#kind')?.value||'event');
  $('#prepFields')?.classList.toggle('hidden',!supported);
  if(!supported && $('#prepEnabled')) $('#prepEnabled').checked=false;
  updatePrepRepeatRuleUI();
  renderPrepDailyRows();
}
function clearPrepTaskEditingState(clearFields=false){
  prepEditingTaskId=''; prepEditingTaskType='';
  const oneBtn=$('#addPrepOne'), repeatBtn=$('#addPrepRepeat');
  if(oneBtn){ oneBtn.textContent='추가'; oneBtn.classList.remove('prepEditingSave'); }
  if(repeatBtn){ repeatBtn.textContent='추가'; repeatBtn.classList.remove('prepEditingSave'); }
  $$('.prepRuleAdder').forEach(x=>x.classList.remove('prepTaskEditing'));
  if(clearFields){
    if($('#prepOneDate')) $('#prepOneDate').value='';
    if($('#prepOneText')) $('#prepOneText').value='';
    if($('#prepRepeatStartMode')) $('#prepRepeatStartMode').value='date';
    if($('#prepRepeatStartDate')) $('#prepRepeatStartDate').value='';
    if($('#prepRepeatBeforeDays')) $('#prepRepeatBeforeDays').value='5';
    if($('#prepRepeatType')) $('#prepRepeatType').value='daily';
    if($('#prepRepeatInterval')) $('#prepRepeatInterval').value='1';
    $$('#prepRepeatWeekdays input[type=checkbox]').forEach(x=>x.checked=false);
    if($('#prepRepeatEndType')) $('#prepRepeatEndType').value='deadline';
    if($('#prepRepeatEndDate')) $('#prepRepeatEndDate').value='';
    if($('#prepRepeatIncludeDeadline')) $('#prepRepeatIncludeDeadline').checked=false;
    if($('#prepRepeatText')) $('#prepRepeatText').value='';
    updatePrepRepeatRuleUI();
  }
}
function clearPrepMovesForTask(id){
  const sid=String(id||'');
  for(const key of Object.keys(prepDraftMoves||{})){
    if(key===`date:${sid}`||key.startsWith(`weekly:${sid}:`)||key.startsWith(`repeat:${sid}:`)) delete prepDraftMoves[key];
  }
}
function loadPrepTaskIntoEditor(id){
  const task=prepDraftTasks.find(x=>String(x.id)===String(id)); if(!task) return;
  clearPrepTaskEditingState(true);
  prepEditingTaskId=String(task.id); prepEditingTaskType=task.type;
  if($('#prepMode')) $('#prepMode').value='custom';
  renderPrepDailyRows();
  $$('.prepRuleAdder').forEach(x=>x.classList.remove('prepTaskEditing'));
  if(task.type==='date'){
    $('#prepOneDate').value=task.date||''; $('#prepOneText').value=task.text||'';
    $('#addPrepOne').textContent='저장'; $('#addPrepOne').classList.add('prepEditingSave');
    $('#prepOneDate')?.closest('.prepRuleAdder')?.classList.add('prepTaskEditing');
    $('#prepOneText')?.focus();
    $('#prepOneDate')?.closest('.prepRuleAdder')?.scrollIntoView({behavior:'smooth',block:'nearest'});
    return;
  }
  // 구버전 weekly 준비업무도 현재 반복 입력폼으로 불러와 수정할 수 있게 변환해 표시한다.
  const legacyWeekly=task.type==='weekly';
  $('#prepRepeatStartMode').value='date';
  $('#prepRepeatStartDate').value=task.startDate||'';
  $('#prepRepeatBeforeDays').value=String(task.beforeDays??5);
  $('#prepRepeatType').value=legacyWeekly?'weekly':(task.repeatType||'daily');
  $('#prepRepeatInterval').value=String(legacyWeekly?1:(task.interval||1));
  const selected=legacyWeekly?[Number(task.weekday)||0]:(Array.isArray(task.weekdays)?task.weekdays.map(Number):[]);
  $$('#prepRepeatWeekdays input[type=checkbox]').forEach(x=>x.checked=selected.includes(Number(x.value)));
  $('#prepRepeatEndType').value=legacyWeekly?'deadline':(task.endType==='date'?'date':'deadline');
  $('#prepRepeatEndDate').value=legacyWeekly?'':(task.endDate||'');
  $('#prepRepeatIncludeDeadline').checked=legacyWeekly?false:!!task.includeDeadline;
  $('#prepRepeatText').value=task.text||'';
  $('#addPrepRepeat').textContent='저장'; $('#addPrepRepeat').classList.add('prepEditingSave');
  updatePrepRepeatRuleUI();
  $('#prepRepeatText')?.closest('.prepRuleAdder')?.classList.add('prepTaskEditing');
  $('#prepRepeatText')?.focus();
  $('#prepRepeatText')?.closest('.prepRuleAdder')?.scrollIntoView({behavior:'smooth',block:'nearest'});
}
function addPrepDateTask(){
  const date=$('#prepOneDate')?.value||'', text=String($('#prepOneText')?.value||'').trim(), deadline=$('#prepDeadline')?.value||'';
  if(!date || !text){ alert('준비 날짜와 할 일을 입력하세요.'); return; }
  if(deadline && date>deadline){ alert('준비 날짜는 기한 날짜보다 늦을 수 없습니다.'); return; }
  if(prepEditingTaskId && prepEditingTaskType==='date'){
    const task=prepDraftTasks.find(x=>String(x.id)===prepEditingTaskId);
    if(!task) return;
    task.date=date; task.text=text; clearPrepMovesForTask(task.id);
    clearPrepTaskEditingState(true);
  }else{
    prepDraftTasks.push({id:uid(),type:'date',date,text,startDate:'',weekday:0});
    $('#prepOneText').value='';
  }
  renderPrepDailyRows();
}
function updatePrepRepeatRuleUI(){
  const mode=$('#prepRepeatStartMode')?.value||'date';
  $('#prepRepeatStartDateWrap')?.classList.toggle('hidden',mode!=='date');
  $('#prepRepeatBeforeWrap')?.classList.toggle('hidden',mode!=='before');
  const type=$('#prepRepeatType')?.value||'daily';
  $('#prepRepeatWeekdays')?.classList.toggle('hidden',type!=='weekly');
  $('#prepRepeatIntervalWrap')?.classList.toggle('hidden',!['daily','weekly'].includes(type));
  if($('#prepRepeatUnit')) $('#prepRepeatUnit').textContent=type==='weekly'?'주마다':'일마다';
  const endType=$('#prepRepeatEndType')?.value==='date'?'date':'deadline';
  $('#prepRepeatEndDateWrap')?.classList.toggle('hidden',endType!=='date');
  $('#prepRepeatIncludeDeadlineWrap')?.classList.toggle('hidden',endType==='date');
  const deadline=$('#prepDeadline')?.value||'';
  if($('#prepRepeatEndDate')){
    const startMin=mode==='date'?($('#prepRepeatStartDate')?.value||''):(deadline?ds(add(parse(deadline),-Math.max(0,Number($('#prepRepeatBeforeDays')?.value)||0))):'');
    $('#prepRepeatEndDate').min=startMin||'';
    $('#prepRepeatEndDate').max=deadline||'';
    if(endType==='date' && deadline && !$('#prepRepeatEndDate').value) $('#prepRepeatEndDate').value=deadline;
    if(startMin && $('#prepRepeatEndDate').value<startMin) $('#prepRepeatEndDate').value=startMin;
    if(deadline && $('#prepRepeatEndDate').value>deadline) $('#prepRepeatEndDate').value=deadline;
  }
}
function currentPrepRepeatTaskFromForm(id=''){
  const deadline=$('#prepDeadline')?.value||'';
  const startMode=$('#prepRepeatStartMode')?.value==='before'?'before':'date';
  const startDate=startMode==='date'?($('#prepRepeatStartDate')?.value||''):'';
  const beforeDays=startMode==='before'?Math.max(0,Math.min(365,Number($('#prepRepeatBeforeDays')?.value)||0)):0;
  const repeatType=$('#prepRepeatType')?.value||'daily';
  const interval=Math.max(1,Math.min(99,Number($('#prepRepeatInterval')?.value)||1));
  const weekdays=$$('#prepRepeatWeekdays input[type=checkbox]:checked').map(x=>Number(x.value));
  const text=String($('#prepRepeatText')?.value||'').trim();
  const endType=$('#prepRepeatEndType')?.value==='date'?'date':'deadline';
  const endDate=endType==='date'?($('#prepRepeatEndDate')?.value||''):'';
  const includeDeadline=endType==='deadline'&&!!$('#prepRepeatIncludeDeadline')?.checked;
  return {id:id||uid(),type:'repeat',text,startMode,startDate,beforeDays,repeatType,interval,weekdays,endType,endDate,includeDeadline,date:'',weekday:0,deadline};
}
function addPrepRepeatTask(){
  const editingId=(prepEditingTaskId && ['repeat','weekly'].includes(prepEditingTaskType))?prepEditingTaskId:'';
  const deadline=$('#prepDeadline')?.value||'', task=currentPrepRepeatTaskFromForm(editingId);
  if(!deadline){ alert('먼저 기한 날짜를 선택하세요.'); return; }
  if(!task.text){ alert('반복할 준비업무 내용을 입력하세요.'); return; }
  if(task.startMode==='date' && !task.startDate){ alert('반복 시작일을 선택하세요.'); return; }
  const resolvedStart=prepRepeatResolvedStart(task,deadline);
  if(task.endType==='date'){
    if(!task.endDate){ alert('반복 종료일을 선택하세요.'); return; }
    if(task.endDate>deadline){ alert('반복 종료일은 마감일보다 늦을 수 없습니다.'); return; }
    if(resolvedStart && task.endDate<resolvedStart){ alert('반복 종료일은 시작일보다 빠를 수 없습니다.'); return; }
  }
  if(resolvedStart>deadline || (task.endType==='deadline'&&!task.includeDeadline && resolvedStart===deadline)){ alert('반복 시작일은 마감일보다 앞이어야 합니다.'); return; }
  if(task.repeatType==='weekly' && !task.weekdays.length){ alert('반복할 요일을 하나 이상 선택하세요.'); return; }
  const test=prepTaskEntriesFromValues(deadline,[task]);
  if(!test.length){ alert('현재 반복 조건으로 마감 전에 생성되는 준비일정이 없습니다.'); return; }
  delete task.deadline;
  if(editingId){
    const idx=prepDraftTasks.findIndex(x=>String(x.id)===editingId);
    if(idx<0) return;
    prepDraftTasks[idx]=task;
    clearPrepMovesForTask(editingId);
    clearPrepTaskEditingState(true);
  }else{
    prepDraftTasks.push(task);
    $('#prepRepeatText').value='';
  }
  renderPrepDailyRows();
}
function checklistFromText(text, oldItems=[]){
  const lines=String(text||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  const used=new Set();
  return lines.map((line,i)=>{
    let old=oldItems.find((x,idx)=>!used.has(idx)&&String(x.text||'').trim()===line);
    if(old){ const idx=oldItems.indexOf(old); used.add(idx); return {id:String(old.id||uid()),text:line}; }
    const byIndex=oldItems[i];
    if(byIndex && !used.has(i)){ used.add(i); return {id:String(byIndex.id||uid()),text:line}; }
    return {id:uid(),text:line};
  });
}
function cleanedChecklistDoneMap(map,items){
  const allowed=new Set(items.map(x=>String(x.id)));
  const out={};
  if(map&&typeof map==='object') for(const [date,ids] of Object.entries(map)){
    const kept=(Array.isArray(ids)?ids:[]).map(String).filter(id=>allowed.has(id));
    if(kept.length) out[date]=kept;
  }
  return out;
}
function openEvent(date,id,options={}){
  closeEventPopover();
  const e=state.events.find(x=>x.id===id);
  const recurringPreset=!e && options?.preset==='autoRecurring';
  const paymentPreset=!e && options?.preset==='payment';
  const quickPreset=!e && options?.preset==='quick';
  const commonPreset=!e && options?.preset==='common';
  const requestedCalId=!e && typeof options?.calId==='string' && state.calendars.some(c=>c.id===options.calId) ? options.calId : '';
  activeEventOccurrence=e?(date||e.date):(date||ds(cursor));
  $('#eventTitle').textContent=e?'일정 수정':(paymentPreset?'납부일정 추가':(quickPreset?'Quick 추가':(commonPreset?'공통일정 추가':(recurringPreset?'자동반복 업무 추가':'일정 등록'))));
  const occLabel=$('#eventOccurrenceDate'); if(occLabel) occLabel.textContent=e?activeEventOccurrence:'';
  eventSpanDaysDraft=e?Math.max(0,diffDays(e.date,e.endDate||e.date)):0;
  $('#eid').value=e?.id||''; $('#title').value=e?.title||''; $('#important').checked=!!e?.important; $('#cal').value=e?.calId||requestedCalId||cals()[0]?.id||'';
  const editingRecurring=!!e && (e.repeat||'none')!=='none';
  $('#date').value=editingRecurring?activeEventOccurrence:(e?.date||date||ds(cursor)); $('#endDate').value=e?.endDate||e?.date||date||ds(cursor);
  $('#allDay').checked=e?.allDay??true; $('#start').value=e?.start||''; $('#end').value=e?.end||''; setDurationInputs(e?.hours??1); $('#noDuration').checked=paymentPreset?true:(e ? !!e.noDuration : true);
  $('#kind').value=e?.kind||(paymentPreset?'payment':(quickPreset?'todo':(commonPreset?'appointment':(recurringPreset?'todo':'event')))); $('#place').value=e?.place||''; $('#repeat').value=e?.repeat||(paymentPreset?'monthly':(recurringPreset?'weekly':'none')); lastRepeatFormType=$('#repeat').value; $('#memo').value=e?.memo||'';
  // 새 일정은 이전에 열었던 일정의 준비/마감 정보를 절대 이어받지 않는다.
  if(e){
    prepDraftNotes={...(e.prepDailyNotes||{})};
    prepDraftTasks=(e.prepTasks||[]).map(x=>({...x}));
    prepDraftMoves={...(e.prepMoves||{})};
    prepDraftAutoEnabled=typeof e.prepAutoEnabled==='boolean'?e.prepAutoEnabled:e.prepMode!=='custom';
    $('#prepEnabled').checked=!!e.prepEnabled;
    $('#prepDeadline').value=e.prepDeadline||e.date||'';
    $('#prepMode').value=e.prepMode==='custom'?'custom':'auto';
    $('#prepDays').value=Math.max(1,Number(e.prepDays)||5);
    $('#prepWeekdaysOnly').checked=!!e.prepWeekdaysOnly;
    $('#prepIncludeDeadline').checked=!!e.prepIncludeDeadline;
    if($('#prepAutoEnabled')) $('#prepAutoEnabled').checked=prepDraftAutoEnabled;
  }else{
    prepDraftNotes={}; prepDraftTasks=[]; prepDraftMoves={}; prepDraftAutoEnabled=false;
    $('#prepEnabled').checked=false;
    $('#prepDeadline').value='';
    $('#prepMode').value='auto';
    $('#prepDays').value=5;
    $('#prepWeekdaysOnly').checked=false;
    $('#prepIncludeDeadline').checked=false;
    if($('#prepAutoEnabled')) $('#prepAutoEnabled').checked=false;
    if($('#prepDailyRows')) $('#prepDailyRows').innerHTML='';
    if($('#prepRuleList')) $('#prepRuleList').innerHTML='';
    if($('#prepCalcSummary')) $('#prepCalcSummary').textContent='';
  }
  clearPrepTaskEditingState(false);
  if($('#prepOneDate')) $('#prepOneDate').value='';
  if($('#prepOneText')) $('#prepOneText').value='';
  if($('#prepRepeatStartMode')) $('#prepRepeatStartMode').value='date';
  if($('#prepRepeatStartDate')) $('#prepRepeatStartDate').value='';
  if($('#prepRepeatBeforeDays')) $('#prepRepeatBeforeDays').value='5';
  if($('#prepRepeatType')) $('#prepRepeatType').value='daily';
  if($('#prepRepeatInterval')) $('#prepRepeatInterval').value='1';
  $$('#prepRepeatWeekdays input[type=checkbox]').forEach(x=>x.checked=false);
  if($('#prepRepeatEndType')) $('#prepRepeatEndType').value='deadline';
  if($('#prepRepeatEndDate')) $('#prepRepeatEndDate').value='';
  if($('#prepRepeatIncludeDeadline')) $('#prepRepeatIncludeDeadline').checked=false;
  if($('#prepRepeatText')) $('#prepRepeatText').value='';
  updatePrepRepeatRuleUI();
  $('#checklistText').value=checklistItems(e||{}).map(x=>x.text).join('\n');
  $('#paymentAmount').value=e?.paymentAmount||''; $('#paymentMethod').value=e?.paymentMethod||'';
  $('#availabilityBlock').checked=!!e?.availabilityBlock;
  const preferredAvailabilityTarget=e?.availabilityTargetCalId||defaultAvailabilityTargetForSelectedCalendar();
  if($('#availabilityTarget') && [...$('#availabilityTarget').options].some(o=>o.value===preferredAvailabilityTarget)) $('#availabilityTarget').value=preferredAvailabilityTarget;
  $('#repeat').disabled=false;
  $('#deleteEvent').style.visibility=e?'visible':'hidden'; $('#copyEvent').style.visibility=e?'visible':'hidden';
  const occurrenceView=e?{...e,_occurrenceStart:activeEventOccurrence}:null;
  const doneWrap=$('#eventDoneWrap'), doneInput=$('#eventDone'), doneText=$('#eventDoneText');
  if(doneWrap){
    const canComplete=!!e;
    doneWrap.classList.toggle('hidden',!canComplete);
    if(canComplete){ doneInput.checked=!!isDone(occurrenceView); doneText.textContent=e.kind==='payment'?'납부완료':'완료'; }
  }
  $('#carryEvent').classList.toggle('hidden',!e || e.kind==='anniversary' || e.kind==='payment' || (occurrenceView&&isDone(occurrenceView)));
  updateAllDayUI(); updateKindUI(); setRepeatRule(e||{date:$('#date').value,repeat:$('#repeat').value,repeatRule:null}); updateDurationMode(); updatePrepUI();
  showRecurringDateEditHint(e,activeEventOccurrence);
  openedRecurringRuleFingerprint=editingRecurring?recurrenceRuleFormFingerprint():'';
  openDialog($('#eventDlg'));
  if(options?.prepFocusDate){
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      const target=$('#prepAutoEditor')||$('#prepFields');
      target?.classList.add('prepMissedEditFocus');
      target?.scrollIntoView({block:'center',behavior:'smooth'});
      setTimeout(()=>target?.classList.remove('prepMissedEditFocus'),2200);
    }));
  }
}
window.__newEvent=openEvent;
function openDialog(d){ if(!d.open) d.showModal(); }
function closeDialog(d){ if(d.open) d.close(); }


let openedRecurringRuleFingerprint = '';
function recurrenceRuleFormFingerprint(){
  const checked=$$('#weeklyOptions input[type=checkbox]:checked').map(x=>x.value).sort();
  return JSON.stringify([
    $('#repeat').value,$('#repeatInterval').value,checked,
    $('#monthlyMode').value,$('#monthlyMonthEnd').checked,
    $('#yearlyCalendar').value,$('#yearlyMonth').value,$('#yearlyDay').value,
    $('#lunarMonth').value,$('#lunarDay').value,$('#lunarLeap').checked,
    $('#repeatEndType').value,$('#repeatEndDate').value,$('#repeatCount').value
  ]);
}
function showRecurringDateEditHint(old,occ){
  const isRecurring=!!old && (old.repeat||'none')!=='none';
  const hint=$('#eventRecurringDateHint');
  hint?.classList.toggle('hidden',!isRecurring);
  const startLabel=$('#eventStartDateLabel'),endLabel=$('#eventEndDateLabel');
  if(startLabel) startLabel.textContent=isRecurring?'선택한 회차 날짜':'날짜';
  if(endLabel) endLabel.textContent=isRecurring?'반복 종료일':'종료일';
  if(isRecurring && hint){
    hint.textContent=`반복 시작일 ${old.date} · 선택한 회차 ${occ} · 날짜를 변경한 뒤 저장하면 이동 범위를 선택할 수 있습니다.`;
  }
}
function applyWholeRecurringFormEdit(old,obj,occ,target,ruleEdited){
  const delta=diffDays(occ,target);
  // Dates and completion histories must move together; never overwrite shifted histories.
  if(delta) moveRecurringWholeSeries(old,target,occ);
  const movedDate=old.date,movedEndDate=old.endDate,movedRule=old.repeatRule;
  const records={
    excludedDates:old.excludedDates,doneDates:old.doneDates,
    checklistDoneByDate:cleanedChecklistDoneMap(old.checklistDoneByDate,obj.checklist),
    orderByDate:old.orderByDate,done:old.done,
    carryoverHistory:old.carryoverHistory
  };
  Object.assign(old,obj,{...records,date:movedDate,endDate:movedEndDate,
    repeatRule:ruleEdited?obj.repeatRule:movedRule});
}
let pendingRepeatEdit=null;
function repeatEditOccurrenceOnly(old,obj,occ){
  const originalSpan=Math.max(0,diffDays(old.date,old.endDate||old.date));
  const formSpan=Math.max(0,diffDays(obj.date,obj.endDate||obj.date));
  const delta=diffDays(old.date,obj.date);
  const targetDate=shiftedDateString(occ,delta);
  const targetEnd=ds(add(parse(targetDate),formSpan));
  old.excludedDates=Array.isArray(old.excludedDates)?old.excludedDates:[];
  if(!old.excludedDates.includes(occ)) old.excludedDates.push(occ);
  const done=(old.doneDates||[]).includes(occ);
  old.doneDates=(old.doneDates||[]).filter(d=>d!==occ);
  const doneIds=Array.isArray(obj.checklistDoneByDate?.[occ])?[...obj.checklistDoneByDate[occ]]:[];
  const detached={...structuredClone(old),...structuredClone(obj),id:uid(),date:targetDate,endDate:targetEnd,repeat:'none',repeatRule:null,excludedDates:[],done,doneDates:[],checklistDoneByDate:doneIds.length?{[targetDate]:doneIds}:{},orderByDate:{},repeatOrder:0,fixedId:null,detachedFromRepeatId:old.id,detachedOccurrence:occ};
  detached.carryoverHistory=[];
  state.events.push(detached);
}
function repeatEditFuture(old,obj,occ){
  if(occ<=old.date){
    const idx=state.events.findIndex(x=>x.id===old.id);
    state.events[idx]={...old,...obj};
    return;
  }
  const formSpan=Math.max(0,diffDays(obj.date,obj.endDate||obj.date));
  const delta=diffDays(old.date,obj.date);
  const targetDate=shiftedDateString(occ,delta);
  const targetEnd=ds(add(parse(targetDate),formSpan));
  const future={...structuredClone(old),...structuredClone(obj),id:uid(),date:targetDate,endDate:targetEnd,detachedFromRepeatId:'',detachedOccurrence:''};
  const oldRule=normalizedRule(old);
  if(future.repeat!=='none' && future.repeatRule?.endType==='count' && oldRule.endType==='count'){
    const beforeEnd=ds(add(parse(occ),-1));
    const beforeCount=generateOccurrenceStarts(old,old.date,beforeEnd).length;
    future.repeatRule={...future.repeatRule,count:Math.max(1,Number(future.repeatRule.count||1)-beforeCount)};
  }
  const moveDelta=diffDays(occ,targetDate);
  future.excludedDates=shiftedDateArray(old.excludedDates,moveDelta,d=>String(d)>=occ);
  future.doneDates=shiftedDateArray(old.doneDates,moveDelta,d=>String(d)>=occ);
  future.checklistDoneByDate=shiftedDateMap(obj.checklistDoneByDate,moveDelta,d=>String(d)>=occ);
  future.orderByDate=shiftedDateMap(old.orderByDate,moveDelta,d=>String(d)>=occ);

  const pastRule=normalizedRule(old);
  pastRule.endType='date'; pastRule.until=ds(add(parse(occ),-1));
  old.repeatRule=pastRule;
  old.excludedDates=(old.excludedDates||[]).filter(d=>String(d)<occ);
  old.doneDates=(old.doneDates||[]).filter(d=>String(d)<occ);
  old.checklistDoneByDate=Object.fromEntries(Object.entries(old.checklistDoneByDate||{}).filter(([k])=>k<occ));
  old.orderByDate=Object.fromEntries(Object.entries(old.orderByDate||{}).filter(([k])=>k<occ));
  state.events.push(future);
}
function finishRepeatEdit(){
  pendingRepeatEdit=null; activeEventOccurrence=null;
  closeDialog($('#repeatEditDlg')); closeDialog($('#eventDlg')); save();
}
function requestRepeatEditScope(old,obj,chosenDate,ruleEdited=false){
  const occ=activeEventOccurrence||old.date;
  pendingRepeatEdit={id:old.id,occ,obj,chosenDate:chosenDate||occ,ruleEdited};
  $('#repeatEditInfo').textContent=`선택한 회차: ${occ} · 수정 적용 범위를 선택하세요.`;
  const target=$('#repeatEditDateChange');
  if(target){
    target.classList.toggle('hidden',!chosenDate||chosenDate===occ);
    target.textContent=chosenDate&&chosenDate!==occ?`날짜 이동: ${occ} → ${chosenDate}`:'';
  }
  openDialog($('#repeatEditDlg'));
}
$('#eventForm').onsubmit=e=>{
  e.preventDefault();
  const id=$('#eid').value, old=state.events.find(x=>x.id===id);
  const repeat=$('#repeat').value;
  const isRecurringEdit=!!old && (old.repeat||'none')!=='none';
  const selectedOcc=isRecurringEdit?(activeEventOccurrence||old.date):'';
  const chosenDate=$('#date').value;
  const recurringDelta=isRecurringEdit?diffDays(selectedOcc,chosenDate):0;
  const changedRepeatRule=isRecurringEdit && openedRecurringRuleFingerprint!==recurrenceRuleFormFingerprint();
  const internalEndDate=internalEventEndDateFromForm();
  const comparisonAnchor=isRecurringEdit?old.date:chosenDate;
  if(repeat==='none' && $('#endDate').value && $('#endDate').value<$('#date').value){ alert('종료일은 시작일보다 빠를 수 없습니다.'); return; }
  if(repeat!=='none' && $('#repeatEndType').value==='date' && $('#endDate').value && $('#endDate').value<comparisonAnchor){ alert('반복 종료 날짜는 시작 날짜보다 빠를 수 없습니다.'); return; }
  if(!$('#allDay').checked && $('#start').value && $('#end').value && $('#end').value<=$('#start').value && $('#date').value===internalEndDate){ alert('종료 시간은 시작 시간보다 늦어야 합니다.'); return; }
  if($('#repeat').value!=='none' && $('#repeatEndType').value==='date' && !$('#repeatEndDate').value){ alert('반복 종료 날짜를 선택하세요.'); return; }
  if($('#repeat').value!=='none' && $('#repeatEndType').value==='date' && $('#repeatEndDate').value<comparisonAnchor){ alert('반복 종료 날짜는 시작 날짜보다 빠를 수 없습니다.'); return; }
  if($('#repeat').value==='yearly' && $('#yearlyCalendar').value==='lunar' && !lunarFormatter){ alert('현재 브라우저에서는 음력 날짜 변환을 지원하지 않습니다.'); return; }
  const prepEnabled=!!$('#prepEnabled').checked && !['anniversary','payment'].includes($('#kind').value);
  if(prepEnabled && $('#repeat').value!=='none'){ alert('준비기간이 있는 기한 일정은 반복 없음으로 등록해 주세요.'); return; }
  if(prepEnabled && !$('#prepDeadline').value){ alert('기한 날짜를 선택하세요.'); return; }
  if(prepEnabled){ $('#date').value=$('#prepDeadline').value; $('#endDate').value=$('#prepDeadline').value; }
  collectPrepDailyNotes();
  const checklist=checklistFromText($('#checklistText').value,checklistItems(old||{}));
  const checklistDoneByDate=cleanedChecklistDoneMap(old?.checklistDoneByDate||{},checklist);
  const obj={
    id:id||uid(), title:$('#title').value.trim(), important:$('#important').checked, calId:$('#cal').value, date:$('#date').value,
    endDate:internalEndDate, allDay:$('#allDay').checked,
    start:$('#allDay').checked?'':$('#start').value, end:$('#allDay').checked?'':$('#end').value,
    hours:$('#kind').value==='payment'?0:(timedHoursFromForm()??getDurationInputs()), noDuration:$('#kind').value==='payment'?true:($('#noDuration').checked && timedHoursFromForm()===null), kind:$('#kind').value, place:$('#place').value.trim(),
    paymentAmount:$('#kind').value==='payment'?Math.max(0,Number($('#paymentAmount').value)||0):0, paymentMethod:$('#kind').value==='payment'?$('#paymentMethod').value.trim():'',
    prepEnabled, prepDeadline:prepEnabled?$('#prepDeadline').value:'', prepMode:prepEnabled&&$('#prepMode').value==='custom'?'custom':'auto', prepAutoEnabled:prepEnabled&&!!prepDraftAutoEnabled, prepDays:prepEnabled?Math.max(1,Number($('#prepDays').value)||1):5, prepWeekdaysOnly:prepEnabled&&!!$('#prepWeekdaysOnly').checked, prepIncludeDeadline:prepEnabled&&!!$('#prepIncludeDeadline').checked, prepDailyNotes:prepEnabled&&prepDraftAutoEnabled?Object.fromEntries(prepFormDates().map(d=>[d,String(prepDraftNotes[d]||'').trim()]).filter(([,v])=>v)):{}, prepTasks:prepEnabled?prepDraftTasks.map(x=>({...x})):[], prepDone:prepEnabled?{...(old?.prepDone||{})}:{}, prepMissed:prepEnabled?{...(old?.prepMissed||{})}:{}, prepMoves:prepEnabled?{...prepDraftMoves}:{},
    availabilityBlock:!['payment','anniversary'].includes($('#kind').value) && !!$('#availabilityBlock').checked,
    availabilityTargetCalId:(!['payment','anniversary'].includes($('#kind').value) && $('#availabilityBlock').checked)?($('#availabilityTarget').value||defaultAvailabilityTargetForSelectedCalendar()):'',
    repeat, repeatRule:repeat==='none'?null:getRepeatRule(), memo:$('#memo').value,
    checklist, checklistDoneByDate, orderByDate:old?.orderByDate||{},
    done:old?.done||false, doneDates:old?.doneDates||[], excludedDates:old?.excludedDates||[], fixedId:old?.fixedId||null
  };
  if(!obj.title) return;
  if(isRecurringEdit){
    // Form date denotes clicked occurrence, NOT the recurrence's original anchor.
    // The existing scoped-edit helpers expect a shifted series anchor instead.
    obj.date=shiftedDateString(old.date,recurringDelta);
    obj.endDate=shiftedDateString(old.endDate||old.date,recurringDelta);
    if(repeat!=='none' && !changedRepeatRule){
      obj.repeatRule=recurringDelta?shiftRepeatRuleForAnchor(old,selectedOcc,chosenDate):structuredClone(old.repeatRule);
    }
  }
  if(checklist.length){
    const preview={...(old||{}),...obj};
    if(repeat==='none') obj.done=checklistProgress({...preview,_occurrenceStart:obj.date},obj.date).complete;
    else obj.doneDates=(obj.doneDates||[]).filter(date=>checklistProgress({...preview,_occurrenceStart:date},date).complete);
  }
  if(isRecurringEdit){
    requestRepeatEditScope(old,obj,chosenDate,changedRepeatRule);
    return;
  }
  if(id) state.events[state.events.findIndex(x=>x.id===id)]={...old,...obj}; else state.events.push(obj);
  activeEventOccurrence=null; closeDialog($('#eventDlg')); save();
};
$('#editOccurrenceOnly').onclick=()=>{
  const p=pendingRepeatEdit, old=p&&state.events.find(x=>x.id===p.id); if(!p||!old) return;
  repeatEditOccurrenceOnly(old,p.obj,p.occ); finishRepeatEdit();
};
$('#editFutureSeries').onclick=()=>{
  const p=pendingRepeatEdit, old=p&&state.events.find(x=>x.id===p.id); if(!p||!old) return;
  if(p.occ<=old.date) applyWholeRecurringFormEdit(old,p.obj,p.occ,p.chosenDate,p.ruleEdited);
  else repeatEditFuture(old,p.obj,p.occ);
  finishRepeatEdit();
};
$('#editWholeSeries').onclick=()=>{
  const p=pendingRepeatEdit, old=p&&state.events.find(x=>x.id===p.id); if(!p||!old) return;
  applyWholeRecurringFormEdit(old,p.obj,p.occ,p.chosenDate,p.ruleEdited);
  finishRepeatEdit();
};
$('#cancelRepeatEdit').onclick=()=>{ pendingRepeatEdit=null; closeDialog($('#repeatEditDlg')); };
$('#cancelEvent').onclick=()=>{ activeEventOccurrence=null; closeDialog($('#eventDlg')); };
$('#eventDone').onchange=()=>{
  const id=$('#eid').value, ev=state.events.find(x=>x.id===id); if(!ev) return;
  const occ=activeEventOccurrence||ev.date;
  const want=!!$('#eventDone').checked;
  const now=isDone({...ev,_occurrenceStart:occ});
  if(now!==want) toggleDone(id,occ);
};
$('#importMemoChecklist').onclick=()=>{
  const lines=$('#memo').value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  if(!lines.length){ alert('메모에 가져올 줄이 없습니다.'); return; }
  if($('#checklistText').value.trim() && !confirm('현재 체크리스트를 메모 내용으로 바꿀까요?')) return;
  $('#checklistText').value=lines.join('\n');
};
function deleteEventAndUnlink(id){
  state.events=state.events.filter(x=>x.id!==id);
  for(const e of state.events){
    if(Array.isArray(e.carryoverHistory)) e.carryoverHistory=e.carryoverHistory.filter(r=>r.childId!==id);
  }
}
let pendingRepeatDeleteId='';
$('#deleteEvent').onclick=()=>{
  const id=$('#eid').value, ev=state.events.find(x=>x.id===id); if(!id||!ev) return;
  if((ev.repeat||'none')==='none'){
    if(confirm('이 일정을 삭제할까요?')){ deleteEventAndUnlink(id); activeEventOccurrence=null; closeDialog($('#eventDlg')); save(); }
    return;
  }
  pendingRepeatDeleteId=id;
  const occ=activeEventOccurrence||ev.date;
  $('#repeatDeleteInfo').textContent=`${occ} 반복 일정의 삭제 범위를 선택하세요.`;
  openDialog($('#repeatDeleteDlg'));
};
function finishRepeatDelete(){ pendingRepeatDeleteId=''; activeEventOccurrence=null; closeDialog($('#repeatDeleteDlg')); closeDialog($('#eventDlg')); save(); }
$('#deleteOccurrenceOnly').onclick=()=>{
  const ev=state.events.find(x=>x.id===pendingRepeatDeleteId); if(!ev) return;
  const occ=activeEventOccurrence||ev.date;
  ev.excludedDates=Array.isArray(ev.excludedDates)?ev.excludedDates:[];
  if(!ev.excludedDates.includes(occ)) ev.excludedDates.push(occ);
  ev.doneDates=(ev.doneDates||[]).filter(x=>x!==occ);
  finishRepeatDelete();
};
$('#deleteFuture').onclick=()=>{
  const ev=state.events.find(x=>x.id===pendingRepeatDeleteId); if(!ev) return;
  const occ=activeEventOccurrence||ev.date;
  if(occ<=ev.date){ deleteEventAndUnlink(ev.id); finishRepeatDelete(); return; }
  const rule=normalizedRule(ev); rule.endType='date'; rule.until=ds(add(parse(occ),-1));
  ev.repeatRule=rule; finishRepeatDelete();
};
$('#deleteSeries').onclick=()=>{ if(pendingRepeatDeleteId){ deleteEventAndUnlink(pendingRepeatDeleteId); finishRepeatDelete(); } };
$('#cancelRepeatDelete').onclick=()=>{ pendingRepeatDeleteId=''; closeDialog($('#repeatDeleteDlg')); };

$('#copyEvent').onclick=()=>{
  const id=$('#eid').value, src=state.events.find(x=>x.id===id); if(!src) return;
  const copy={...structuredClone(src),id:uid(),title:`${src.title} 복사`,done:false,doneDates:[],checklistDoneByDate:{},orderByDate:{},repeatOrder:0,fixedId:null,flexibleId:null,carryoverCount:0,carryoverFromDate:'',carryoverRootId:'',carryoverParentId:'',carryoverHistory:[]};
  state.events.push(copy); activeEventOccurrence=null; closeDialog($('#eventDlg')); save();
};

function openCarryoverDialog(){
  const id=$('#eid').value, src=state.events.find(x=>x.id===id); if(!src) return;
  const fromDate=activeEventOccurrence||src.date, toDate=ds(add(parse(fromDate),1));
  $('#carrySourceId').value=id; $('#carryOccurrence').value=fromDate; $('#carryTargetDate').textContent=toDate;
  setDurationInputs(src.hours||1,'carry');
  const skip=!!src.noDuration;
  $('#carryDurationBlock').classList.toggle('hidden',skip);
  $('#carryNoDurationNote').classList.toggle('hidden',!skip);
  openDialog($('#carryDlg'));
}
$('#carryEvent').onclick=()=>openCarryoverDialog();
$('#cancelCarry').onclick=()=>closeDialog($('#carryDlg'));
$('#carryForm').onsubmit=e=>{
  e.preventDefault();
  const sourceId=$('#carrySourceId').value, fromDate=$('#carryOccurrence').value;
  const src=state.events.find(x=>x.id===sourceId); if(!src||!fromDate) return;
  const skipDuration=!!src.noDuration;
  const remaining=skipDuration?0:getDurationInputs('carry');
  if(!skipDuration && remaining<=0){ alert('남은 예상 소요시간을 입력하세요.'); return; }
  const toDate=ds(add(parse(fromDate),1));
  const childId=uid(), nextCount=Math.max(0,Number(src.carryoverCount)||0)+1;
  const carriedChecklistDone=Array.isArray(src.checklistDoneByDate?.[fromDate])?[...src.checklistDoneByDate[fromDate]]:[];
  const child={
    ...structuredClone(src), id:childId, date:toDate, endDate:toDate, repeat:'none', repeatRule:null,
    hours:remaining, noDuration:skipDuration, done:false, doneDates:[], checklistDoneByDate:carriedChecklistDone.length?{[toDate]:carriedChecklistDone}:{}, orderByDate:{}, fixedId:null,
    carryoverCount:nextCount, carryoverFromDate:fromDate,
    carryoverRootId:src.carryoverRootId||src.id, carryoverParentId:src.id, carryoverHistory:[]
  };
  src.carryoverHistory=Array.isArray(src.carryoverHistory)?src.carryoverHistory:[];
  const old=src.carryoverHistory.find(r=>r.fromDate===fromDate);
  if(old && old.childId){ deleteEventAndUnlink(old.childId); src.carryoverHistory=Array.isArray(src.carryoverHistory)?src.carryoverHistory:[]; }
  src.carryoverHistory=src.carryoverHistory.filter(r=>r.fromDate!==fromDate);
  src.carryoverHistory.push({fromDate,toDate,childId,remainingHours:remaining});
  // v1.57: 다음날로 이월하는 순간, 원래 날짜의 일정은 완료 처리한다.
  // 반복일정이면 해당 발생일만 완료되고, 반복 시리즈의 다른 날짜에는 영향을 주지 않는다.
  setOccurrenceDoneState(src,fromDate,true);
  state.events.push(child);
  closeDialog($('#carryDlg')); closeDialog($('#eventDlg')); activeEventOccurrence=null; save();
};
$('#addPurchase').onclick=()=>openPurchase('');
let activePurchaseCompleteId='';
function openPurchaseComplete(id){
  const p=(state.purchases||[]).find(x=>x.id===id); if(!p) return;
  activePurchaseCompleteId=id;
  $('#purchaseCompleteName').textContent=purchaseDisplayTitle(p,false);
  $('#purchaseCompleteDate').value=ds(new Date());
  openDialog($('#purchaseCompleteDlg'));
}
function completePurchase(id,date){
  const p=(state.purchases||[]).find(x=>x.id===id); if(!p||!date) return;
  const calId=purchaseEventCalendarId();
  state.events.push({
    id:uid(),title:purchaseDisplayTitle(p,true),calId,date,endDate:date,allDay:true,start:'',end:'',hours:0,noDuration:true,
    kind:'todo',place:'',repeat:'none',repeatRule:null,memo:String(p.memo||''),important:false,done:true,doneDates:[],
    checklist:[],checklistDoneByDate:{},orderByDate:{},sourceType:'purchase',purchaseSourceId:String(p.id),purchaseDueDate:String(p.dueDate||'')
  });
  state.purchases=state.purchases.filter(x=>x.id!==id);
  activePurchaseCompleteId='';
  closeDialog($('#purchaseCompleteDlg'));
  save();
}
$('#purchaseCompleteForm').onsubmit=e=>{ e.preventDefault(); const date=$('#purchaseCompleteDate').value; if(!date) return; completePurchase(activePurchaseCompleteId,date); };
$('#cancelPurchaseComplete').onclick=()=>{ activePurchaseCompleteId=''; closeDialog($('#purchaseCompleteDlg')); };

$('#togglePurchase').onclick=()=>{ state.settings.fixedPanelsCollapsed.purchase=!state.settings.fixedPanelsCollapsed.purchase; save(); };
$('#purchaseForm').onsubmit=e=>{ e.preventDefault(); const id=$('#purchaseId').value, old=state.purchases.find(x=>x.id===id), maxOrder=(state.purchases||[]).reduce((m,p)=>Math.max(m,Number(p.order)||0),-1), obj={id:id||uid(),name:$('#purchaseName').value.trim(),qty:Math.max(1,Number($('#purchaseQty').value)||1),dueDate:$('#purchaseDueDate').value||'',memo:$('#purchaseMemo').value,done:false,createdAt:old?.createdAt||new Date().toISOString(),order:old?.order??(maxOrder+1)}; if(!obj.name) return; if(id) state.purchases[state.purchases.findIndex(x=>x.id===id)]=obj; else state.purchases.push(obj); closeDialog($('#purchaseDlg')); save(); };
$('#cancelPurchase').onclick=()=>closeDialog($('#purchaseDlg'));
$('#deletePurchase').onclick=()=>{ const id=$('#purchaseId').value; if(id&&confirm('이 구매항목을 삭제할까요?')){ state.purchases=state.purchases.filter(x=>x.id!==id); closeDialog($('#purchaseDlg')); save(); } };
$('#allDay').onchange=updateAllDayUI; $('#noDuration').onchange=()=>updateDurationMode(); $('#kind').onchange=updateKindUI; $('#availabilityBlock').onchange=updateAvailabilityBlockUI; $('#cal').onchange=()=>{ if($('#availabilityBlock').checked){ const v=defaultAvailabilityTargetForSelectedCalendar(); if([...$('#availabilityTarget').options].some(o=>o.value===v)) $('#availabilityTarget').value=v; } }; $('#start').onchange=updateDurationMode; $('#end').onchange=updateDurationMode; $('#endDate').onchange=()=>{ if($('#repeat').value!=='none') syncRepeatEndFromTop(); updateDurationMode(); }; $('#repeat').onchange=handleRepeatTypeChange;
$('#prepEnabled').onchange=()=>{ if($('#prepEnabled').checked){ if(!$('#eid').value){ prepDraftNotes={}; prepDraftTasks=[]; prepDraftMoves={}; prepDraftAutoEnabled=$('#prepMode')?.value!=='custom'; } $('#prepDeadline').value=$('#date').value||ds(cursor); $('#repeat').value='none'; updateRepeatUI(); } updatePrepUI(); };
$('#prepDeadline').onchange=()=>{ if($('#prepDeadline').value){ $('#date').value=$('#prepDeadline').value; $('#endDate').value=$('#prepDeadline').value; updateDurationMode(); } updatePrepRepeatRuleUI(); renderPrepDailyRows(); };
$('#prepMode').onchange=()=>{ collectPrepDailyNotes(); renderPrepDailyRows(); };
if($('#prepAutoEnabled')) $('#prepAutoEnabled').onchange=()=>{ collectPrepDailyNotes(); prepDraftAutoEnabled=!!$('#prepAutoEnabled').checked; renderPrepDailyRows(); };
$('#prepDays').oninput=()=>{ if($('#prepAutoEnabled')?.checked) prepDraftAutoEnabled=true; renderPrepDailyRows(); }; $('#prepWeekdaysOnly').onchange=renderPrepDailyRows; $('#prepIncludeDeadline').onchange=renderPrepDailyRows;
$('#addPrepOne').onclick=addPrepDateTask; $('#addPrepRepeat').onclick=addPrepRepeatTask;
$('#prepRepeatStartMode').onchange=updatePrepRepeatRuleUI; $('#prepRepeatType').onchange=updatePrepRepeatRuleUI; if($('#prepRepeatEndType')) $('#prepRepeatEndType').onchange=updatePrepRepeatRuleUI; if($('#prepRepeatStartDate')) $('#prepRepeatStartDate').onchange=updatePrepRepeatRuleUI; if($('#prepRepeatBeforeDays')) $('#prepRepeatBeforeDays').oninput=updatePrepRepeatRuleUI;
if($('#prepRuleList')) $('#prepRuleList').onclick=e=>{ const b=e.target.closest('[data-prep-rule-delete]'); if(!b) return; const id=b.dataset.prepRuleDelete; prepDraftTasks=prepDraftTasks.filter(x=>x.id!==id); renderPrepDailyRows(); };
if($('#prepDailyRows')){
  $('#prepDailyRows').onclick=e=>{
    const edit=e.target.closest('[data-prep-task-edit]');
    if(edit){ e.preventDefault(); loadPrepTaskIntoEditor(String(edit.dataset.prepTaskEdit||'')); return; }
    const b=e.target.closest('[data-prep-task-delete]'); if(!b) return;
    e.preventDefault();
    const id=String(b.dataset.prepTaskDelete||'');
    prepDraftTasks=prepDraftTasks.filter(x=>String(x.id)!==id);
    clearPrepMovesForTask(id);
    if(prepEditingTaskId===id) clearPrepTaskEditingState(true);
    renderPrepDailyRows();
  };
}

$('#date').onchange=()=>{
  const editing=state.events.find(x=>x.id===$('#eid').value);
  if(editing && (editing.repeat||'none')!=='none'){
    // Selected occurrence has its own date. Do not silently edit the repeat rule/end.
    updateDurationMode(); return;
  }
  if($('#prepEnabled').checked){ $('#prepDeadline').value=$('#date').value; $('#endDate').value=$('#date').value; renderPrepDailyRows(); }
  if(!$('#endDate').value || $('#endDate').value<$('#date').value) $('#endDate').value=$('#date').value;
  const d=parse($('#date').value), lp=lunarPartsFromSolar(d);
  $('#yearlyMonth').value=d.getMonth()+1; $('#yearlyDay').value=d.getDate();
  if($('#yearlyCalendar').value==='lunar' && lp){ $('#lunarMonth').value=lp.month; $('#lunarDay').value=lp.day; $('#lunarLeap').checked=!!lp.leap; }
  updateRepeatUI(); updateDurationMode();
}; $('#monthlyMode').onchange=updateMonthlyRepeatUI; $('#monthlyMonthEnd').onchange=updateMonthlyRepeatUI; $('#repeatEndType').onchange=updateRepeatEndUI; $('#repeatEndDate').onchange=()=>{ updateRepeatEndUI(); };
$('#yearlyCalendar').onchange=()=>{
  if($('#yearlyCalendar').value==='lunar'){
    const lp=lunarPartsFromSolar(parse($('#date').value||ds(new Date())));
    if(lp){ $('#lunarMonth').value=lp.month; $('#lunarDay').value=lp.day; $('#lunarLeap').checked=!!lp.leap; }
  }
  updateYearlyCalendarUI();
};
$('#lunarMonth').oninput=updateLunarYearlyHint; $('#lunarDay').oninput=updateLunarYearlyHint; $('#lunarLeap').onchange=updateLunarYearlyHint;

function parentOptionsFor(editId=''){
  const blocked=new Set(editId?[editId,...descendants(editId).map(c=>c.id)]:[]);
  return cals().filter(c=>!blocked.has(c.id)).map(c=>{
    const depth=calendarDepth(c.id), prefix=depth?`${'　'.repeat(Math.max(0,depth-1))}↳ `:'';
    return `<option value="${esc(c.id)}">${prefix}${esc(c.name)}</option>`;
  }).join('');
}
function updateCalColorHint(){
  const parentId=$('#cparent').value||'';
  $('#calColorHint').textContent=parentId?'상위 캘린더와 같은 색 계열에서 밝기·채도만 달리해 구분합니다.':'기본 캘린더는 원하는 색상을 직접 선택하세요.';
  $('#suggestCalColor').disabled=!parentId;
}
function applySuggestedCalendarColor(){
  const parentId=$('#cparent').value||''; if(!parentId) return;
  $('#ccolor').value=suggestSubCalendarColor(parentId,$('#cid').value||'');
}
function updateCalendarCapacityMode(){
  const shared=!!($('#cparent')?.value||'');
  const field=document.querySelector('.weekdayCapacityField');
  if(field) field.classList.toggle('sharedFromParent',shared);
  document.querySelectorAll('[data-cap-dow],[data-cap-unknown]').forEach(el=>{
    if(shared) el.disabled=true;
    else if(el.matches('[data-cap-dow]')){
      const dow=el.dataset.capDow, chk=document.querySelector(`[data-cap-unknown="${dow}"]`);
      el.disabled=!!chk?.checked;
    }else el.disabled=false;
  });
  const note=$('#sharedCapacityNote'); if(note) note.classList.toggle('hidden',!shared);
  const hint=$('#capacityOwnHint'); if(hint) hint.classList.toggle('hidden',shared);
}
function openCal(id){
  const c=state.calendars.find(x=>x.id===id);
  $('#cid').value=c?.id||''; $('#cname').value=c?.name||''; $('#ccolor').value=c?.color||'#d9d9d9';
  $('#cparent').innerHTML=`<option value="">없음 (기본 캘린더)</option>${parentOptionsFor(c?.id||'')}`;
  $('#cparent').value=c?.parentId||'';
  $('#corder').value=c?.order||state.calendars.length+1; $('#cperiod').value=c?.period||'오전';
  for(const dow of [1,2,3,4,5,6,0]){
    const src=c?.capacityByDay?.[dow]??c?.capacityByDay?.[String(dow)]??{hours:c?.capacity??8,unknown:!!c?.capacityUnknown};
    const inp=document.querySelector(`[data-cap-dow="${dow}"]`), chk=document.querySelector(`[data-cap-unknown="${dow}"]`);
    if(inp){ inp.value=Number(src.hours)||0; inp.disabled=!!src.unknown; }
    if(chk) chk.checked=!!src.unknown;
  }
  updateCalColorHint();
  updateCalendarCapacityMode();
  $('#deleteCal').style.visibility=c?'visible':'hidden'; openDialog($('#calDlg'));
}
$('#cparent').onchange=()=>{
  updateCalColorHint();
  updateCalendarCapacityMode();
  // 새 부속캘린더를 만들 때만 자동 적용합니다. 기존 캘린더의 수동 색상은 임의로 덮어쓰지 않습니다.
  if(!$('#cid').value && $('#cparent').value) applySuggestedCalendarColor();
};
$('#suggestCalColor').onclick=applySuggestedCalendarColor;
document.querySelectorAll('[data-cap-unknown]').forEach(chk=>chk.onchange=()=>{ if($('#cparent')?.value) return; const dow=chk.dataset.capUnknown, inp=document.querySelector(`[data-cap-dow="${dow}"]`); if(inp) inp.disabled=chk.checked; });
$('#calForm').onsubmit=e=>{
  e.preventDefault();
  const id=$('#cid').value, parentId=$('#cparent').value||'';
  if(id && (parentId===id || descendants(id).some(c=>c.id===parentId))){ alert('자기 자신 또는 자신의 부속캘린더를 상위 캘린더로 지정할 수 없습니다.'); return; }
  const capacityByDay=Object.fromEntries([0,1,2,3,4,5,6].map(d=>{ const inp=document.querySelector(`[data-cap-dow="${d}"]`), chk=document.querySelector(`[data-cap-unknown="${d}"]`); return [d,{hours:Number(inp?.value)||0,unknown:!!chk?.checked}]; }));
  const known=[0,1,2,3,4,5,6].map(d=>capacityByDay[d]).filter(x=>!x.unknown), avg=known.length?known.reduce((a,x)=>a+x.hours,0)/known.length:0;
  const obj={id:id||uid(),name:$('#cname').value.trim(),color:$('#ccolor').value,order:Number($('#corder').value)||1,period:$('#cperiod').value,capacity:avg,capacityUnknown:known.length===0,capacityByDay,parentId};
  if(id) state.calendars[state.calendars.findIndex(x=>x.id===id)]=obj; else state.calendars.push(obj);
  closeDialog($('#calDlg')); save();
};
$('#cancelCal').onclick=()=>closeDialog($('#calDlg'));
$('#deleteCal').onclick=()=>{
  const id=$('#cid').value; if(!id) return;
  if(state.calendars.length<=1){ alert('캘린더는 최소 1개가 필요합니다.'); return; }
  const target=state.calendars.find(c=>c.id===id), kids=directChildren(id);
  const msg=kids.length?`이 캘린더의 일정·고정업무·시간날때 업무를 삭제할까요? 부속캘린더 ${kids.length}개는 한 단계 위로 이동되어 유지됩니다.`:'이 캘린더와 포함된 일정·고정업무·시간날때 업무를 모두 삭제할까요?';
  if(confirm(msg)){
    const newParent=target?.parentId||'';
    kids.forEach(c=>c.parentId=newParent);
    state.calendars=state.calendars.filter(x=>x.id!==id); state.events=state.events.filter(x=>x.calId!==id); state.fixed=state.fixed.filter(x=>x.calId!==id); state.flexible=(state.flexible||[]).filter(x=>x.calId!==id);
    state.settings.hiddenCalendars=(state.settings.hiddenCalendars||[]).filter(x=>x!==id); closeDialog($('#calDlg')); save();
  }
};

function openFixed(id){
  const f=state.fixed.find(x=>x.id===id);
  $('#fixedTitle').textContent=f?'날짜 지정 배치 업무 수정':'날짜 지정 배치 업무 추가';
  $('#fid').value=f?.id||''; $('#fname').value=f?.name||''; $('#fimportant').checked=!!f?.important; $('#fcal').value=f?.calId||cals()[0]?.id||'';
  setDurationInputs(f?.hours??1,'f'); $('#fnoDuration').checked=!!f?.noDuration; updateDurationUI('f'); $('#fmemo').value=f?.memo||''; $('#fchecklistText').value=(f?.checklist||[]).map(x=>x.text).join('\n'); $('#deleteFixed').style.visibility=f?'visible':'hidden'; openDialog($('#fixedDlg'));
}
$('#fixedForm').onsubmit=e=>{
  e.preventDefault(); const id=$('#fid').value, old=state.fixed.find(x=>x.id===id), obj={id:id||uid(),name:$('#fname').value.trim(),important:$('#fimportant').checked,calId:$('#fcal').value,hours:getDurationInputs('f'),noDuration:$('#fnoDuration').checked,memo:$('#fmemo').value,checklist:checklistFromText($('#fchecklistText').value,old?.checklist||[])};
  if(id) state.fixed[state.fixed.findIndex(x=>x.id===id)]=obj; else state.fixed.push(obj); closeDialog($('#fixedDlg')); save();
};
$('#fnoDuration').onchange=()=>updateDurationUI('f');
$('#cancelFixed').onclick=()=>closeDialog($('#fixedDlg'));
$('#deleteFixed').onclick=()=>{ const id=$('#fid').value; if(id&&confirm('이 고정업무를 삭제할까요?')){state.fixed=state.fixed.filter(x=>x.id!==id);closeDialog($('#fixedDlg'));save();} };

function openFlexible(id){
  const f=(state.flexible||[]).find(x=>x.id===id);
  $('#flexibleTitle').textContent=f?'시간날때 업무 수정':'시간날때 업무 추가';
  $('#flexid').value=f?.id||''; $('#flexname').value=f?.name||''; $('#fleximportant').checked=!!f?.important; $('#flexcal').value=f?.calId||cals()[0]?.id||'';
  setDurationInputs(f?.hours??1,'flex'); $('#flexnoDuration').checked=!!f?.noDuration; updateDurationUI('flex'); $('#flexmemo').value=f?.memo||''; $('#flexchecklistText').value=(f?.checklist||[]).map(x=>x.text).join('\n');
  $('#deleteFlexible').style.visibility=f?'visible':'hidden'; openDialog($('#flexibleDlg'));
}
$('#flexibleForm').onsubmit=e=>{
  e.preventDefault(); const id=$('#flexid').value;
  const old=state.flexible.find(x=>x.id===id);
  const obj={id:id||uid(),name:$('#flexname').value.trim(),important:$('#fleximportant').checked,calId:$('#flexcal').value,hours:getDurationInputs('flex'),noDuration:$('#flexnoDuration').checked,memo:$('#flexmemo').value,checklist:checklistFromText($('#flexchecklistText').value,old?.checklist||[])};
  if(!obj.name) return;
  state.flexible=Array.isArray(state.flexible)?state.flexible:[];
  if(id) state.flexible[state.flexible.findIndex(x=>x.id===id)]=obj; else state.flexible.push(obj);
  closeDialog($('#flexibleDlg')); save();
};
$('#flexnoDuration').onchange=()=>updateDurationUI('flex');
$('#cancelFlexible').onclick=()=>closeDialog($('#flexibleDlg'));
$('#deleteFlexible').onclick=()=>{
  const id=$('#flexid').value; if(!id) return;
  if(confirm('이 시간날때 업무를 삭제할까요? 이미 달력에 배치된 일정과 완료기록은 그대로 남습니다.')){
    state.flexible=(state.flexible||[]).filter(x=>x.id!==id); closeDialog($('#flexibleDlg')); save();
  }
};

function openDiary(date){
  $('#diaryDate').value=date; $('#diaryTitle').textContent=`다이어리 · ${date}`; $('#diaryText').value=state.diary[date]?.text||'';
  $('#deleteDiary').style.visibility=state.diary[date]?.text?'visible':'hidden'; openDialog($('#diaryDlg'));
}
$('#diaryForm').onsubmit=e=>{ e.preventDefault(); const date=$('#diaryDate').value,text=$('#diaryText').value.trim(); if(text) state.diary[date]={text,updatedAt:new Date().toISOString()}; else delete state.diary[date]; closeDialog($('#diaryDlg')); save(); };
$('#cancelDiary').onclick=()=>closeDialog($('#diaryDlg'));
$('#deleteDiary').onclick=()=>{ const date=$('#diaryDate').value; if(state.diary[date]&&confirm('이 날짜의 다이어리를 삭제할까요?')){delete state.diary[date];closeDialog($('#diaryDlg'));save();} };

function renderSearch(){
  const q=$('#searchInput').value.trim().toLowerCase(); if(!q){$('#searchResults').innerHTML='<div class="empty">검색어를 입력하세요.</div>';return;}
  const results=[];
  for(const e of state.events){ const hay=[e.title,e.memo,e.place,cal(e.calId).name,...checklistItems(e).map(x=>x.text),...Object.values(e.prepDailyNotes||{}),...(e.prepTasks||[]).map(x=>x.text)].join(' ').toLowerCase(); if(hay.includes(q)) results.push({type:'event',id:e.id,title:e.title,meta:`${e.date} · ${cal(e.calId).name}${e.prepEnabled?' · '+preparationSummary(e):''}`}); }
  for(const f of state.fixed){ const hay=[f.name,f.memo,cal(f.calId).name,...(f.checklist||[]).map(x=>x.text)].join(' ').toLowerCase(); if(hay.includes(q)) results.push({type:'fixed',id:f.id,title:f.name,meta:`고정업무 · ${cal(f.calId).name}`}); }
  for(const f of (state.flexible||[])){ const hay=[f.name,f.memo,cal(f.calId).name,...(f.checklist||[]).map(x=>x.text)].join(' ').toLowerCase(); if(hay.includes(q)) results.push({type:'flexible',id:f.id,title:f.name,meta:`시간날때 업무 · ${cal(f.calId).name}`}); }
  for(const [date,d] of Object.entries(state.diary)){ if((d.text||'').toLowerCase().includes(q)) results.push({type:'diary',id:date,title:`다이어리 ${date}`,meta:d.text.slice(0,60)}); }
  $('#searchResults').innerHTML=results.slice(0,100).map((r,i)=>`<div class="searchResult" data-idx="${i}"><b>${esc(r.title)}</b><small>${esc(r.meta)}</small></div>`).join('')||'<div class="empty">검색 결과가 없습니다.</div>';
  $$('.searchResult').forEach(x=>x.onclick=()=>{const r=results[Number(x.dataset.idx)];closeDialog($('#searchDlg'));if(r.type==='event')openEvent(null,r.id);else if(r.type==='fixed')openFixed(r.id);else if(r.type==='flexible')openFlexible(r.id);else openDiary(r.id);});
}
$('#searchBtn').onclick=()=>{ $('#searchInput').value=''; $('#searchResults').innerHTML='<div class="empty">검색어를 입력하세요.</div>'; openDialog($('#searchDlg')); setTimeout(()=>$('#searchInput').focus(),50); };
$('#searchInput').oninput=renderSearch; $('#closeSearch').onclick=()=>closeDialog($('#searchDlg')); $('#searchForm').onsubmit=e=>e.preventDefault();

function setFixedAddMenu(open){
  const menu=$('#fixedAddMenu'), btn=$('#addFixed'); if(!menu||!btn) return;
  const show=typeof open==='boolean'?open:menu.classList.contains('hidden');
  menu.classList.toggle('hidden',!show); btn.setAttribute('aria-expanded',show?'true':'false');
}
$('#checkAllCals').onclick=()=>{ state.settings.hiddenCalendars=[]; save(); };
$('#uncheckAllCals').onclick=()=>{ state.settings.hiddenCalendars=state.calendars.map(c=>c.id); save(); };
$('#addCal').onclick=()=>openCal();
$('#addFixed').onclick=e=>{ e.stopPropagation(); setFixedAddMenu(); };
$('#addRecurringFixed').onclick=e=>{ e.stopPropagation(); setFixedAddMenu(false); openEvent(ds(cursor),null,{preset:'autoRecurring'}); };
$('#addManualFixed').onclick=e=>{ e.stopPropagation(); setFixedAddMenu(false); openFixed(); };
$('#fixedAddMenu').onclick=e=>e.stopPropagation();
document.addEventListener('click',e=>{ if(!e.target.closest('.fixedAddWrap')) setFixedAddMenu(false); });
document.addEventListener('keydown',e=>{ if(e.key==='Escape' && !$('#fixedAddMenu').classList.contains('hidden')) setFixedAddMenu(false); });
$('#addFlexible').onclick=()=>openFlexible();
$('#toggleFlexible').onclick=()=>{ state.settings.fixedPanelsCollapsed=state.settings.fixedPanelsCollapsed||{}; state.settings.fixedPanelsCollapsed.flexible=!state.settings.fixedPanelsCollapsed.flexible; save(); };
$('#addPayment').onclick=()=>openEvent(ds(cursor),null,{preset:'payment'});
$('#togglePayment').onclick=()=>{ state.settings.fixedPanelsCollapsed=state.settings.fixedPanelsCollapsed||{}; state.settings.fixedPanelsCollapsed.payment=!state.settings.fixedPanelsCollapsed.payment; save(); };
$('#prev').onclick=()=>{ const step=view==='week'?7:view==='2week'?14:view==='3week'?21:view==='4week'?28:1; cursor=(view==='month'||view==='diary')?new Date(cursor.getFullYear(),cursor.getMonth()-1,1):add(cursor,-step); mobileSelectedDate=''; render(); };
$('#next').onclick=()=>{ const step=view==='week'?7:view==='2week'?14:view==='3week'?21:view==='4week'?28:1; cursor=(view==='month'||view==='diary')?new Date(cursor.getFullYear(),cursor.getMonth()+1,1):add(cursor,step); mobileSelectedDate=''; render(); };
$('#today').onclick=()=>{cursor=new Date();mobileSelectedDate=ds(new Date());render();};

// v1.79: 모바일에서는 ‹ 오늘 › 날짜이동 묶음을 보기 버튼 줄의 맨 오른쪽으로 이동한다.
// 데스크톱으로 돌아오면 기존 nav 위치로 복원해 PC 배치는 그대로 유지한다.
function syncDateNavPlacement(){
  const group=document.querySelector('.dateNavButtons');
  const views=document.querySelector('header .views');
  const nav=document.querySelector('header nav');
  const jump=$('#jumpDate');
  if(!group||!views||!nav) return;
  if(window.matchMedia('(max-width:760px)').matches){
    if(group.parentElement!==views) views.appendChild(group);
  }else if(group.parentElement!==nav){
    nav.insertBefore(group,jump||nav.firstChild);
  }
}
function syncSaveControlsPlacement(){
  const header=document.querySelector('header');
  const views=document.querySelector('header .views');
  const badge=$('#saveBadge');
  const saveBtn=$('#manualSaveBtn');
  const naver=$('#naverMailShortcut');
  const menu=$('#sidebarToggle');
  if(!header||!views||!badge||!saveBtn) return;
  if(window.matchMedia('(max-width:760px)').matches){
    if(badge.parentElement!==header) header.insertBefore(badge,menu||header.children[1]||null);
    if(saveBtn.parentElement!==header) header.insertBefore(saveBtn,menu||header.children[1]||null);
  }else if(naver){
    if(badge.parentElement!==views) views.insertBefore(badge,naver);
    if(saveBtn.parentElement!==views) views.insertBefore(saveBtn,naver);
  }
}
function syncHeaderResponsivePlacement(){
  syncDateNavPlacement();
  syncSaveControlsPlacement();
}
syncHeaderResponsivePlacement();
window.addEventListener('resize',syncHeaderResponsivePlacement,{passive:true});
$('#jumpDate').onchange=e=>{ if(e.target.value){cursor=parse(e.target.value);render();} };
$('#jumpDateBtn')?.addEventListener('click',()=>{ const input=$('#jumpDate'); if(!input) return; input.value=ds(cursor||new Date()); if(typeof input.showPicker==='function') input.showPicker(); else input.click(); });
$('#diaryMainShortcut').onclick=()=>{ if(view==='diary'){ view=lastScheduleView||'week'; } else { lastScheduleView=view; view='diary'; } render(); };
const VIEW_LABELS={week:'주','2week':'2주','3week':'3주','4week':'4주',month:'월',day:'일',list:'목록',diary:'다이어리'};
function setCurrentViewButtonLabel(){
  $$('.primaryViewButtons [data-view]').forEach(btn=>{
    const target=btn.dataset.view;
    btn.classList.toggle('on',target===view);
    if(target==='week'||target==='day'){
      btn.title=`${VIEW_LABELS[target]} 보기 · 더블클릭: 구역 높이 자동맞춤 · 오른쪽 클릭: 3주·4주·목록`;
    }else{
      btn.title=`${VIEW_LABELS[target]} 보기 · 오른쪽 클릭: 3주·4주·목록`;
    }
    btn.setAttribute('aria-label',btn.title);
  });
  $$('#currentViewMenu [data-view]').forEach(btn=>btn.classList.toggle('on',btn.dataset.view===view));
}
function setCurrentViewMenu(open,anchor=null){
  const menu=$('#currentViewMenu'), wrap=$('#currentViewWrap');
  if(!menu||!wrap) return;
  menu.classList.toggle('hidden',!open);
  wrap.setAttribute('aria-expanded', open?'true':'false');
  if(open && anchor){
    const wr=wrap.getBoundingClientRect(), ar=anchor.getBoundingClientRect();
    const center=(ar.left+ar.right)/2-wr.left;
    menu.style.setProperty('--view-menu-anchor',`${Math.max(18,Math.min(wr.width-18,center))}px`);
  }
}
function toggleCurrentViewMenu(force,anchor=null){
  const menu=$('#currentViewMenu'); if(!menu) return;
  const open=(typeof force==='boolean')?force:menu.classList.contains('hidden');
  setCurrentViewMenu(open,anchor);
}
function activateViewButton(next){
  setCurrentViewMenu(false);
  if(next==='week' && view==='week' && !isMobileSchedule()){
    state.settings.weekViewMode=state.settings.weekViewMode==='compact'?'detailed':'compact';
    lastScheduleView='week';
    save();
    return;
  }
  view=next; if(view!=='diary') lastScheduleView=view; render();
}
function autoFitFromViewButton(next){
  if(isMobileSchedule()) return;
  if(next==='week'){
    if(view!=='week' || state.settings.weekViewMode==='compact'){
      view='week'; state.settings.weekViewMode='detailed'; lastScheduleView='week';
      render();
      runScheduleAutoFitAfterLayout();
    }else{
      fitAllScheduleLaneHeights();
      setTimeout(()=>fitAllScheduleLaneHeights(),90);
      setTimeout(()=>fitAllScheduleLaneHeights(),220);
    }
    return;
  }
  if(next==='day'){
    if(view!=='day'){
      view='day'; lastScheduleView='day'; render();
      requestAnimationFrame(()=>requestAnimationFrame(()=>{ fitAllDayLaneHeights(); setTimeout(()=>fitAllDayLaneHeights(),80); }));
    }else{
      fitAllDayLaneHeights();
      setTimeout(()=>fitAllDayLaneHeights(),80);
    }
  }
}
$$('.primaryViewButtons [data-view]').forEach(b=>{
  const next=b.dataset.view;
  b.addEventListener('contextmenu',e=>{ e.preventDefault(); e.stopPropagation(); toggleCurrentViewMenu(undefined,b); });
  if(next==='week'||next==='day'){
    b.onclick=e=>{
      e.preventDefault();
      if(isMobileSchedule()){ activateViewButton(next); return; }
      if(e.detail>1) return;
      clearTimeout(b.__singleViewTimer);
      b.__singleViewTimer=setTimeout(()=>{ b.__singleViewTimer=null; activateViewButton(next); },460);
    };
    b.ondblclick=e=>{
      e.preventDefault(); e.stopPropagation();
      clearTimeout(b.__singleViewTimer); b.__singleViewTimer=null;
      autoFitFromViewButton(next);
    };
  }else{
    b.onclick=e=>{ e.preventDefault(); activateViewButton(next); };
  }
});
$('#extraViewMenuToggle')?.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();toggleCurrentViewMenu(undefined,e.currentTarget);e.currentTarget.setAttribute('aria-expanded',String(!$('#currentViewMenu')?.classList.contains('hidden')));});
$('#currentViewWrap')?.addEventListener('contextmenu',e=>{
  if(e.target.closest('.primaryViewBtn')) return;
  e.preventDefault();
  toggleCurrentViewMenu(undefined,$('.primaryViewButtons .on')||$('.primaryViewBtn'));
});
document.addEventListener('click',e=>{ if(!e.target.closest('#currentViewWrap')) setCurrentViewMenu(false); });
document.addEventListener('keydown',e=>{ if(e.key==='Escape') setCurrentViewMenu(false); });
$$('#currentViewMenu [data-view]').forEach(b=>{
  b.onclick=e=>{ e.preventDefault(); activateViewButton(b.dataset.view); };
});
$('#sidebarToggle').onclick=()=>$('#sidebar').classList.toggle('open');
$('#main').addEventListener('click',()=>{ if(isMobileSidebar()) $('#sidebar').classList.remove('open'); });
initSidebarResizer();

$('#settingsBtn').onclick=()=>{ $('#accountEmail').textContent=currentUser?.email||'-'; updateSaveIndicators(); if(!syncReady) $('#syncState').textContent='연결 확인 중'; openDialog($('#settingsDlg')); };
$('#closeSettings').onclick=()=>closeDialog($('#settingsDlg'));
$('#logoutBtn').onclick=async()=>{closeDialog($('#settingsDlg')); await signOut(auth);};

function authMessage(msg,type=''){ const el=$('#authState'); el.textContent=msg; el.className=`statusText ${type}`; }
function translateAuthError(e){
  const code=e?.code||'';
  if(code.includes('invalid-credential')||code.includes('wrong-password')||code.includes('user-not-found')) return '이메일 또는 비밀번호가 맞지 않습니다.';
  if(code.includes('email-already-in-use')) return '이미 가입된 이메일입니다.';
  if(code.includes('weak-password')) return '비밀번호는 6자 이상으로 입력하세요.';
  if(code.includes('invalid-email')) return '이메일 형식을 확인하세요.';
  if(code.includes('too-many-requests')) return '시도가 너무 많습니다. 잠시 후 다시 시도하세요.';
  return e?.message||'처리 중 오류가 발생했습니다.';
}
$('#authForm').onsubmit=async e=>{
  e.preventDefault(); authMessage('로그인 중…');
  try{ await signInWithEmailAndPassword(auth,$('#authEmail').value.trim(),$('#authPassword').value); authMessage(''); }
  catch(err){ authMessage(translateAuthError(err),'error'); }
};
$('#signupBtn').onclick=async()=>{
  if(!$('#authEmail').reportValidity()||!$('#authPassword').reportValidity()) return;
  authMessage('회원가입 중…');
  try{ await createUserWithEmailAndPassword(auth,$('#authEmail').value.trim(),$('#authPassword').value); authMessage(''); }
  catch(err){ authMessage(translateAuthError(err),'error'); }
};
$('#resetPasswordBtn').onclick=async()=>{
  const email=$('#authEmail').value.trim(); if(!email){authMessage('먼저 이메일을 입력하세요.','error');return;}
  try{await sendPasswordResetEmail(auth,email);authMessage('비밀번호 재설정 메일을 보냈습니다.','ok');}
  catch(err){authMessage(translateAuthError(err),'error');}
};
$('#authDlg').addEventListener('cancel',e=>e.preventDefault());

async function bindUser(user){
  currentUser=user; syncReady=false; applyingRemote=false; localDirty=false; writeInFlight=false;
  lastFirebaseSavedAt=null;
  clearTimeout(saveTimer); saveTimer=null;
  if(unsubscribeDoc){unsubscribeDoc();unsubscribeDoc=null;}
  state=loadLocal(); render();
  $('#accountEmail').textContent=user.email||'';
  remoteRef=doc(db,'users',user.uid,'calendar','main');
  setSyncStatus('Firebase 최신 데이터 불러오는 중…','loading');
  try{
    let snap, serverFresh=true;
    try{
      snap=await getDocFromServer(remoteRef);
    }catch(serverErr){
      serverFresh=false;
      console.warn('Firebase server read failed, falling back to available cache/local state.',serverErr);
      try{ snap=await getDoc(remoteRef); }catch{ snap=null; }
    }
    if(snap?.exists()){
      applyingRemote=true;
      state=normalizeState(snap.data().state);
      lastFirebaseSavedAt=timestampToDate(snap.data().updatedAt) || null;
      saveLocal();
      applyingRemote=false;
      render();
      syncReady=serverFresh;
      if(serverFresh){
        setSyncStatus(`✓ Firebase 최신본 · ${lastFirebaseSavedAt?fmtDateTime(lastFirebaseSavedAt).split(' ')[1]:'확인됨'}`,'saved');
      }else{
        setSyncStatus('오프라인 · Firebase 캐시본 표시 중','offline');
      }
    }else if(snap && !snap.exists() && serverFresh){
      syncReady=true;
      await writeRemoteNow('save');
    }else{
      syncReady=false;
      setSyncStatus('오프라인 · 기기 저장본 표시 중','offline');
    }

    unsubscribeDoc=onSnapshot(remoteRef,{includeMetadataChanges:true},snap2=>{
      if(!snap2.exists()) return;
      if(snap2.metadata.hasPendingWrites){
        setSyncStatus('저장 중…','saving');
        return;
      }
      const remoteTime=timestampToDate(snap2.data().updatedAt) || new Date();
      lastFirebaseSavedAt=remoteTime;
      syncReady=true;
      if(!localDirty && !writeInFlight){
        const incoming=normalizeState(snap2.data().state);
        applyingRemote=true; state=incoming; saveLocal(); render(); applyingRemote=false;
      }
      setSyncStatus(`✓ Firebase 저장완료 · ${fmtDateTime(lastFirebaseSavedAt).split(' ')[1]}`,'saved');
      updateSaveIndicators();
    },err=>{console.error(err);syncReady=false;setSyncStatus('⚠ Firebase 동기화 오류','error');});
  }catch(err){
    console.error(err); syncReady=false; setSyncStatus('⚠ Firebase 연결 실패','error');
  }
}
onAuthStateChanged(auth,async user=>{
  if(user){
    closeDialog($('#authDlg')); $('#authPassword').value='';
    $('#cloudLoading').classList.remove('hidden');
    try{ await bindUser(user); } finally { $('#cloudLoading').classList.add('hidden'); }
  }else{
    currentUser=null;syncReady=false;remoteRef=null;lastFirebaseSavedAt=null;lastLocalSavedAt=null;localDirty=false;writeInFlight=false;
    if(unsubscribeDoc){unsubscribeDoc();unsubscribeDoc=null;}
    state=defaultState();render();authMessage('');setSyncStatus('로그인 필요','offline');openDialog($('#authDlg'));
  }
});


async function manualSaveNow(){
  if(!currentUser){ alert('먼저 로그인하세요.'); return; }
  saveLocal();
  const btn=$('#manualSaveBtn'), original=btn.innerHTML;
  btn.disabled=true; btn.textContent='…';
  try{
    if(!navigator.onLine){ setSyncStatus('오프라인 · 기기 저장완료','offline'); alert('인터넷 연결이 없어 기기에만 저장했습니다. 온라인이 된 뒤 다시 최신자료 저장을 눌러주세요.'); return; }
    if(!remoteRef){ alert('Firebase 연결이 아직 준비되지 않았습니다. 잠시 후 다시 눌러주세요.'); return; }
    const wasReady=syncReady; syncReady=true;
    const ok=await writeRemoteNow('manual');
    syncReady=wasReady || ok;
    if(ok){ btn.textContent='✓'; setTimeout(()=>{btn.innerHTML=original;},1200); }
    else alert('Firebase 저장에 실패했습니다. 인터넷 연결과 로그인 상태를 확인하세요.');
  }finally{
    btn.disabled=false;
    if(btn.textContent==='…') btn.innerHTML=original;
  }
}
$('#manualSaveBtn').onclick=manualSaveNow;

function downloadBackup(){
  if(!currentUser) return;
  const now=new Date();
  const payload={
    type:'my-calendar-backup',
    appVersion:'2.74',
    exportedAt:now.toISOString(),
    accountEmail:currentUser.email||'',
    state
  };
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  a.download=`캘린더_백업_${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function restoreBackupFile(file){
  if(!file) return;
  try{
    const raw=JSON.parse(await file.text());
    const candidate=raw?.state ?? raw?.data ?? raw;
    if(!candidate || typeof candidate!=='object' || !Array.isArray(candidate.calendars) || !Array.isArray(candidate.events)) throw new Error('invalid backup');
    const restored=normalizeState(candidate);
    if(!confirm('이 백업으로 현재 캘린더 데이터를 덮어쓸까요? 현재 Firebase 데이터도 같은 내용으로 변경됩니다.')) return;
    applyingRemote=true; state=restored; saveLocal(); render(); applyingRemote=false;
    if(syncReady && remoteRef){
      const ok=await writeRemoteNow('restore');
      if(ok) alert('백업을 복원하고 Firebase에 저장했습니다.');
      else alert('기기에는 복원했지만 Firebase 저장에 실패했습니다. 인터넷 연결을 확인하세요.');
    }else{
      localDirty=true;
      alert('기기에는 복원했습니다. Firebase가 다시 연결되면 저장 상태를 확인하세요.');
    }
  }catch(err){
    console.error(err); alert('올바른 캘린더 백업 파일이 아닙니다.');
  }finally{
    $('#restoreFile').value='';
  }
}
$('#downloadBackupBtn').onclick=downloadBackup;
$('#restoreBackupBtn').onclick=()=>$('#restoreFile').click();
$('#restoreFile').onchange=e=>restoreBackupFile(e.target.files?.[0]);

// Native dialog cancel/ESC never saves. Explicit cancel buttons above only close dialogs.
['eventDlg','repeatEditDlg','repeatDeleteDlg','repeatMoveDlg','carryDlg','calDlg','fixedDlg','diaryDlg','searchDlg','settingsDlg','recurringPreviewDlg'].forEach(id=>{
  const d=$(`#${id}`); d.addEventListener('cancel',()=>{});
});

loadHolidayData();
render();
