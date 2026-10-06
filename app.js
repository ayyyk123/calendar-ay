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
  version: '1.89',
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
  settings: { hiddenCalendars: [], fixedPanelsCollapsed: { recurring:false, manual:false, flexible:false, purchase:false, payment:false }, sidebarCalendarGroupsCollapsed: { recurring:{}, manual:{}, flexible:{}, payment:{} }, sidebarSectionOrder:['calendar','fixed','flexible','purchase','payment','dday','diary'], sidebarSectionsCollapsed:{}, laneHeights:{}, laneCollapsed:{}, laneLabelWidth:30, mobileSectionsCollapsed:{}, dayLaneHeights:{}, workloadRange:'week', weekViewMode:'detailed', selectedDdayId:'' }
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
let calendarFocusId = null;
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
    let btn=head.querySelector('.sidebarSectionToggle');
    if(!btn){
      btn=document.createElement('button'); btn.type='button'; btn.className='sidebarSectionToggle';
      btn.dataset.sectionToggle=id; btn.setAttribute('aria-label','메뉴 접기/펴기');
      const titleWrap=head.querySelector('.secTitleWithGrip');
      if(titleWrap){ const grip=titleWrap.querySelector('.sidebarSectionGrip'); if(grip) grip.after(btn); else titleWrap.prepend(btn); }
      else head.prepend(btn);
    }
    const collapsed=sidebarSectionCollapsed(id);
    sec.classList.toggle('sidebarSectionCollapsed',collapsed);
    btn.textContent=collapsed?'▸':'▾'; btn.title=collapsed?'메뉴 펼치기':'메뉴 접기'; btn.setAttribute('aria-expanded',collapsed?'false':'true');
    btn.onclick=e=>{
      e.preventDefault(); e.stopPropagation();
      state.settings.sidebarSectionsCollapsed=state.settings.sidebarSectionsCollapsed||{};
      state.settings.sidebarSectionsCollapsed[id]=!sidebarSectionCollapsed(id);
      save();
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
    version: '1.89',
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
      prepDays:Math.max(1,Number(e.prepDays)||5),
      prepWeekdaysOnly:!!e.prepWeekdaysOnly,
      prepIncludeDeadline:!!e.prepIncludeDeadline,
      prepDailyNotes:(e.prepDailyNotes&&typeof e.prepDailyNotes==='object')?Object.fromEntries(Object.entries(e.prepDailyNotes).map(([k,v])=>[String(k),String(v??'')])):{},
      prepDone:(e.prepDone&&typeof e.prepDone==='object')?Object.fromEntries(Object.entries(e.prepDone).filter(([,v])=>!!v).map(([k])=>[String(k),true])):{},
      prepMoves:(e.prepMoves&&typeof e.prepMoves==='object')?Object.fromEntries(Object.entries(e.prepMoves).filter(([,v])=>typeof v==='string'&&v).map(([k,v])=>[String(k),String(v)])):{},
      prepTasks:Array.isArray(e.prepTasks)?e.prepTasks.filter(x=>x&&['date','weekly'].includes(x.type)).map((x,i)=>({
        id:String(x.id||`prep-${i}-${uid()}`), type:x.type, text:String(x.text||'').trim(),
        date:x.type==='date'?String(x.date||''):'',
        startDate:x.type==='weekly'?String(x.startDate||''):'',
        weekday:x.type==='weekly'?Math.max(0,Math.min(6,Number(x.weekday)||0)):0
      })).filter(x=>x.text&&(x.type==='date'?x.date:x.startDate)):[],
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
    purchases: Array.isArray(s.purchases) ? s.purchases.filter(p=>p && p.id && p.name).map((p,i)=>({id:String(p.id),name:String(p.name),qty:Math.max(1,Number(p.qty)||1),memo:String(p.memo||''),done:!!p.done,createdAt:String(p.createdAt||''),order:Number.isFinite(Number(p.order))?Number(p.order):i})) : [],
    diary: s.diary && typeof s.diary === 'object' ? s.diary : {},
    actualWork: (s.actualWork && typeof s.actualWork==='object') ? Object.fromEntries(Object.entries(s.actualWork).map(([date,rows])=>[
      String(date),
      (rows && typeof rows==='object') ? Object.fromEntries(Object.entries(rows).map(([calId,v])=>[String(calId),Math.max(0,Math.min(24,Number(v)||0))])) : {}
    ])) : {},
    settings: {
      hiddenCalendars: Array.isArray(s.settings?.hiddenCalendars) ? s.settings.hiddenCalendars : [],
      fixedPanelsCollapsed: {
        recurring: !!s.settings?.fixedPanelsCollapsed?.recurring,
        manual: !!s.settings?.fixedPanelsCollapsed?.manual,
        flexible: !!s.settings?.fixedPanelsCollapsed?.flexible,
        purchase: !!s.settings?.fixedPanelsCollapsed?.purchase,
        payment: !!s.settings?.fixedPanelsCollapsed?.payment
      },
      sidebarCalendarGroupsCollapsed: {
        recurring: (s.settings?.sidebarCalendarGroupsCollapsed?.recurring && typeof s.settings.sidebarCalendarGroupsCollapsed.recurring==='object') ? {...s.settings.sidebarCalendarGroupsCollapsed.recurring} : {},
        manual: (s.settings?.sidebarCalendarGroupsCollapsed?.manual && typeof s.settings.sidebarCalendarGroupsCollapsed.manual==='object') ? {...s.settings.sidebarCalendarGroupsCollapsed.manual} : {},
        flexible: (s.settings?.sidebarCalendarGroupsCollapsed?.flexible && typeof s.settings.sidebarCalendarGroupsCollapsed.flexible==='object') ? {...s.settings.sidebarCalendarGroupsCollapsed.flexible} : {},
        payment: (s.settings?.sidebarCalendarGroupsCollapsed?.payment && typeof s.settings.sidebarCalendarGroupsCollapsed.payment==='object') ? {...s.settings.sidebarCalendarGroupsCollapsed.payment} : {}
      },
      sidebarSectionOrder: normalizeSidebarSectionOrder(s.settings?.sidebarSectionOrder),
      sidebarSectionsCollapsed: (s.settings?.sidebarSectionsCollapsed && typeof s.settings.sidebarSectionsCollapsed==='object') ? {...s.settings.sidebarSectionsCollapsed} : {},
      mobileSectionsCollapsed: (s.settings?.mobileSectionsCollapsed && typeof s.settings.mobileSectionsCollapsed==='object') ? {...s.settings.mobileSectionsCollapsed} : {},
      dayCalendarGroupsCollapsed: (s.settings?.dayCalendarGroupsCollapsed && typeof s.settings.dayCalendarGroupsCollapsed==='object') ? {...s.settings.dayCalendarGroupsCollapsed} : {},
      laneHeights: (s.settings?.laneHeights && typeof s.settings.laneHeights==='object') ? Object.fromEntries(Object.entries(s.settings.laneHeights).map(([k,v])=>[k,Math.max(44,Math.min(480,Number(v)||0))]).filter(([,v])=>v)) : {},
      dayLaneHeights: (s.settings?.dayLaneHeights && typeof s.settings.dayLaneHeights==='object') ? Object.fromEntries(Object.entries(s.settings.dayLaneHeights).map(([k,v])=>[k,Math.max(52,Math.min(640,Number(v)||0))]).filter(([,v])=>v)) : {},
      laneCollapsed: (s.settings?.laneCollapsed && typeof s.settings.laneCollapsed==='object') ? {...s.settings.laneCollapsed} : {},
      laneLabelWidth: Math.max(22,Math.min(120,Number(s.settings?.laneLabelWidth)||30)),
      workloadRange: ['week','month','year'].includes(s.settings?.workloadRange) ? s.settings.workloadRange : 'week',
      weekViewMode: s.settings?.weekViewMode==='compact' ? 'compact' : 'detailed',
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
function focusedCalendarIds(){
  if(!calendarFocusId) return null;
  const focus=state.calendars.find(c=>c.id===calendarFocusId);
  if(!focus){ calendarFocusId=null; return null; }
  return new Set([focus.id,...descendants(focus.id).map(c=>c.id)]);
}
function focusSuffix(){
  const focus=calendarFocusId?state.calendars.find(c=>c.id===calendarFocusId):null;
  return focus?` · ${calendarPath(focus.id)}만 보기`:'';
}
function compactFocusSuffix(){
  const focus=calendarFocusId?state.calendars.find(c=>c.id===calendarFocusId):null;
  return focus?` · ${focus.name}`:'';
}
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

let lunarFormatter=null;
try{
  lunarFormatter=new Intl.DateTimeFormat('ko-KR-u-ca-chinese',{calendar:'chinese',year:'numeric',month:'long',day:'numeric'});
}catch(_e){ lunarFormatter=null; }
const lunarSolarCache=new Map();
function lunarPartsFromSolar(date){
  if(!lunarFormatter || !(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  try{
    const parts=lunarFormatter.formatToParts(date);
    const year=Number(parts.find(p=>p.type==='relatedYear')?.value||'');
    const monthText=parts.find(p=>p.type==='month')?.value||'';
    const day=Number(parts.find(p=>p.type==='day')?.value||'');
    const month=Number((monthText.match(/\d+/)||[])[0]||'');
    if(!year || !month || !day) return null;
    return {year,month,day,leap:monthText.includes('윤')};
  }catch(_e){ return null; }
}
function solarDateForLunarYear(lunarYear,month,day,leap=false){
  lunarYear=Number(lunarYear); month=Number(month); day=Number(day); leap=!!leap;
  if(!lunarYear || month<1 || month>12 || day<1 || day>30) return null;
  const key=`${lunarYear}|${month}|${day}|${leap?1:0}`;
  if(lunarSolarCache.has(key)){
    const cached=lunarSolarCache.get(key);
    return cached?parse(cached):null;
  }
  // 음력 한 해는 대체로 양력 1~2월에 시작해 다음 해 1~2월까지 이어집니다.
  const start=new Date(lunarYear,0,15), end=new Date(lunarYear+1,2,10);
  for(let d=new Date(start); d<=end; d=add(d,1)){
    const lp=lunarPartsFromSolar(d);
    if(lp && lp.year===lunarYear && lp.month===month && lp.day===day && lp.leap===leap){
      const result=ds(d); lunarSolarCache.set(key,result); return new Date(d);
    }
  }
  lunarSolarCache.set(key,'');
  return null;
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
  for(const raw of Array.isArray(tasks)?tasks:[]){
    if(!raw || !String(raw.text||'').trim()) continue;
    const text=String(raw.text||'').trim(), id=String(raw.id||'');
    if(raw.type==='date' && raw.date){
      const date=String(raw.date);
      if(date<=deadline) out.push({date,sourceDate:date,text,ruleId:id,type:'date',ruleLabel:'지정',key:`date:${id}`});
      continue;
    }
    if(raw.type==='weekly' && raw.startDate){
      const weekday=Math.max(0,Math.min(6,Number(raw.weekday)||0));
      let d=parse(raw.startDate), guard=0;
      while(d.getDay()!==weekday && guard++<8) d=add(d,1);
      while(d<deadlineDate && guard++<500){
        const date=ds(d);
        out.push({date,sourceDate:date,text,ruleId:id,type:'weekly',ruleLabel:`매주 ${weekdayName(weekday)}`,key:`weekly:${id}:${date}`});
        d=add(d,7);
      }
    }
  }
  return out.sort((a,b)=>a.date.localeCompare(b.date)||a.type.localeCompare(b.type)||a.text.localeCompare(b.text));
}
function basePreparationEntries(e){
  if(!e?.prepEnabled || !e.prepDeadline) return [];
  if((e.repeat||'none')!=='none') return [];
  if(e.prepMode==='custom') return prepTaskEntriesFromValues(e.prepDeadline,e.prepTasks||[]);
  return preparationDatesFromValues(e.prepDeadline,e.prepDays,e.prepWeekdaysOnly,e.prepIncludeDeadline)
    .map(date=>({date,sourceDate:date,text:String(e?.prepDailyNotes?.[date]||'').trim(),ruleId:date,type:'auto',ruleLabel:'자동',key:`auto:${date}`}));
}
function preparationEntries(e){
  const moves=(e?.prepMoves&&typeof e.prepMoves==='object')?e.prepMoves:{};
  return basePreparationEntries(e).map(entry=>{
    const moved=typeof moves[entry.key]==='string'&&moves[entry.key]?moves[entry.key]:'';
    return moved?{...entry,date:moved,moved:true}:{...entry,moved:false};
  }).filter(entry=>!e?.prepDeadline || entry.date<=e.prepDeadline)
    .sort((a,b)=>a.date.localeCompare(b.date)||a.type.localeCompare(b.type)||a.text.localeCompare(b.text));
}
function preparationEntryDone(e,key){ return !!(key && e?.prepDone && e.prepDone[key]); }
function preparationProgress(e){
  const entries=preparationEntries(e), total=entries.length, done=entries.filter(x=>preparationEntryDone(e,x.key)).length;
  return {done,total};
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
  if(e?.prepMode==='custom'){
    if(!entries.length) return `준비일정 미등록 · 마감 ${e.prepDeadline||e.date||''}`;
    const range=dates[0]===dates.at(-1)?dates[0]:`${dates[0]} ~ ${dates.at(-1)}`;
    return `준비일정 ${range} · ${entries.length}건${entries.length!==dates.length?`/${dates.length}일`:''} · 마감 ${e.prepDeadline}`;
  }
  if(!dates.length) return '';
  const first=dates[0], last=dates[dates.length-1];
  const range=first===last?first:`${first} ~ ${last}`;
  return `준비 ${range} · ${dates.length}일${e.prepWeekdaysOnly?'(평일만)':''} · 마감 ${e.prepDeadline}`;
}
function preparationNoteForDate(e,date){
  if(e?.prepMode==='custom'){
    return preparationEntries(e).filter(x=>x.date===date).map(x=>x.text).filter(Boolean).join(' / ');
  }
  return String(e?.prepDailyNotes?.[date]||'').trim();
}
function preparationVirtualEvent(e,entry){
  const date=typeof entry==='string'?entry:entry.date;
  const note=typeof entry==='string'?preparationNoteForDate(e,date):String(entry.text||'').trim();
  const key=typeof entry==='string'?`auto:${entry}`:String(entry.key||'');
  const sourceDate=typeof entry==='string'?entry:String(entry.sourceDate||entry.date||'');
  return {...e,_prepDay:true,_prepDate:date,_renderDate:date,_occurrenceStart:e.date,_occurrenceEnd:e.date,_prepNote:note,_prepKey:key,_prepSourceDate:sourceDate,_prepType:typeof entry==='string'?'auto':String(entry.type||''),_prepRuleId:typeof entry==='string'?'':String(entry.ruleId||''),_prepRuleLabel:typeof entry==='string'?'':String(entry.ruleLabel||'')};
}

function buildOccurrenceMap(rangeStart, rangeEnd, options={}){
  const map={};
  for(let d=parse(rangeStart), end=parse(rangeEnd); d<=end; d=add(d,1)) map[ds(d)]=[];
  const hidden = new Set(state.settings.hiddenCalendars||[]);
  const includeHidden=!!options.includeHidden;
  const includePreparations=options.includePreparations!==false;
  const calendarIds=options.calendarIds instanceof Set ? options.calendarIds : null;
  for(const e of state.events){
    if(calendarIds && !calendarIds.has(e.calId)) continue;
    if(!includeHidden && isCalendarHidden(e.calId)) continue;
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
  if(e.kind==='anniversary') return false;
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
  if(!e || e.kind==='anniversary') return;
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
  const c=cal(e.calId), prepDay=!!e._prepDay, deadlineItem=!!e.prepEnabled && !prepDay && (e._renderDate||e.date)===(e.prepDeadline||e.date);
  const done=prepDay?preparationEntryDone(e,e._prepKey):isDone(e), checkable=e.kind!=='anniversary' && !prepDay;
  const recurring=(e.repeat||'none')!=='none';
  const payment=e.kind==='payment';
  const checklist=prepDay?[]:checklistItems(e), checklistState=prepDay?{done:0,total:0}:checklistProgress(e);
  const durationPrefix=(!prepDay && !payment && !e.noDuration && duration(e)>0)?`(${fmtH(duration(e))}) `:'';
  const timePrefix=(!prepDay && !e.allDay && e.start)?`${e.start}${e.end?`–${e.end}`:''} `:'';
  const inLabel=prepDay?'':carryoverInLabel(e), outRecord=prepDay?null:carryoverOutRecord(e);
  const renderDate=e._renderDate||e._occurrenceStart||e.date;
  const drag='true';
  const prepNote=prepDay?String(e._prepNote||'').trim():'';
  const shownTitle=prepDay?`준비 · ${e.title}${prepNote?` › ${prepNote}`:''}`:(deadlineItem?`마감 · ${e.title}`:e.title);
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
  const dragHandle=`<span class="dragHandle" title="${prepDay?'드래그: 준비일정을 다른 날짜로 이동':'드래그: 같은 날짜에서는 순서 변경 · 다른 날짜에서는 이동'}" aria-hidden="true">⋮⋮</span>`;
  const mainCheck=prepDay?`<button type="button" class="todoCheck prepCheck" data-action="prep-toggle" title="${done?'완료 해제':'완료 처리'}">${done?'☑':'☐'}</button>`:'';
  const checklistKey=checklistExpandKey(e), expanded=!prepDay&&expandedChecklistKeys.has(checklistKey);
  const checklistButton=checklist.length?`<button type="button" class="checklistToggle ${expanded?'on':''}" data-action="checklist-toggle" title="세부 체크리스트 ${checklistState.done}/${checklistState.total}">☷ ${checklistState.done}/${checklistState.total}</button>`:'';
  const repeatBadge=!prepDay&&recurring?`<span class="repeatMark" title="${esc(repeatRuleLabel(e))}">↻</span>`:'';
  const carryBadge=inLabel?`<span class="carryBadge carryIn" title="${esc(inLabel)}">↪</span>`:'';
  const amountInline=!prepDay&&payment&&Number(e.paymentAmount)>0?`<span class="inlineMeta">₩${Number(e.paymentAmount).toLocaleString('ko-KR')}</span>`:'';
  return `<div class="item ${done?'done':''} kind-${esc(e.kind||'event')} ${recurring&&!prepDay?'recurringItem':''} ${payment&&!prepDay?'paymentItem':''} ${e.fixedId?'manualPlacedItem':''} ${e.flexibleId?'flexiblePlacedItem':''} ${inLabel?'carriedIn':''} ${outRecord?'carriedOut':''} ${prepDay?'prepDayItem':''} ${deadlineItem?'prepDeadlineItem':''}" draggable="${drag}" data-eid="${esc(e.id)}" data-occurrence="${esc(e._occurrenceStart||e.date)}" data-render-date="${esc(renderDate)}" data-cal-id="${esc(e.calId)}" data-lane="${payment?'payment':'work'}" data-prep-day="${prepDay?'1':''}" data-prep-key="${prepDay?esc(e._prepKey||''):''}" data-prep-source-date="${prepDay?esc(e._prepSourceDate||''):''}" data-prep-type="${prepDay?esc(e._prepType||''):''}" data-prep-rule-id="${prepDay?esc(e._prepRuleId||''):''}" data-prep-event="${e.prepEnabled?'1':''}" style="--item-color:${esc(c.color)};border-left-color:${esc(c.color)}">
    <div class="itemRow">${dragHandle}${!prepDay&&e.important?`<button type="button" class="importanceBtn on" data-action="importance" aria-label="중요 표시 해제" title="중요 표시 해제">★</button>`:''}${mainCheck}<div class="itemTitle" title="${esc(tooltip)}">${timePrefix}<span class="durationPrefix">${esc(durationPrefix)}</span>${!prepDay&&payment?'₩ ':(!checkable&&!prepDay?kindPrefix(e):'')}${esc(shownTitle)}</div>${amountInline}${repeatBadge}${carryBadge}${checklistButton}</div>
    ${expanded?checklistHtml(e,false):''}
  </div>`;
}
function appointmentLaneHtml(es, compact=false){
  const items=(es||[]).filter(e=>e.kind==='appointment');
  if(!items.length) return '';
  return `<div class="appointmentLane ${compact?'compactAppointmentLane':''}"><div class="appointmentLaneHead"><span>예약 · 약속</span><small>${items.length}건</small></div><div class="appointmentLaneItems">${items.map(e=>eventItemHtml(e,compact)).join('')}</div></div>`;
}
function quickLaneHtml(es, compact=false, force=false){
  const quick=(es||[]).filter(e=>e.kind==='todo');
  if(!quick.length && !force) return '';
  return `<div class="quickLane ${compact?'compactQuickLane':''} ${!quick.length?'emptyLane':''}"><div class="quickLaneHead"><span>Quick</span><small>${quick.length}건</small></div><div class="quickLaneItems">${quick.map(e=>eventItemHtml(e,compact)).join('')}</div></div>`;
}
function anniversaryLaneHtml(es, compact=false){
  const items=(es||[]).filter(e=>e.kind==='anniversary');
  if(!items.length) return '';
  return `<div class="anniversaryLane ${compact?'compactAnniversaryLane':''}"><div class="anniversaryLaneHead"><span>♥ D-Day · 기념일</span><small>${items.length}건</small></div><div class="anniversaryLaneItems">${items.map(e=>eventItemHtml(e,compact)).join('')}</div></div>`;
}
function commonTopLaneHtml(es, compact=false, force=false){
  const anniversaries=(es||[]).filter(e=>e.kind==='anniversary');
  const appointments=(es||[]).filter(e=>e.kind==='appointment');
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
  const payments=(es||[]).filter(e=>e.kind==='payment');
  if(!payments.length && !force) return '';
  return `<div class="paymentLane ${compact?'compactPaymentLane':''} ${!payments.length?'emptyLane':''}"><div class="paymentLaneHead"><span>₩ 납부</span><small>${payments.length}건</small></div><div class="paymentLaneItems">${payments.map(e=>eventItemHtml(e,compact)).join('')}</div></div>`;
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
  const commonTopHtml=commonTopLaneHtml(es,false,true);
  const quickHtml=quickLaneHtml(es,false,true);
  const paymentHtml=paymentLaneHtml(es,false,true);
  const appointmentEvents=(es||[]).filter(e=>e.kind==='appointment'&&!e._prepDay);
  const quickEvents=(es||[]).filter(e=>e.kind==='todo'&&!e._prepDay);
  const workEvents=(es||[]).filter(e=>e.kind!=='payment' && e.kind!=='appointment' && e.kind!=='anniversary' && e.kind!=='todo');
  let html='';
  const visible=visibleCals(), visibleIds=new Set(visible.map(c=>c.id));
  let total=appointmentEvents.reduce((sum,e)=>sum+workloadDuration(e),0) + quickEvents.reduce((sum,e)=>sum+workloadDuration(e),0), totalCapacity=0, hasUnknownCapacity=false, blockedRootCount=0;
  for(const root of topLevelCals()){
    const members=[root,...descendants(root.id)].filter(c=>visibleIds.has(c.id));
    if(!members.length) continue;
    const memberIds=new Set(members.map(c=>c.id));
    const groupEvents=workEvents.filter(e=>memberIds.has(e.calId));
    if(!groupEvents.length) continue;
    const rootSum=groupEvents.filter(e=>!e._prepDay).reduce((sum,e)=>sum+workloadDuration(e),0);
    total+=rootSum;
    const rootCapInfo=capacityForDate(root,date);
    if(rootCapInfo.blocked) blockedRootCount++;
    if(rootCapInfo.unknown) hasUnknownCapacity=true; else totalCapacity+=rootCapInfo.hours;
    const rootCollapsed=isDayCalCollapsed(date,root.id);
    const blockedTitle=rootCapInfo.blocked?' · 가용시간 차단 일정 있음':'';
    html += `<div class="group calendarTreeGroup ${rootCollapsed?'collapsed':''}" style="--group-color:${esc(root.color)}"><div class="groupHead" style="background:${esc(root.color)}55" title="${esc(root.name)}${blockedTitle}">${dayCalHeadHtml(date,root,rootSum,rootCapInfo.hours,rootCapInfo.unknown)}</div><div class="dayCalGroupBody">`;
    const direct=groupEvents.filter(e=>e.calId===root.id);
    if(direct.length) html += nonQuickItemsHtml(direct,false);
    for(const child of members.filter(c=>c.id!==root.id)){
      const xs=groupEvents.filter(e=>e.calId===child.id); if(!xs.length) continue;
      const depth=Math.max(1,calendarDepth(child.id));
      const childCollapsed=isDayCalCollapsed(date,child.id);
      html += `<div class="subCalGroup ${childCollapsed?'collapsed':''}" style="--sub-depth:${depth}"><div class="subCalHead" style="border-left-color:${esc(child.color)};background:color-mix(in srgb, ${esc(child.color)} 14%, white)">${daySubCalHeadHtml(date,child,'↳ ')}</div><div class="dayCalGroupBody">${nonQuickItemsHtml(xs,false)}</div></div>`;
    }
    html += `</div></div>`;
  }
  const overallOver=!hasUnknownCapacity && totalCapacity>0 && total>totalCapacity;
  let capacitySummary=hasUnknownCapacity
    ? `${totalCapacity?` · 확인된 가용 ${fmtH(totalCapacity)}`:''} · 일부 가용시간 미정`
    : (totalCapacity?` / 캘린더 가용 ${fmtH(totalCapacity)}`:'');
  if(blockedRootCount) capacitySummary += ` · 가용차단 ${blockedRootCount}개`;
  return commonTopHtml + quickHtml + paymentHtml + html + `<div class="dayTotal ${overallOver?'overallOver':''}">총 계획 ${fmtH(total)}${capacitySummary}</div>`;
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
  $('#calList').innerHTML=cals().map(c=>{
    const depth=calendarDepth(c.id), kids=directChildren(c.id).length, focused=calendarFocusId===c.id;
    const capLabel=capacitySidebarLabel(c);
    return `<div class="calRow ${depth?'subCalendarRow':''} ${focused?'calendarFocused':''}" data-cid="${esc(c.id)}" style="--cal-depth:${depth}"><input class="calVisible" type="checkbox" ${isCalendarHidden(c.id)?'':'checked'} title="표시/숨김"><i class="dot" style="background:${esc(c.color)}"></i><button type="button" class="calNameBtn" title="${esc(c.name)}만 현재 달력 화면에서 보기 (다시 누르면 전체 보기)">${depth?'↳ ':''}${esc(c.name)}</button><small>${esc(c.period)} · ${capLabel}${kids?` · 부속 ${kids}`:''}</small><button type="button" class="calEdit" title="캘린더 수정" aria-label="${esc(c.name)} 수정">✎</button></div>`;
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
      // 캘린더 이름 클릭은 현재 주/월/일/목록 보기 방식을 절대 바꾸지 않고
      // 현재 화면에서 선택한 캘린더 내용만 필터링합니다.
      if(calendarFocusId===id){
        calendarFocusId=null;
        render();
      }else{
        calendarFocusId=id;
        // 선택한 캘린더가 숨김 상태라면 선택 즉시 보이도록 복구합니다.
        // 상위 캘린더는 그 하위까지 함께 필터링하므로 하위도 표시 상태로 돌립니다.
        const showIds=[id,...descendants(id).map(c=>c.id)];
        const set=new Set(state.settings.hiddenCalendars||[]);
        const before=set.size;
        showIds.forEach(x=>set.delete(x));
        state.settings.hiddenCalendars=[...set];
        if(set.size!==before) save({rerender:false});
        render();
      }
      $('#sidebar').classList.remove('open');
    };
    row.querySelector('.calEdit').onclick=e=>{ e.stopPropagation(); openCal(row.dataset.cid); };
  });
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
function recurringMonthProgress(e){
  const {startKey,endKey}=currentMonthRange();
  const starts=generateOccurrenceStarts(e,startKey,endKey).filter(d=>{
    const k=ds(d); return k>=startKey && k<=endKey && !(e.excludedDates||[]).includes(k);
  });
  const total=starts.length;
  if(!total) return {total:0,done:0,label:'이번 달 해당 없음',complete:false};
  const doneSet=new Set(e.doneDates||[]);
  const done=starts.reduce((n,d)=>n+(doneSet.has(ds(d))?1:0),0);
  if(done===total) return {total,done,label:`✓ 이번 달 완료 ${done}/${total}`,complete:true};
  return {total,done,label:`이번 달 ${done}/${total} 완료`,complete:false};
}
function manualMonthProgress(placed){
  if(!placed.length) return {label:'이번 달 미배치',complete:false};
  const done=placed.filter(e=>isDone(e)).length;
  if(done===placed.length) return {label:`✓ 이번 달 완료${placed.length>1?` ${done}/${placed.length}`:''}`,complete:true};
  return {label:placed.length>1?`이번 달 ${done}/${placed.length} 완료`:'이번 달 미완료',complete:false};
}

function sidebarCalendarCollapseMap(section){
  state.settings.sidebarCalendarGroupsCollapsed=state.settings.sidebarCalendarGroupsCollapsed||{recurring:{},manual:{},flexible:{},payment:{}};
  state.settings.sidebarCalendarGroupsCollapsed[section]=state.settings.sidebarCalendarGroupsCollapsed[section]||{};
  return state.settings.sidebarCalendarGroupsCollapsed[section];
}
function sidebarCalendarGroupHtml(section,c,bodyHtml,count){
  const collapsed=!!sidebarCalendarCollapseMap(section)[c.id];
  const path=calendarPath(c.id);
  return `<div class="sidebarCalGroup ${collapsed?'collapsed':''}" style="--group-color:${esc(c.color)}">
    <button type="button" class="sidebarCalGroupHead" data-sidebar-cal-toggle="${esc(section)}" data-cal-id="${esc(c.id)}" aria-expanded="${collapsed?'false':'true'}" title="${esc(path)} 접기/펴기">
      <span class="sidebarCalGroupTitle"><i class="dot" style="background:${esc(c.color)}"></i><span>${esc(path)}</span></span>
      <span class="sidebarCalGroupMeta">${count}건 ${collapsed?'▸':'▾'}</span>
    </button>
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

function renderFixed(){
  const f=selectedFixedFilter||'all';
  const month=`${cursor.getFullYear()}-${pad(cursor.getMonth()+1)}`;
  const allowed=f==='all'?null:new Set([f,...descendants(f).map(c=>c.id)]);
  const recurring=state.events.filter(e=>(e.repeat||'none')!=='none' && e.kind!=='payment' && e.kind!=='anniversary' && (!allowed||allowed.has(e.calId)))
    .sort((a,b)=>occurrenceSortKey(a).localeCompare(occurrenceSortKey(b)) || String(a.title||'').localeCompare(String(b.title||''),'ko'));
  const manual=state.fixed.filter(x=>!allowed||allowed.has(x.calId))
    .sort((a,b)=>manualPlacementSortKey(a).localeCompare(manualPlacementSortKey(b)) || String(a.name||'').localeCompare(String(b.name||''),'ko'));
  const collapsed=state.settings.fixedPanelsCollapsed||{recurring:false,manual:false};

  const recurringRows=groupedCalendarHtml('recurring',recurring,e=>{
    const c=cal(e.calId), rule=repeatRuleLabel(e);
    const kindLabel={event:'일정',appointment:'예약,약속',todo:'Quick',habit:'습관/루틴',anniversary:'기념일/D-Day',payment:'납부일정'}[e.kind]||'일정';
    const progress=e.kind==='anniversary'?{label:'완료체크 대상 아님',complete:false}:recurringMonthProgress(e);
    return `<div class="fixed recurringFixed ${progress.complete?'monthComplete':'monthPending'}" data-eid="${esc(e.id)}" style="border-left-color:${esc(c.color)}" title="${esc(`${calendarPath(c.id)} · ${rule} · ${durationLabel(e)} · ${progress.label}`)}"><b>${e.important?'★ ':''}${esc(e.title)}</b><small>${esc(kindLabel)} · ${esc(rule)} · ${esc(durationLabel(e))}</small><span class="monthProgress ${progress.complete?'complete':''}">${esc(progress.label)}</span></div>`;
  },'자동반복 일정이 없습니다.');

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
      <button type="button" class="fixedGroupHead" data-fixed-toggle="recurring" aria-expanded="${collapsed.recurring?'false':'true'}"><span>자동반복 <em>달력에 자동 배치</em></span><span class="fixedGroupMeta">${recurring.length}건 ${collapsed.recurring?'▸':'▾'}</span></button>
      <div class="fixedGroupBody ${collapsed.recurring?'collapsed':''}" data-fixed-panel="recurring">${recurringRows}</div>
    </div>
    <div class="fixedGroup">
      <button type="button" class="fixedGroupHead" data-fixed-toggle="manual" aria-expanded="${collapsed.manual?'false':'true'}"><span>날짜 지정 배치 <em>드래그해서 넣기</em></span><span class="fixedGroupMeta">${manual.length}건 ${collapsed.manual?'▸':'▾'}</span></button>
      <div class="fixedGroupBody ${collapsed.manual?'collapsed':''}" data-fixed-panel="manual">${manualRows}</div>
    </div>`;

  $$('.recurringFixed').forEach(x=>{ x.ondblclick=()=>openEvent(null,x.dataset.eid); x.onclick=()=>openEvent(null,x.dataset.eid); });
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
  $$('[data-fixed-toggle]').forEach(btn=>btn.onclick=()=>{
    const key=btn.dataset.fixedToggle;
    state.settings.fixedPanelsCollapsed=state.settings.fixedPanelsCollapsed||{};
    state.settings.fixedPanelsCollapsed[key]=!state.settings.fixedPanelsCollapsed[key];
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
  const byCal=new Map();
  const push=(calId,sortKey,html)=>{ if(!byCal.has(calId)) byCal.set(calId,[]); byCal.get(calId).push({sortKey,html}); };
  for(const e of payments){
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
        push(e.calId,occ,`<div class="paymentRow ${done?'paid':''}" data-eid="${esc(e.id)}" data-occ="${esc(occ)}" style="border-left-color:${esc(c.color)}"><button type="button" class="paymentCheck" title="${done?'납부완료 취소':'납부완료 체크'}">${done?'☑':'☐'}</button><button type="button" class="paymentOpen"><b>${e.important?'★ ':''}${esc(e.title)}</b><small>${esc(occ)} · ${amount}${method}${(e.repeat||'none')!=='none'?` · ${esc(repeatRuleLabel(e))}`:''}</small></button></div>`);
      }
    }else{
      const next=nextOccurrenceFor(e,ds(new Date()),740);
      const c=cal(e.calId);
      push(e.calId,next||'9999-12-31',`<div class="paymentRow paymentNoMonth" data-eid="${esc(e.id)}" data-occ="${esc(next||e.date)}" style="border-left-color:${esc(c.color)}"><span class="paymentCheck muted">·</span><button type="button" class="paymentOpen"><b>${e.important?'★ ':''}${esc(e.title)}</b><small>이번 달 해당 없음${next?` · 다음 ${esc(next)}`:''} · ${esc(repeatRuleLabel(e))}</small></button></div>`);
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
  box.innerHTML=`<div class="paymentPanel ${collapsed?'collapsed':''}">${html}</div>`;
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
  box.innerHTML=rows.map(p=>`<div class="purchaseRow ${p.done?'done':''}" data-pid="${esc(p.id)}"><span class="purchaseDragHandle" draggable="true" title="드래그해서 순서 변경" aria-label="순서 변경">⋮⋮</span><button type="button" class="purchaseCheck" title="구매완료 전환">${p.done?'☑':'☐'}</button><button type="button" class="purchaseOpen" title="구매항목 수정"><span>${esc(p.name)}</span>${p.qty>1?`<small>${p.qty}개</small>`:''}</button></div>`).join('') || '<div class="empty">등록된 구매항목이 없습니다.</div>';
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
    row.querySelector('.purchaseCheck')?.addEventListener('click',()=>{ const p=state.purchases.find(x=>x.id===row.dataset.pid); if(!p) return; p.done=!p.done; save(); });
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
  $('#purchaseId').value=p?.id||''; $('#purchaseName').value=p?.name||''; $('#purchaseQty').value=p?.qty||1; $('#purchaseMemo').value=p?.memo||''; $('#purchaseDone').checked=!!p?.done;
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
  return (map[date]||[]).filter(e=>ids.has(e.calId)&&!e._prepDay&&!['payment','anniversary'].includes(e.kind)).reduce((a,e)=>a+workloadDuration(e),0);
}
function workloadChildBreakdown(root,date,map){
  const out=[];
  for(const c of workloadRootMembers(root)){
    const sum=(map[date]||[]).filter(e=>e.calId===c.id&&!e._prepDay&&!['payment','anniversary'].includes(e.kind)).reduce((a,e)=>a+workloadDuration(e),0);
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
function openPreparationPlan(id){
  const e=state.events.find(x=>x.id===id && x.prepEnabled); if(!e) return;
  activePrepPlanId=id;
  const entries=preparationEntries(e);
  $('#prepPlanTitle').textContent=e.title;
  const prepProgress=preparationProgress(e);
  $('#prepPlanSummary').textContent=`${preparationSummary(e)}${prepProgress.total?` · 완료 ${prepProgress.done}/${prepProgress.total}`:''}`;
  const memo=$('#prepPlanGeneralMemo');
  if(e.memo?.trim()){ memo.textContent=e.memo.trim(); memo.classList.remove('hidden'); } else { memo.textContent=''; memo.classList.add('hidden'); }
  const rows=entries.map(entry=>{
    const note=String(entry.text||'').trim(), done=preparationEntryDone(e,entry.key);
    const rule=e.prepMode==='custom'&&entry.ruleLabel?`<small class="prepPlanRule">${esc(entry.ruleLabel)}${entry.moved?' · 이동':''}</small>`:(entry.moved?`<small class="prepPlanRule">이동</small>`:'');
    return `<div class="prepPlanRow ${done?'done':''}"><button type="button" class="prepPlanCheck" data-prep-plan-check="${esc(entry.key)}" title="${done?'완료 해제':'완료 처리'}">${done?'☑':'☐'}</button><div class="prepPlanDate">${esc(preparationDateLabel(entry.date))}<small>${esc(entry.date)}</small>${rule}</div><div class="prepPlanText ${note?'':'muted'}">${esc(note||'계획 미입력')}</div></div>`;
  });
  if(!rows.length) rows.push(`<div class="prepPlanRow"><span class="prepPlanCheckSpacer"></span><div class="prepPlanDate">준비일정</div><div class="prepPlanText muted">등록된 준비 일정이 없습니다.</div></div>`);
  rows.push(`<div class="prepPlanRow deadline"><span class="prepPlanCheckSpacer"></span><div class="prepPlanDate">마감일<small>${esc(e.prepDeadline||e.date)}</small></div><div class="prepPlanText"><b>${esc(e.title)}</b>${e.place?`<br>${esc(e.place)}`:''}</div></div>`);
  $('#prepPlanList').innerHTML=rows.join('');
  $('#prepPlanList').onclick=ev=>{ const b=ev.target.closest('[data-prep-plan-check]'); if(!b) return; ev.preventDefault(); ev.stopPropagation(); togglePreparationDone(e.id,b.dataset.prepPlanCheck||''); };
  openDialog($('#prepPlanDlg'));
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
  meta.push(calendarPath(base.calId));
  if((base.repeat||'none')!=='none') meta.push(repeatRuleLabel(base));
  $('#eventPopoverMeta').textContent=meta.filter(Boolean).join(' · ');
  const planBtn=$('#eventPopoverPlan'); if(planBtn) planBtn.classList.toggle('hidden',!base.prepEnabled);
  const doneWrap=$('#eventPopoverDoneWrap'), done=$('#eventPopoverDone'), doneText=$('#eventPopoverDoneText');
  const canComplete=base.kind!=='anniversary';
  doneWrap.classList.toggle('hidden',!canComplete);
  if(canComplete){ done.checked=!!isDone(e); doneText.textContent=base.kind==='payment'?'납부완료':'완료'; }
  positionEventPopover(anchor);
}
$('#eventPopoverClose').onclick=closeEventPopover;
$('#eventPopoverEdit').onclick=()=>{
  const {id,occ}=eventPopoverState; if(!id) return;
  closeEventPopover(); openEvent(occ,id);
};
$('#eventPopoverPlan').onclick=()=>{ const {id}=eventPopoverState; if(!id) return; closeEventPopover(); openPreparationPlan(id); };
$('#eventPopoverDone').onchange=()=>{
  const {id,occ}=eventPopoverState; if(!id) return;
  const ev=state.events.find(x=>x.id===id); if(!ev || ev.kind==='anniversary') return;
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
      if(baseEvent?.prepEnabled){ openPreparationPlan(id); return; }
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
function togglePreparationDone(id,key){
  const e=state.events.find(x=>x.id===id && x.prepEnabled); if(!e || !key) return;
  e.prepDone=(e.prepDone&&typeof e.prepDone==='object')?e.prepDone:{};
  if(e.prepDone[key]) delete e.prepDone[key]; else e.prepDone[key]=true;
  save();
  if($('#prepPlanDlg')?.open && activePrepPlanId===id) openPreparationPlan(id);
}
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
  const e=state.events.find(x=>x.id===id); if(!e || e.kind==='anniversary') return;
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


const LANE_HEIGHT_DEFAULTS={common:72,quick:64,payment:64,calendar:112};
function laneHeight(key,type='calendar'){
  state.settings.laneHeights=state.settings.laneHeights||{};
  const stored=Number(state.settings.laneHeights[key]);
  return stored?Math.max(44,Math.min(480,stored)):(LANE_HEIGHT_DEFAULTS[type]||112);
}
function laneIsCollapsed(key){
  state.settings.laneCollapsed=state.settings.laneCollapsed||{};
  return !!state.settings.laneCollapsed[key];
}
function laneCalendarMembers(root,visibleIds){
  return [root,...descendants(root.id)].filter(c=>visibleIds.has(c.id));
}
function laneCellCommonHtml(es){
  const xs=(es||[]).filter(e=>e.kind==='anniversary'||e.kind==='appointment');
  return xs.map(e=>eventItemHtml(e,false)).join('');
}
function laneCellQuickHtml(es){ return (es||[]).filter(e=>e.kind==='todo').map(e=>eventItemHtml(e,false)).join(''); }
function laneCellPaymentHtml(es){ return (es||[]).filter(e=>e.kind==='payment').map(e=>eventItemHtml(e,false)).join(''); }
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
  const normal=(es||[]).filter(e=>memberIds.has(e.calId) && !['anniversary','appointment','todo','payment'].includes(e.kind));
  const allForLoad=(es||[]).filter(e=>memberIds.has(e.calId) && !e._prepDay && !['anniversary','payment'].includes(e.kind));
  const sum=allForLoad.reduce((a,e)=>a+workloadDuration(e),0), cap=capacityForDate(root,date);
  let body='';
  body=laneOrderedItemsHtml(normal,root.id);
  const capText=cap.unknown?`${fmtH(sum)} / 미정`:`${fmtH(sum)} / ${fmtH(cap.hours)}`;
  const cls=cap.unknown?'unknown':(Number(cap.hours)>0&&sum>Number(cap.hours)?'over':'ok');
  return `<div class="laneCellLoad ${cls}" title="${esc(root.name)} 가용시간">${capText}${cap.blocked?' · 차단':''}</div>${body}`;
}
function daySummaryHtml(date,es){
  const visible=visibleCals(), visibleIds=new Set(visible.map(c=>c.id));
  let total=0,totalCap=0,unknown=false,blocked=0;
  for(const root of topLevelCals()){
    const members=laneCalendarMembers(root,visibleIds); if(!members.length) continue;
    const ids=new Set(members.map(c=>c.id));
    total+=(es||[]).filter(e=>ids.has(e.calId)&&!e._prepDay&&!['anniversary','payment'].includes(e.kind)).reduce((a,e)=>a+workloadDuration(e),0);
    const ci=capacityForDate(root,date); if(ci.blocked) blocked++; if(ci.unknown) unknown=true; else totalCap+=Number(ci.hours)||0;
  }
  const txt=unknown?`총 ${fmtH(total)} · 일부 미정`:(totalCap?`총 ${fmtH(total)} / ${fmtH(totalCap)}`:`총 ${fmtH(total)}`);
  return `<span class="${!unknown&&totalCap&&total>totalCap?'over':'ok'}">${txt}${blocked?` · 차단 ${blocked}`:''}</span>`;
}
function laneLabelWidth(){
  state.settings=state.settings||{};
  return Math.max(22,Math.min(120,Number(state.settings.laneLabelWidth)||30));
}
function laneVerticalTitleHtml(text){
  return Array.from(String(text||'')).map(ch=>{
    if(ch===' ') return '<span class="laneTitleChar laneTitleSpace" aria-hidden="true"></span>';
    return `<span class="laneTitleChar">${esc(ch)}</span>`;
  }).join('');
}
function scheduleLaneHtml(key,title,days,map,cellBuilder,{type='calendar',color='#d9d9d9',subtitle=''}={}){
  const collapsed=laneIsCollapsed(key), h=laneHeight(key,type);
  const cells=days.map(d=>{ const date=ds(d); return `<div class="scheduleLaneCell" data-dropdate="${date}">${cellBuilder(date,map[date]||[])}</div>`; }).join('');
  return `<section class="scheduleLane ${collapsed?'collapsed':''}" data-lane-key="${esc(key)}" style="--lane-h:${h}px;--lane-color:${esc(color)}">
    <aside class="scheduleLaneSide" style="--lane-color:${esc(color)}">
      <button type="button" class="scheduleLaneToggle" data-lane-toggle="${esc(key)}" title="구역 접기/펴기">
        <span class="scheduleLaneDot" style="background:${esc(color)}"></span>
        <span class="scheduleLaneName"><b aria-label="${esc(title)}">${laneVerticalTitleHtml(title)}</b>${subtitle?`<small>${esc(subtitle)}</small>`:''}</span>
        <span class="scheduleLaneArrow">${collapsed?'▸':'▾'}</span>
      </button>
    </aside>
    <div class="scheduleLaneGrid">${cells}</div>
    <div class="laneHeightResizer" data-lane-resize="${esc(key)}" title="마우스로 드래그해 구역 높이 조절 · 더블클릭 기본높이"></div>
  </section>`;
}
function scheduleDateHeader(days){
  // 날짜 헤더 전체도 드롭 영역으로 사용합니다. 2주/3주 보기에서 다른 주로 옮길 때
  // 좁은 일정 칸을 정확히 찾지 않아도 날짜 머리글에 놓으면 해당 날짜로 이동합니다.
  return `<div class="scheduleDateGrid"><div class="scheduleDateCorner">구역</div>${days.map(d=>{const key=ds(d),hasDiary=!!state.diary[key]?.text,h=holidayLabel(key),dow=d.getDay(),dmark=selectedDdayMarkerHtml(key),dayClass=[key===ds(new Date())?'today':'',holidayClass(key),dow===0?'sunday':'',dow===6?'saturday':'',dmark?'ddayTracked':''].filter(Boolean).join(' ');return `<div class="scheduleDateHead ${dayClass}" data-dropdate="${key}" data-date-drop-head="1" title="${key} · 일정을 여기에 놓아 이동"><div class="dayTopLine"><span class="weekdayLabel">${['일','월','화','수','목','금','토'][dow]}</span><span class="dateNum">${d.getDate()}</span><button type="button" class="diaryBtn ${hasDiary?'hasDiary':''}" data-diarydate="${key}" title="${hasDiary?'다이어리 보기 · 작성됨':'다이어리 작성 · 미작성'}" aria-label="${hasDiary?'다이어리 작성됨':'다이어리 미작성'}">${diaryIconHtml(hasDiary)}</button></div><div class="holidayName ${h?'':'holidayEmpty'}" title="${h?esc(h):''}">${h?esc(h):'&nbsp;'}</div>${dmark}</div>`}).join('')}</div>`;
}
function scheduleWeekBoard(days,map){
  const visible=visibleCals(),visibleIds=new Set(visible.map(c=>c.id));
  let html=`<div class="scheduleBoard"><div class="laneLabelWidthResizer" data-lane-label-resize="1" title="좌우로 드래그해 캘린더 이름 영역 너비 조절 · 더블클릭 기본너비"></div>${scheduleDateHeader(days)}`;
  html+=scheduleLaneHtml('common','공통일정',days,map,(date,es)=>laneCellCommonHtml(es),{type:'common',color:'#d9b5cc'});
  html+=scheduleLaneHtml('quick','Quick',days,map,(date,es)=>laneCellQuickHtml(es),{type:'quick',color:'#cfd5dc'});
  html+=scheduleLaneHtml('payment','납부',days,map,(date,es)=>laneCellPaymentHtml(es),{type:'payment',color:'#e6d399'});
  for(const root of topLevelCals()){
    const members=laneCalendarMembers(root,visibleIds); if(!members.length) continue;
    const subNames=members.filter(c=>c.id!==root.id).map(c=>c.name);
    html+=scheduleLaneHtml(`cal:${root.id}`,root.name,days,map,(date,es)=>rootLaneCellHtml(date,root,es,visibleIds),{type:'calendar',color:root.color,subtitle:subNames.length?`부속 ${subNames.length}`:root.period});
  }
  html+=`<div class="scheduleSummaryGrid"><div class="scheduleSummaryLabel">합계</div>${days.map(d=>{const date=ds(d);return `<div class="scheduleSummaryCell">${daySummaryHtml(date,map[date]||[])}</div>`}).join('')}</div></div>`;
  return html;
}
function openEventForSection(date,key){
  const laneKey=String(key||'');
  if(laneKey==='common') return openEvent(date,null,{preset:'common'});
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
function bindScheduleLanes(){
  const main=$('#main');
  if(main) main.style.setProperty('--lane-label-w-user',`${laneLabelWidth()}px`);
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
    handle.ondblclick=e=>{ e.preventDefault(); e.stopPropagation(); state.settings.laneLabelWidth=30; if(main) main.style.setProperty('--lane-label-w-user','30px'); save(); };
    handle.onpointerdown=e=>{
      if(window.matchMedia('(max-width:760px)').matches) return;
      e.preventDefault(); e.stopPropagation();
      const startX=e.clientX, startW=laneLabelWidth();
      handle.setPointerCapture?.(e.pointerId); document.body.classList.add('resizingLaneLabel');
      const move=ev=>{ const w=Math.max(22,Math.min(120,startW+(ev.clientX-startX))); if(main) main.style.setProperty('--lane-label-w-user',`${Math.round(w)}px`); };
      const up=ev=>{ document.removeEventListener('pointermove',move); document.removeEventListener('pointerup',up); document.body.classList.remove('resizingLaneLabel'); const raw=parseFloat(getComputedStyle(main).getPropertyValue('--lane-label-w-user'))||startW; state.settings.laneLabelWidth=Math.max(22,Math.min(120,Math.round(raw))); save(); };
      document.addEventListener('pointermove',move); document.addEventListener('pointerup',up,{once:true});
    };
  });
  $$('[data-lane-toggle]').forEach(btn=>btn.onclick=e=>{
    e.stopPropagation(); const key=btn.dataset.laneToggle; state.settings.laneCollapsed=state.settings.laneCollapsed||{}; state.settings.laneCollapsed[key]=!state.settings.laneCollapsed[key]; save();
  });
  $$('[data-lane-resize]').forEach(handle=>{
    handle.ondblclick=e=>{ e.preventDefault(); const key=handle.dataset.laneResize; const type=key==='common'?'common':key==='quick'?'quick':key==='payment'?'payment':'calendar'; state.settings.laneHeights=state.settings.laneHeights||{}; delete state.settings.laneHeights[key]; save(); };
    handle.onpointerdown=e=>{
      if(window.matchMedia('(max-width:760px)').matches) return;
      e.preventDefault(); e.stopPropagation();
      const lane=handle.closest('.scheduleLane'), key=handle.dataset.laneResize; if(!lane) return;
      const grid=lane.querySelector('.scheduleLaneGrid');
      const startY=e.clientY,startH=Math.max(44,Math.round(grid?.getBoundingClientRect().height||laneHeight(key)));
      handle.setPointerCapture?.(e.pointerId); document.body.classList.add('resizingLane');
      const move=ev=>{ const h=Math.max(44,Math.min(480,startH+(ev.clientY-startY))); lane.style.setProperty('--lane-h',`${Math.round(h)}px`); };
      const up=ev=>{ document.removeEventListener('pointermove',move); document.removeEventListener('pointerup',up); document.body.classList.remove('resizingLane'); const grid=lane.querySelector('.scheduleLaneGrid'); const h=Math.max(44,Math.min(480,Math.round(grid?.getBoundingClientRect().height||startH))); state.settings.laneHeights=state.settings.laneHeights||{}; state.settings.laneHeights[key]=h; save(); };
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
  const visible=visibleCals(), visibleIds=new Set(visible.map(c=>c.id));
  let total=0,totalCap=0,unknown=false,blocked=0;
  for(const root of topLevelCals()){
    const members=laneCalendarMembers(root,visibleIds); if(!members.length) continue;
    const ids=new Set(members.map(c=>c.id));
    total+=(es||[]).filter(e=>ids.has(e.calId)&&!e._prepDay&&!['anniversary','payment'].includes(e.kind)).reduce((a,e)=>a+workloadDuration(e),0);
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
    return `<button type="button" class="mobileDayTab ${cls}" data-mobile-date="${key}" title="${esc([h,hasDiary?'다이어리 작성됨':'다이어리 미작성'].filter(Boolean).join(' · '))}"><span class="mobileDayDow">${['일','월','화','수','목','금','토'][dow]}</span><b>${d.getDate()}</b>${dmark}<small>${fmtH(st.total)}</small><span class="mobileDiaryState" aria-hidden="true">${diaryIconHtml(hasDiary)}</span><span class="mobileDayDots">${mobileDayDotsHtml(es)}</span></button>`;
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
  const normal=(es||[]).filter(e=>ids.has(e.calId)&&!['anniversary','appointment','todo','payment'].includes(e.kind));
  const allForLoad=(es||[]).filter(e=>ids.has(e.calId)&&!e._prepDay&&!['anniversary','payment'].includes(e.kind));
  const sum=allForLoad.reduce((a,e)=>a+workloadDuration(e),0), cap=capacityForDate(root,date);
  const meta=cap.unknown?`${fmtH(sum)} / 미정`:`${fmtH(sum)} / ${fmtH(cap.hours)}${cap.blocked?' · 차단':''}`;
  const body=normal.map(e=>{
    const c=cal(e.calId), isSub=e.calId!==root.id;
    return `<div class="mobileCalendarEvent ${isSub?'sub':''}">${isSub?`<span class="mobileCalTag" style="--tag-color:${esc(c.color)}">↳ ${esc(c.name)}</span>`:''}${eventItemHtml(e,false)}</div>`;
  }).join('');
  return mobileSectionHtml(`cal:${root.id}`,root.name,root.color,body,meta);
}
function renderMobileSchedule(days,map){
  const keys=days.map(ds);
  const today=ds(new Date());
  if(!mobileSelectedDate || !keys.includes(mobileSelectedDate)){
    mobileSelectedDate=keys.includes(today)?today:keys[Math.min(keys.length-1,Math.max(0,diffDays(ds(days[0]),ds(cursor))))];
  }
  const selected=mobileSelectedDate, d=parse(selected), es=map[selected]||[], h=holidayLabel(selected), hasDiary=!!state.diary[selected]?.text;
  const visible=visibleCals(), visibleIds=new Set(visible.map(c=>c.id));
  const common=es.filter(e=>e.kind==='anniversary'||e.kind==='appointment');
  const quick=es.filter(e=>e.kind==='todo');
  const payments=es.filter(e=>e.kind==='payment');
  const stats=mobileDayWorkStats(selected,es);
  const dayMeta=stats.unknown?`${fmtH(stats.total)} · 일부 미정`:(stats.totalCap?`${fmtH(stats.total)} / ${fmtH(stats.totalCap)}`:fmtH(stats.total));
  let sections='';
  sections+=mobileSectionHtml('common','공통 일정','#d9b5cc',mobileCommonBodyHtml(common),`${common.length}건`);
  sections+=mobileSectionHtml('quick','Quick','#cfd5dc',quick.map(e=>eventItemHtml(e,false)).join(''),`${quick.length}건`);
  sections+=mobileSectionHtml('payment','납부','#e6d399',payments.map(e=>eventItemHtml(e,false)).join(''),`${payments.length}건`);
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

function renderWeek(){
  if(!isMobileSchedule() && state.settings?.weekViewMode==='compact'){ renderMultiWeek(1); return; }
  const s=startWeek(cursor), days=[0,1,2,3,4,5,6].map(i=>add(s,i)), map=buildOccurrenceMap(ds(s),ds(days[6]),{calendarIds:focusedCalendarIds()});
  setRangeLabel(`${s.getFullYear()}. ${s.getMonth()+1}. ${s.getDate()} - ${days[6].getFullYear()}. ${days[6].getMonth()+1}. ${days[6].getDate()}${focusSuffix()}`,`${s.getMonth()+1}/${s.getDate()}–${days[6].getMonth()+1}/${days[6].getDate()}${compactFocusSuffix()}`);
  if(isMobileSchedule()){ renderMobileSchedule(days,map); return; }
  $('#main').className='laneView weekLaneView';
  $('#main').innerHTML=scheduleWeekBoard(days,map);
  bindItems(); bindScheduleLanes();
}
function monthCellEventsHtml(date, es){
  const limit=4;
  const priority=e=>e.kind==='anniversary'?0:e.kind==='appointment'?1:e.kind==='todo'?2:e.kind==='payment'?3:4;
  const ordered=[...(es||[])].sort((a,b)=>priority(a)-priority(b));
  const visible=ordered.slice(0,limit);
  const hidden=Math.max(0,ordered.length-visible.length);
  const common=visible.filter(e=>e.kind==='anniversary' || e.kind==='appointment'), quick=visible.filter(e=>e.kind==='todo'), payments=visible.filter(e=>e.kind==='payment'), normal=visible.filter(e=>e.kind!=='payment' && e.kind!=='appointment' && e.kind!=='anniversary' && e.kind!=='todo');
  return `${commonTopLaneHtml(common,true)}${quickLaneHtml(quick,true)}${paymentLaneHtml(payments,true)}${normal.map(e=>eventItemHtml(e,true)).join('')}${hidden?`<button type="button" class="moreEventsBtn" data-more-date="${esc(date)}">+ ${hidden}건</button>`:''}`;
}
function openDayList(date){
  const map=buildOccurrenceMap(date,date,{calendarIds:focusedCalendarIds()});
  const h=holidayLabel(date);
  $('#dayListTitle').textContent=`${date}${h?` · ${h}`:''}`;
  $('#dayListBody').innerHTML=groupHtml(date,map[date]||[]);
  openDialog($('#dayListDlg')); bindItems();
}
$('#closeDayList').onclick=()=>closeDialog($('#dayListDlg'));

function multiWeekCellEventsHtml(date, es, weeks){
  const priority=e=>e.kind==='anniversary'?0:e.kind==='appointment'?1:e.kind==='todo'?2:e.kind==='payment'?3:4;
  const ordered=[...(es||[])].sort((a,b)=>priority(a)-priority(b));
  // v1.82: 일정 개수를 미리 고정 개수로 자르지 않는다.
  // 셀의 실제 높이를 렌더링 후 측정해서 들어가는 만큼 표시한다.
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
  const heads=['월','화','수','목','금','토','일'].map((x,i)=>`<div class="multiCompactWeekday ${i===5?'saturday':i===6?'sunday':''}">${x}</div>`).join('');
  const today=ds(new Date());
  const cells=allDays.map(d=>{
    const key=ds(d), es=map[key]||[], h=holidayLabel(key), dow=d.getDay();
    const cls=[key===today?'today':'',holidayClass(key),dow===0?'sunday':'',dow===6?'saturday':''].filter(Boolean).join(' ');
    return `<div class="multiCompactCell ${cls}" data-dropdate="${key}" ondblclick="window.__newEvent?.('${key}')"><div class="multiCompactDate"><span>${d.getDate()}</span><b title="${h?esc(h):''}">${h?esc(h):''}</b></div>${selectedDdayMarkerHtml(key,'multiDdayOffset')}${multiWeekCellEventsHtml(key,es,weeks)}</div>`;
  }).join('');
  $('#main').innerHTML=heads+cells;
  bindItems();
  $$('.multiCompactMore').forEach(btn=>btn.onclick=e=>{e.stopPropagation();openDayList(btn.dataset.moreDate)});
  scheduleMultiWeekCellFit();
}
function renderMonth(){
  const y=cursor.getFullYear(),m=cursor.getMonth(),first=new Date(y,m,1),s=startWeek(first);
  // 현재 달이 실제로 차지하는 주 수(4/5/6주)만 렌더링합니다.
  // 예: 2026년 10월은 9/28~11/1의 5주만 보여주고, 11/2~11/8은 불필요하므로 만들지 않습니다.
  const monthDays=new Date(y,m+1,0).getDate();
  const mondayOffset=(first.getDay()+6)%7;
  const weekCount=Math.ceil((mondayOffset+monthDays)/7);
  const totalCells=weekCount*7;
  const end=add(s,totalCells-1),map=buildOccurrenceMap(ds(s),ds(end),{calendarIds:focusedCalendarIds()});
  setRangeLabel(`${y}년 ${m+1}월${focusSuffix()}`,`${y}.${m+1}${compactFocusSuffix()}`);
  $('#main').className='month';
  $('#main').style.setProperty('--month-weeks',String(weekCount));
  const heads=['월','화','수','목','금','토','일'].map((x,i)=>`<div class="weekdayHeader ${i===5?'saturday':i===6?'sunday':''}">${x}</div>`).join('');
  const cells=[...Array(totalCells)].map((_,i)=>{
    const d=add(s,i),key=ds(d),es=map[key]||[],hasDiary=!!state.diary[key]?.text,h=holidayLabel(key),dow=d.getDay();
    const cellClass=[d.getMonth()!==m?'other':'',holidayClass(key),dow===0?'sunday':'',dow===6?'saturday':''].filter(Boolean).join(' ');
    const holidayText=h?esc(h):'&nbsp;';
    return `<div class="cell ${cellClass}" data-dropdate="${key}" ondblclick="window.__newEvent?.('${key}')"><div class="mhead"><span>${d.getDate()}</span><button type="button" class="diaryBtn ${hasDiary?'hasDiary':''}" data-diarydate="${key}" title="${hasDiary?'다이어리 보기 · 작성됨':'다이어리 작성 · 미작성'}" aria-label="${hasDiary?'다이어리 작성됨':'다이어리 미작성'}">${diaryIconHtml(hasDiary)}</button></div><div class="holidayName ${h?'':'holidayEmpty'}" title="${h?esc(h):''}">${holidayText}</div>${selectedDdayMarkerHtml(key,'monthDdayOffset')}${monthCellEventsHtml(key,es)}</div>`;
  }).join('');
  $('#main').innerHTML=heads+cells; bindItems();
}

const DAY_LANE_HEIGHT_DEFAULTS={common:112,quick:112,payment:112,calendar:176};
function dayLaneHeight(key,type='calendar'){
  state.settings.dayLaneHeights=state.settings.dayLaneHeights||{};
  const stored=Number(state.settings.dayLaneHeights[key]);
  return stored?Math.max(52,Math.min(640,stored)):(DAY_LANE_HEIGHT_DEFAULTS[type]||176);
}
function dayResizableSectionHtml(key,innerHtml,{type='calendar',color='#d9d9d9'}={}){
  const h=dayLaneHeight(key,type);
  return `<section class="dayResizableSection" data-day-lane-key="${esc(key)}" style="--day-lane-h:${h}px;--day-lane-color:${esc(color)}"><div class="dayResizableContent">${innerHtml}</div><div class="dayLaneHeightResizer" data-day-lane-resize="${esc(key)}" data-day-lane-type="${esc(type)}" title="위아래로 드래그해 구역 높이 조절 · 더블클릭 기본높이"><span></span></div></section>`;
}
function dayViewGroupHtml(date,es){
  const commonTopHtml=dayResizableSectionHtml('common',commonTopLaneHtml(es,false,true),{type:'common',color:'#d9b5cc'});
  const quickHtml=dayResizableSectionHtml('quick',quickLaneHtml(es,false,true),{type:'quick',color:'#cfd5dc'});
  const paymentHtml=dayResizableSectionHtml('payment',paymentLaneHtml(es,false,true),{type:'payment',color:'#e6d399'});
  const appointmentEvents=(es||[]).filter(e=>e.kind==='appointment'&&!e._prepDay);
  const quickEvents=(es||[]).filter(e=>e.kind==='todo'&&!e._prepDay);
  const workEvents=(es||[]).filter(e=>e.kind!=='payment' && e.kind!=='appointment' && e.kind!=='anniversary' && e.kind!=='todo');
  let html='';
  const visible=visibleCals(), visibleIds=new Set(visible.map(c=>c.id));
  let total=appointmentEvents.reduce((sum,e)=>sum+workloadDuration(e),0) + quickEvents.reduce((sum,e)=>sum+workloadDuration(e),0), totalCapacity=0, hasUnknownCapacity=false, blockedRootCount=0;
  for(const root of topLevelCals()){
    const members=[root,...descendants(root.id)].filter(c=>visibleIds.has(c.id));
    if(!members.length) continue;
    const memberIds=new Set(members.map(c=>c.id));
    const groupEvents=workEvents.filter(e=>memberIds.has(e.calId));
    if(!groupEvents.length) continue;
    const rootSum=groupEvents.filter(e=>!e._prepDay).reduce((sum,e)=>sum+workloadDuration(e),0);
    total+=rootSum;
    const rootCapInfo=capacityForDate(root,date);
    if(rootCapInfo.blocked) blockedRootCount++;
    if(rootCapInfo.unknown) hasUnknownCapacity=true; else totalCapacity+=rootCapInfo.hours;
    const rootCollapsed=isDayCalCollapsed(date,root.id);
    const blockedTitle=rootCapInfo.blocked?' · 가용시간 차단 일정 있음':'';
    let body=`<div class="group calendarTreeGroup ${rootCollapsed?'collapsed':''}" style="--group-color:${esc(root.color)}"><div class="groupHead" style="background:${esc(root.color)}55" title="${esc(root.name)}${blockedTitle}">${dayCalHeadHtml(date,root,rootSum,rootCapInfo.hours,rootCapInfo.unknown)}</div><div class="dayCalGroupBody laneMergedDayItems">`;
    body+=laneOrderedItemsHtml(groupEvents,root.id);
    body+=`</div></div>`;
    html+=dayResizableSectionHtml(`cal:${root.id}`,body,{type:'calendar',color:root.color});
  }
  const overallOver=!hasUnknownCapacity && totalCapacity>0 && total>totalCapacity;
  let capacitySummary=hasUnknownCapacity
    ? `${totalCapacity?` · 확인된 가용 ${fmtH(totalCapacity)}`:''} · 일부 가용시간 미정`
    : (totalCapacity?` / 캘린더 가용 ${fmtH(totalCapacity)}`:'');
  if(blockedRootCount) capacitySummary+=` · 가용차단 ${blockedRootCount}개`;
  return commonTopHtml+quickHtml+paymentHtml+html+`<div class="dayTotal ${overallOver?'overallOver':''}">총 계획 ${fmtH(total)}${capacitySummary}</div>`;
}
function bindDayViewResizers(){
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
      delete state.settings.dayLaneHeights[key];
      const section=handle.closest('.dayResizableSection');
      const type=handle.dataset.dayLaneType||'calendar';
      section?.style.setProperty('--day-lane-h',`${DAY_LANE_HEIGHT_DEFAULTS[type]||176}px`);
      save({rerender:false});
    };
    handle.onpointerdown=e=>{
      if(e.pointerType==='mouse' && e.button!==0) return;
      e.preventDefault(); e.stopPropagation();
      const section=handle.closest('.dayResizableSection'), key=handle.dataset.dayLaneResize;
      if(!section) return;
      const type=handle.dataset.dayLaneType||'calendar';
      const startY=e.clientY, startH=dayLaneHeight(key,type);
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
  });
}

function renderDay(){
  const d=ds(cursor),map=buildOccurrenceMap(d,d,{calendarIds:focusedCalendarIds()}),hasDiary=!!state.diary[d]?.text;
  const h=holidayLabel(d); setRangeLabel(`${d}${focusSuffix()}`,`${d.slice(5).replace('-', '/')}${compactFocusSuffix()}`); $('#main').className='daySingle';
  $('#main').innerHTML=`${h?`<div class="dayHolidayBanner">${esc(h)}</div>`:''}${selectedDdayMarkerHtml(d,'dayViewDdayOffset')}<div class="diaryStrip"><button type="button" class="diaryBtn ${hasDiary?'hasDiary':''}" data-diarydate="${d}" title="${hasDiary?'다이어리 보기 · 작성됨':'다이어리 작성 · 미작성'}">${diaryIconHtml(hasDiary)} ${hasDiary?'다이어리 보기':'다이어리 작성'}</button></div><div class="dayResizableBoard" data-dropdate="${d}" ondblclick="window.__newEvent?.('${d}')">${dayViewGroupHtml(d,map[d]||[])}</div>`; bindItems(); bindDayViewResizers();
}
function renderList(){
  const start=ds(add(new Date(),-30)),end=ds(add(new Date(),365));
  const focus=calendarFocusId?state.calendars.find(c=>c.id===calendarFocusId):null;
  const allowed=focus?new Set([focus.id,...descendants(focus.id).map(c=>c.id)]):null;
  const map=buildOccurrenceMap(start,end,{calendarIds:allowed});
  const rows=[]; for(const [date,es] of Object.entries(map)) for(const e of es){ if((e._occurrenceStart||e.date)===date) rows.push({date,e}); }
  setRangeLabel(focus?`${focus.name} 관련 일정`:'일정 목록',focus?`${focus.name} 목록`:'목록'); $('#main').className='listView';
  let last='';
  let top='';
  if(focus){
    const sourceEvents=state.events.filter(e=>allowed.has(e.calId));
    const manualFixed=state.fixed.filter(f=>allowed.has(f.calId));
    const kindCount=type=>sourceEvents.filter(e=>e.kind===type).length;
    top=`<div class="calendarFocusHeader" style="border-left-color:${esc(focus.color)}"><div><b>${esc(calendarPath(focus.id))}</b><small>${descendants(focus.id).length?'부속 캘린더 포함 · ':''}일정 ${kindCount('event')} · 예약·약속 ${kindCount('appointment')} · Quick ${kindCount('todo')} · 습관 ${kindCount('habit')} · 기념일 ${kindCount('anniversary')} · 납부 ${kindCount('payment')} · 날짜지정 ${manualFixed.length}</small></div><button id="clearCalendarFocus" type="button">전체 일정 보기</button></div>`;
    if(manualFixed.length){
      top+=`<div class="calendarFocusFixed"><b>날짜 지정 배치 업무</b>${manualFixed.map(f=>`<button type="button" class="focusFixedItem" data-fid="${esc(f.id)}" style="border-left-color:${esc(cal(f.calId).color)}"><span>${esc(f.name)}</span><small>${esc(calendarPath(f.calId))} · ${esc(durationLabel(f))}</small></button>`).join('')}</div>`;
    }
  }
  const note=`<div class="listNote">오늘 기준 과거 30일 ~ 앞으로 1년의 ${focus?'선택한 캘린더 관련 ':''}일정입니다. 반복 일정도 각 발생일에 표시됩니다.</div>`;
  $('#main').innerHTML=top+note+(rows.map(({date,e})=>{let h='';if(last!==date){last=date;h=`<div class="listDate ${holidayClass(date)}">${date}${holidayLabel(date)?` · ${esc(holidayLabel(date))}`:''}</div>`}return h+eventItemHtml(e);}).join('')||'<div class="empty">등록된 일정이 없습니다.</div>');
  $('#clearCalendarFocus')?.addEventListener('click',()=>{calendarFocusId=null; render();});
  $$('.focusFixedItem').forEach(x=>x.onclick=()=>openFixed(x.dataset.fid));
  bindItems();
}
function render(){
  const sidebar=$('#sidebar'), main=$('#main');
  const keep={sidebarTop:sidebar?.scrollTop||0,sidebarLeft:sidebar?.scrollLeft||0,mainTop:main?.scrollTop||0,mainLeft:main?.scrollLeft||0};
  renderSide();
  $$('.views [data-view]').forEach(b=>b.classList.toggle('on',b.dataset.view===view));
  const weekBtn=$('.views [data-view="week"]');
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
}
function updateRepeatEndUI(){
  const t=$('#repeatEndType').value;
  $('#repeatEndDateWrap').classList.toggle('hidden',t!=='date');
  $('#repeatCountWrap').classList.toggle('hidden',t!=='count');
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
function prepRuleDescription(task,deadline){
  if(task.type==='date') return `${preparationDateLabel(task.date)} · ${task.text}`;
  const entries=prepTaskEntriesFromValues(deadline,[task]);
  const first=entries[0]?.date||task.startDate||'';
  const last=entries.at(-1)?.date||'';
  const count=entries.length;
  return `매주 ${weekdayName(Number(task.weekday)||0)} · ${task.startDate}부터 · ${count?`${count}회${first&&last?` (${first}${first!==last?`~${last}`:''})`:''}`:'해당일 없음'} · ${task.text}`;
}
function renderPrepTaskRules(){
  const list=$('#prepRuleList'); if(!list) return;
  const deadline=$('#prepDeadline')?.value||$('#date')?.value||'';
  if(!prepDraftTasks.length){ list.innerHTML='<div class="prepRuleEmpty">아직 준비 일정이 없습니다. 특정 날짜 또는 매주 반복 일정을 추가하세요.</div>'; return; }
  list.innerHTML=prepDraftTasks.map(task=>`<div class="prepRuleItem" data-prep-rule-id="${esc(task.id)}"><div><b>${task.type==='weekly'?'매주 반복':'특정 날짜'}</b><span>${esc(prepRuleDescription(task,deadline))}</span></div><button type="button" class="prepRuleDelete" data-prep-rule-delete="${esc(task.id)}" title="삭제">×</button></div>`).join('');
}
function renderPrepDailyRows(){
  const wrap=$('#prepDailyRows'), summary=$('#prepCalcSummary'); if(!wrap||!summary) return;
  collectPrepDailyNotes();
  const enabled=!!$('#prepEnabled')?.checked;
  $('#prepDetails')?.classList.toggle('hidden',!enabled);
  if(!enabled){ wrap.innerHTML=''; summary.textContent=''; return; }
  const mode=$('#prepMode')?.value==='custom'?'custom':'auto';
  $('#prepAutoFields')?.classList.toggle('hidden',mode!=='auto');
  $('#prepAutoEditor')?.classList.toggle('hidden',mode!=='auto');
  $('#prepCustomFields')?.classList.toggle('hidden',mode!=='custom');
  const deadline=$('#prepDeadline').value||$('#date').value;
  if(!deadline){ summary.textContent='기한 날짜를 입력하세요.'; summary.classList.add('warn'); wrap.innerHTML=''; renderPrepTaskRules(); return; }
  summary.classList.remove('warn');
  if(mode==='custom'){
    wrap.innerHTML='';
    const entries=prepCustomEntriesFromForm(), dates=[...new Set(entries.map(x=>x.date))].sort();
    if(entries.length){
      const range=dates[0]===dates.at(-1)?dates[0]:`${dates[0]} ~ ${dates.at(-1)}`;
      summary.textContent=`직접 지정: 준비 ${range} · ${entries.length}건${entries.length!==dates.length?`/${dates.length}일`:''} → 마감 ${deadline}`;
    }else summary.textContent=`직접 지정: 필요한 날짜·반복 일정을 추가하세요. → 마감 ${deadline}`;
    renderPrepTaskRules();
    return;
  }
  const dates=prepFormDates();
  if(!dates.length){ summary.textContent='준비일수를 입력하세요.'; summary.classList.add('warn'); wrap.innerHTML=''; return; }
  const range=dates[0]===dates.at(-1)?dates[0]:`${dates[0]} ~ ${dates.at(-1)}`;
  summary.textContent=`자동 계산: 준비 ${range} · ${dates.length}일${$('#prepWeekdaysOnly').checked?'(평일만)':''} → 마감 ${deadline}`;
  wrap.innerHTML=dates.map(date=>`<label class="prepDailyRow"><span class="prepDailyDate">${esc(preparationDateLabel(date))}</span><input data-prep-date="${esc(date)}" value="${esc(prepDraftNotes[date]||'')}" placeholder="이날 진행할 내용"></label>`).join('');
}
function updatePrepUI(){
  const supported=!['anniversary','payment'].includes($('#kind')?.value||'event');
  $('#prepFields')?.classList.toggle('hidden',!supported);
  if(!supported && $('#prepEnabled')) $('#prepEnabled').checked=false;
  renderPrepDailyRows();
}
function addPrepDateTask(){
  const date=$('#prepOneDate')?.value||'', text=String($('#prepOneText')?.value||'').trim(), deadline=$('#prepDeadline')?.value||'';
  if(!date || !text){ alert('준비 날짜와 할 일을 입력하세요.'); return; }
  if(deadline && date>deadline){ alert('준비 날짜는 기한 날짜보다 늦을 수 없습니다.'); return; }
  prepDraftTasks.push({id:uid(),type:'date',date,text,startDate:'',weekday:0});
  $('#prepOneText').value=''; renderPrepDailyRows();
}
function addPrepWeeklyTask(){
  const startDate=$('#prepWeeklyStart')?.value||'', weekday=Number($('#prepWeeklyWeekday')?.value)||0, text=String($('#prepWeeklyText')?.value||'').trim(), deadline=$('#prepDeadline')?.value||'';
  if(!startDate || !text){ alert('반복 시작일과 할 일을 입력하세요.'); return; }
  if(deadline && startDate>=deadline){ alert('반복 시작일은 기한 날짜보다 앞이어야 합니다.'); return; }
  const test=prepTaskEntriesFromValues(deadline,[{id:'test',type:'weekly',startDate,weekday,text}]);
  if(deadline && !test.length){ alert('선택한 시작일·요일로는 마감 전에 생성되는 일정이 없습니다.'); return; }
  prepDraftTasks.push({id:uid(),type:'weekly',startDate,weekday,text,date:''});
  $('#prepWeeklyText').value=''; renderPrepDailyRows();
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
  $('#eid').value=e?.id||''; $('#title').value=e?.title||''; $('#important').checked=!!e?.important; $('#cal').value=e?.calId||requestedCalId||cals()[0]?.id||'';
  $('#date').value=e?.date||date||ds(cursor); $('#endDate').value=e?.endDate||e?.date||date||ds(cursor);
  $('#allDay').checked=e?.allDay??true; $('#start').value=e?.start||''; $('#end').value=e?.end||''; setDurationInputs(e?.hours??1); $('#noDuration').checked=paymentPreset?true:!!e?.noDuration;
  $('#kind').value=e?.kind||(paymentPreset?'payment':(quickPreset?'todo':(commonPreset?'appointment':(recurringPreset?'todo':'event')))); $('#place').value=e?.place||''; $('#repeat').value=e?.repeat||(paymentPreset?'monthly':(recurringPreset?'weekly':'none')); $('#memo').value=e?.memo||'';
  // 새 일정은 이전에 열었던 일정의 준비/마감 정보를 절대 이어받지 않는다.
  if(e){
    prepDraftNotes={...(e.prepDailyNotes||{})};
    prepDraftTasks=(e.prepTasks||[]).map(x=>({...x}));
    $('#prepEnabled').checked=!!e.prepEnabled;
    $('#prepDeadline').value=e.prepDeadline||e.date||'';
    $('#prepMode').value=e.prepMode==='custom'?'custom':'auto';
    $('#prepDays').value=Math.max(1,Number(e.prepDays)||5);
    $('#prepWeekdaysOnly').checked=!!e.prepWeekdaysOnly;
    $('#prepIncludeDeadline').checked=!!e.prepIncludeDeadline;
  }else{
    prepDraftNotes={}; prepDraftTasks=[];
    $('#prepEnabled').checked=false;
    $('#prepDeadline').value='';
    $('#prepMode').value='auto';
    $('#prepDays').value=5;
    $('#prepWeekdaysOnly').checked=false;
    $('#prepIncludeDeadline').checked=false;
    if($('#prepDailyRows')) $('#prepDailyRows').innerHTML='';
    if($('#prepRuleList')) $('#prepRuleList').innerHTML='';
    if($('#prepCalcSummary')) $('#prepCalcSummary').textContent='';
  }
  if($('#prepOneDate')) $('#prepOneDate').value='';
  if($('#prepOneText')) $('#prepOneText').value='';
  if($('#prepWeeklyStart')) $('#prepWeeklyStart').value='';
  if($('#prepWeeklyWeekday')) $('#prepWeeklyWeekday').value='1';
  if($('#prepWeeklyText')) $('#prepWeeklyText').value='';
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
    const canComplete=!!e && e.kind!=='anniversary';
    doneWrap.classList.toggle('hidden',!canComplete);
    if(canComplete){ doneInput.checked=!!isDone(occurrenceView); doneText.textContent=e.kind==='payment'?'납부완료':'완료'; }
  }
  $('#carryEvent').classList.toggle('hidden',!e || e.kind==='anniversary' || e.kind==='payment' || (occurrenceView&&isDone(occurrenceView)));
  updateAllDayUI(); updateKindUI(); setRepeatRule(e||{date:$('#date').value,repeat:$('#repeat').value,repeatRule:null}); updateDurationMode(); updatePrepUI();
  openDialog($('#eventDlg'));
}
window.__newEvent=openEvent;
function openDialog(d){ if(!d.open) d.showModal(); }
function closeDialog(d){ if(d.open) d.close(); }

$('#eventForm').onsubmit=e=>{
  e.preventDefault();
  const id=$('#eid').value, old=state.events.find(x=>x.id===id);
  if($('#endDate').value && $('#endDate').value<$('#date').value){ alert('종료일은 시작일보다 빠를 수 없습니다.'); return; }
  if(!$('#allDay').checked && $('#start').value && $('#end').value && $('#end').value<=$('#start').value && $('#date').value===$('#endDate').value){ alert('종료 시간은 시작 시간보다 늦어야 합니다.'); return; }
  if($('#repeat').value!=='none' && $('#repeatEndType').value==='date' && !$('#repeatEndDate').value){ alert('반복 종료 날짜를 선택하세요.'); return; }
  if($('#repeat').value!=='none' && $('#repeatEndType').value==='date' && $('#repeatEndDate').value<$('#date').value){ alert('반복 종료 날짜는 시작 날짜보다 빠를 수 없습니다.'); return; }
  if($('#repeat').value==='yearly' && $('#yearlyCalendar').value==='lunar' && !lunarFormatter){ alert('현재 브라우저에서는 음력 날짜 변환을 지원하지 않습니다.'); return; }
  const prepEnabled=!!$('#prepEnabled').checked && !['anniversary','payment'].includes($('#kind').value);
  if(prepEnabled && $('#repeat').value!=='none'){ alert('준비기간이 있는 기한 일정은 반복 없음으로 등록해 주세요.'); return; }
  if(prepEnabled && !$('#prepDeadline').value){ alert('기한 날짜를 선택하세요.'); return; }
  if(prepEnabled){ $('#date').value=$('#prepDeadline').value; $('#endDate').value=$('#prepDeadline').value; }
  collectPrepDailyNotes();
  const repeat=$('#repeat').value;
  const checklist=checklistFromText($('#checklistText').value,checklistItems(old||{}));
  const checklistDoneByDate=cleanedChecklistDoneMap(old?.checklistDoneByDate||{},checklist);
  const obj={
    id:id||uid(), title:$('#title').value.trim(), important:$('#important').checked, calId:$('#cal').value, date:$('#date').value,
    endDate:$('#endDate').value||$('#date').value, allDay:$('#allDay').checked,
    start:$('#allDay').checked?'':$('#start').value, end:$('#allDay').checked?'':$('#end').value,
    hours:$('#kind').value==='payment'?0:(timedHoursFromForm()??getDurationInputs()), noDuration:$('#kind').value==='payment'?true:($('#noDuration').checked && timedHoursFromForm()===null), kind:$('#kind').value, place:$('#place').value.trim(),
    paymentAmount:$('#kind').value==='payment'?Math.max(0,Number($('#paymentAmount').value)||0):0, paymentMethod:$('#kind').value==='payment'?$('#paymentMethod').value.trim():'',
    prepEnabled, prepDeadline:prepEnabled?$('#prepDeadline').value:'', prepMode:prepEnabled&&$('#prepMode').value==='custom'?'custom':'auto', prepDays:prepEnabled?Math.max(1,Number($('#prepDays').value)||1):5, prepWeekdaysOnly:prepEnabled&&!!$('#prepWeekdaysOnly').checked, prepIncludeDeadline:prepEnabled&&!!$('#prepIncludeDeadline').checked, prepDailyNotes:prepEnabled&&$('#prepMode').value!=='custom'?Object.fromEntries(prepFormDates().map(d=>[d,String(prepDraftNotes[d]||'').trim()]).filter(([,v])=>v)):{}, prepTasks:prepEnabled&&$('#prepMode').value==='custom'?prepDraftTasks.map(x=>({...x})):[], prepDone:prepEnabled?{...(old?.prepDone||{})}:{}, prepMoves:prepEnabled?{...(old?.prepMoves||{})}:{},
    availabilityBlock:!['payment','anniversary'].includes($('#kind').value) && !!$('#availabilityBlock').checked,
    availabilityTargetCalId:(!['payment','anniversary'].includes($('#kind').value) && $('#availabilityBlock').checked)?($('#availabilityTarget').value||defaultAvailabilityTargetForSelectedCalendar()):'',
    repeat, repeatRule:repeat==='none'?null:getRepeatRule(), memo:$('#memo').value,
    checklist, checklistDoneByDate, orderByDate:old?.orderByDate||{},
    done:old?.done||false, doneDates:old?.doneDates||[], excludedDates:old?.excludedDates||[], fixedId:old?.fixedId||null
  };
  if(!obj.title) return;
  if(checklist.length){
    const preview={...(old||{}),...obj};
    if(repeat==='none') obj.done=checklistProgress({...preview,_occurrenceStart:obj.date},obj.date).complete;
    else obj.doneDates=(obj.doneDates||[]).filter(date=>checklistProgress({...preview,_occurrenceStart:date},date).complete);
  }
  if(id) state.events[state.events.findIndex(x=>x.id===id)]={...old,...obj}; else state.events.push(obj);
  activeEventOccurrence=null; closeDialog($('#eventDlg')); save();
};
$('#cancelEvent').onclick=()=>{ activeEventOccurrence=null; closeDialog($('#eventDlg')); };
$('#eventDone').onchange=()=>{
  const id=$('#eid').value, ev=state.events.find(x=>x.id===id); if(!ev || ev.kind==='anniversary') return;
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
$('#togglePurchase').onclick=()=>{ state.settings.fixedPanelsCollapsed.purchase=!state.settings.fixedPanelsCollapsed.purchase; save(); };
$('#purchaseForm').onsubmit=e=>{ e.preventDefault(); const id=$('#purchaseId').value, old=state.purchases.find(x=>x.id===id), maxOrder=(state.purchases||[]).reduce((m,p)=>Math.max(m,Number(p.order)||0),-1), obj={id:id||uid(),name:$('#purchaseName').value.trim(),qty:Math.max(1,Number($('#purchaseQty').value)||1),memo:$('#purchaseMemo').value,done:$('#purchaseDone').checked,createdAt:old?.createdAt||new Date().toISOString(),order:old?.order??(maxOrder+1)}; if(!obj.name) return; if(id) state.purchases[state.purchases.findIndex(x=>x.id===id)]=obj; else state.purchases.push(obj); closeDialog($('#purchaseDlg')); save(); };
$('#cancelPurchase').onclick=()=>closeDialog($('#purchaseDlg'));
$('#deletePurchase').onclick=()=>{ const id=$('#purchaseId').value; if(id&&confirm('이 구매항목을 삭제할까요?')){ state.purchases=state.purchases.filter(x=>x.id!==id); closeDialog($('#purchaseDlg')); save(); } };
$('#allDay').onchange=updateAllDayUI; $('#noDuration').onchange=()=>updateDurationMode(); $('#kind').onchange=updateKindUI; $('#availabilityBlock').onchange=updateAvailabilityBlockUI; $('#cal').onchange=()=>{ if($('#availabilityBlock').checked){ const v=defaultAvailabilityTargetForSelectedCalendar(); if([...$('#availabilityTarget').options].some(o=>o.value===v)) $('#availabilityTarget').value=v; } }; $('#start').onchange=updateDurationMode; $('#end').onchange=updateDurationMode; $('#endDate').onchange=updateDurationMode; $('#repeat').onchange=updateRepeatUI;
$('#prepEnabled').onchange=()=>{ if($('#prepEnabled').checked){ if(!$('#eid').value){ prepDraftNotes={}; prepDraftTasks=[]; } $('#prepDeadline').value=$('#date').value||ds(cursor); $('#repeat').value='none'; updateRepeatUI(); } updatePrepUI(); };
$('#prepDeadline').onchange=()=>{ if($('#prepDeadline').value){ $('#date').value=$('#prepDeadline').value; $('#endDate').value=$('#prepDeadline').value; updateDurationMode(); } renderPrepDailyRows(); };
$('#prepMode').onchange=()=>{ collectPrepDailyNotes(); renderPrepDailyRows(); };
$('#prepDays').oninput=renderPrepDailyRows; $('#prepWeekdaysOnly').onchange=renderPrepDailyRows; $('#prepIncludeDeadline').onchange=renderPrepDailyRows;
$('#addPrepOne').onclick=addPrepDateTask; $('#addPrepWeekly').onclick=addPrepWeeklyTask;
$('#prepRuleList').onclick=e=>{ const b=e.target.closest('[data-prep-rule-delete]'); if(!b) return; const id=b.dataset.prepRuleDelete; prepDraftTasks=prepDraftTasks.filter(x=>x.id!==id); renderPrepDailyRows(); };
$('#date').onchange=()=>{
  if($('#prepEnabled').checked){ $('#prepDeadline').value=$('#date').value; $('#endDate').value=$('#date').value; renderPrepDailyRows(); }
  if(!$('#endDate').value || $('#endDate').value<$('#date').value) $('#endDate').value=$('#date').value;
  const d=parse($('#date').value), lp=lunarPartsFromSolar(d);
  $('#yearlyMonth').value=d.getMonth()+1; $('#yearlyDay').value=d.getDate();
  if($('#yearlyCalendar').value==='lunar' && lp){ $('#lunarMonth').value=lp.month; $('#lunarDay').value=lp.day; $('#lunarLeap').checked=!!lp.leap; }
  updateRepeatUI(); updateDurationMode();
}; $('#monthlyMode').onchange=updateMonthlyRepeatUI; $('#monthlyMonthEnd').onchange=updateMonthlyRepeatUI; $('#repeatEndType').onchange=updateRepeatEndUI;
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
syncDateNavPlacement();
window.addEventListener('resize',syncDateNavPlacement,{passive:true});
$('#jumpDate').onchange=e=>{ if(e.target.value){cursor=parse(e.target.value);render();} };
$('#diaryMainShortcut').onclick=()=>{ if(view==='diary'){ view=lastScheduleView||'week'; } else { lastScheduleView=view; view='diary'; } render(); };
$$('.views [data-view]').forEach(b=>b.onclick=()=>{
  const next=b.dataset.view;
  if(next==='week' && view==='week' && !isMobileSchedule()){
    state.settings.weekViewMode=state.settings.weekViewMode==='compact'?'detailed':'compact';
    lastScheduleView='week';
    save();
    return;
  }
  view=next; if(view!=='diary') lastScheduleView=view; render();
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
  const btn=$('#manualSaveBtn'), original=btn.textContent;
  btn.disabled=true; btn.textContent='저장 중…';
  try{
    if(!navigator.onLine){ setSyncStatus('오프라인 · 기기 저장완료','offline'); alert('인터넷 연결이 없어 기기에만 저장했습니다. 온라인이 된 뒤 다시 최신자료 저장을 눌러주세요.'); return; }
    if(!remoteRef){ alert('Firebase 연결이 아직 준비되지 않았습니다. 잠시 후 다시 눌러주세요.'); return; }
    const wasReady=syncReady; syncReady=true;
    const ok=await writeRemoteNow('manual');
    syncReady=wasReady || ok;
    if(ok){ btn.textContent='저장완료 ✓'; setTimeout(()=>{btn.textContent=original;},1200); }
    else alert('Firebase 저장에 실패했습니다. 인터넷 연결과 로그인 상태를 확인하세요.');
  }finally{
    btn.disabled=false;
    if(btn.textContent==='저장 중…') btn.textContent=original;
  }
}
$('#manualSaveBtn').onclick=manualSaveNow;

function downloadBackup(){
  if(!currentUser) return;
  const now=new Date();
  const payload={
    type:'my-calendar-backup',
    appVersion:'1.89',
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
['eventDlg','repeatDeleteDlg','repeatMoveDlg','carryDlg','calDlg','fixedDlg','diaryDlg','searchDlg','settingsDlg'].forEach(id=>{
  const d=$(`#${id}`); d.addEventListener('cancel',()=>{});
});

loadHolidayData();
render();
