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
  version: '1.21',
  calendars: [
    {id:'work',name:'아도라블',color:'#bfe8c9',order:1,period:'오전',capacity:5,parentId:''},
    {id:'personal',name:'개인업무',color:'#d9d9d9',order:2,period:'오후',capacity:3,parentId:''},
    {id:'family',name:'가족/개인',color:'#f6e8a6',order:3,period:'저녁',capacity:2,parentId:''}
  ],
  events: [],
  fixed: [],
  diary: {},
  settings: { hiddenCalendars: [], fixedPanelsCollapsed: { recurring:false, manual:false } }
});

let state = defaultState();
let cursor = new Date();
let view = 'week';
let currentUser = null;
let unsubscribeDoc = null;
let remoteRef = null;
let syncReady = false;
let applyingRemote = false;
let saveTimer = null;
let selectedFixedFilter = 'all';
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

function normalizeState(raw){
  const d = defaultState();
  const s = raw && typeof raw === 'object' ? raw : {};
  const calendars = Array.isArray(s.calendars) && s.calendars.length ? s.calendars.map((c,i)=>(
    {
      id:c.id||uid(), name:c.name||`캘린더 ${i+1}`, color:c.color||'#d9d9d9',
      order:Number(c.order)||i+1, period:c.period||'종일', capacity:Number(c.capacity)||0,
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
    version: '1.21',
    calendars,
    events: Array.isArray(s.events) ? s.events.filter(e=>e && e.id && e.title && e.date).map(e=>({
      ...e,
      endDate:e.endDate||e.date,
      allDay:e.allDay !== false,
      hours:Number(e.hours)||0,
      noDuration:!!e.noDuration,
      kind:e.kind||'event',
      repeat:e.repeat||'none',
      repeatRule:e.repeatRule||null,
      done:!!e.done,
      doneDates:Array.isArray(e.doneDates)?e.doneDates:[],
      carryoverCount:Math.max(0,Number(e.carryoverCount)||0),
      carryoverFromDate:typeof e.carryoverFromDate==='string'?e.carryoverFromDate:'',
      carryoverRootId:typeof e.carryoverRootId==='string'?e.carryoverRootId:'',
      carryoverParentId:typeof e.carryoverParentId==='string'?e.carryoverParentId:'',
      carryoverHistory:Array.isArray(e.carryoverHistory)?e.carryoverHistory.filter(r=>r&&r.fromDate&&r.toDate).map(r=>({
        fromDate:String(r.fromDate),toDate:String(r.toDate),childId:String(r.childId||''),remainingHours:Number(r.remainingHours)||0
      })):[]
    })) : [],
    fixed: Array.isArray(s.fixed) ? s.fixed.filter(f=>f && f.id && f.name).map(f=>({...f,hours:Number(f.hours)||0,noDuration:!!f.noDuration})) : [],
    diary: s.diary && typeof s.diary === 'object' ? s.diary : {},
    settings: {
      hiddenCalendars: Array.isArray(s.settings?.hiddenCalendars) ? s.settings.hiddenCalendars : [],
      fixedPanelsCollapsed: {
        recurring: !!s.settings?.fixedPanelsCollapsed?.recurring,
        manual: !!s.settings?.fixedPanelsCollapsed?.manual
      }
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
function cal(id){ return state.calendars.find(x=>x.id===id) || state.calendars[0] || {id:'',name:'미지정',color:'#ddd',order:999,capacity:0,period:'종일',parentId:''}; }
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
  const hidden=new Set(state.settings.hiddenCalendars||[]);
  let cur=state.calendars.find(c=>c.id===id), seen=new Set();
  while(cur){
    if(hidden.has(cur.id)) return true;
    if(!cur.parentId || seen.has(cur.parentId)) break;
    seen.add(cur.id); cur=state.calendars.find(c=>c.id===cur.parentId);
  }
  return false;
}
function visibleCals(){ return cals().filter(c=>!isCalendarHidden(c.id)); }
function calendarPath(id){
  let cur=state.calendars.find(c=>c.id===id); if(!cur) return '미지정';
  const parts=[], seen=new Set();
  while(cur && !seen.has(cur.id)){ parts.unshift(cur.name); seen.add(cur.id); cur=cur.parentId?state.calendars.find(c=>c.id===cur.parentId):null; }
  return parts.join(' › ');
}
function duration(e){ return e?.noDuration ? 0 : (Number(e?.hours)||0); }
function durationLabel(e){ return e?.noDuration ? '소요시간 미체크' : fmtH(Number(e?.hours)||0); }
function fmtH(h){
  const m = Math.round((Number(h)||0)*60);
  if(m<=0) return '0시간';
  return m%60 ? `${Math.floor(m/60)}시간 ${m%60}분` : `${m/60}시간`;
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
    yearlyMonth:d.getMonth()+1,
    yearlyDay:d.getDate(),
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
    for(let k=0;guard++<1000;k++){
      const y=base.getFullYear()+k*rule.interval;
      const d=validLocalDate(y,Number(rule.yearlyMonth)-1,Number(rule.yearlyDay));
      if(!d) continue;
      if(d<base) continue;
      const cont=tryPush(d);
      if(!cont || d>rEnd) break;
    }
  }
  return out;
}

function buildOccurrenceMap(rangeStart, rangeEnd){
  const map={};
  for(let d=parse(rangeStart), end=parse(rangeEnd); d<=end; d=add(d,1)) map[ds(d)]=[];
  const hidden = new Set(state.settings.hiddenCalendars||[]);
  for(const e of state.events){
    if(hidden.has(e.calId)) continue;
    const span=Math.max(0,diffDays(e.date,e.endDate||e.date));
    const starts=generateOccurrenceStarts(e, ds(add(parse(rangeStart),-span)), rangeEnd);
    for(const start of starts){
      const occStart=ds(start), occEnd=ds(add(start,span));
      for(let d=new Date(Math.max(start,parse(rangeStart))); d<=parse(rangeEnd) && d<=add(start,span); d=add(d,1)){
        const k=ds(d);
        if(map[k]) map[k].push({...e,_occurrenceStart:occStart,_occurrenceEnd:occEnd});
      }
    }
  }
  for(const k of Object.keys(map)){
    map[k].sort((a,b)=>(cal(a.calId).order-cal(b.calId).order) || ((a.allDay===b.allDay)?0:(a.allDay?-1:1)) || (a.start||'').localeCompare(b.start||'') || a.title.localeCompare(b.title));
  }
  return map;
}
function isDone(e){
  if(!['todo','habit'].includes(e.kind)) return false;
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
function kindPrefix(e){
  if(e.kind==='todo') return '☐ ';
  if(e.kind==='habit') return '◇ ';
  if(e.kind==='anniversary') return '♥ ';
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
function eventItemHtml(e, compact=false){
  const c=cal(e.calId), done=isDone(e), checkable=['todo','habit'].includes(e.kind);
  const meta=[];
  if(!e.allDay && e.start) meta.push(e.start + (e.end?`–${e.end}`:''));
  if(e.noDuration) meta.push('⏱ 소요시간 미체크');
  else if(duration(e)) meta.push(`⏱ ${fmtH(duration(e))}`);
  if(e.place) meta.push(`📍 ${esc(e.place)}`);
  const drag=(e.repeat||'none')==='none' ? 'true' : 'false';
  const inLabel=carryoverInLabel(e), outRecord=carryoverOutRecord(e);
  const badges=`${inLabel?`<span class="carryBadge carryIn">${esc(inLabel)}</span>`:''}${outRecord?`<span class="carryBadge carryOut">부분완료 · 이월</span>`:''}`;
  if(outRecord && !compact) meta.push(`↪ ${esc(outRecord.toDate)}로 이어짐`);
  return `<div class="item ${done?'done':''} ${inLabel?'carriedIn':''} ${outRecord?'carriedOut':''}" draggable="${drag}" data-eid="${esc(e.id)}" data-occurrence="${esc(e._occurrenceStart||e.date)}" style="border-left-color:${esc(c.color)}">
    <div class="itemRow">${checkable?`<button type="button" class="todoCheck" data-action="toggle" aria-label="완료 전환">${done?'☑':'☐'}</button>`:''}<div class="itemTitle">${!checkable?kindPrefix(e):''}${esc(e.title)}${repeatShort(e)?` <span class="repeatMark">${repeatShort(e)}</span>`:''}${badges}</div></div>
    ${compact?'':`<div class="meta">${meta.join(' · ')}</div>`}
  </div>`;
}
function capacityText(sum, cap){
  const n=Number(cap)||0;
  if(!n) return `<span>${fmtH(sum)}</span>`;
  return `<span class="${sum>n?'over':'ok'}">${fmtH(sum)} / ${fmtH(n)}</span>`;
}
function groupHtml(date, es){
  let html='';
  const visible=visibleCals(), visibleIds=new Set(visible.map(c=>c.id));
  let total=0, totalCapacity=0;
  for(const root of topLevelCals().filter(c=>visibleIds.has(c.id))){
    const members=[root,...descendants(root.id)].filter(c=>visibleIds.has(c.id));
    const memberIds=new Set(members.map(c=>c.id));
    const groupEvents=es.filter(e=>memberIds.has(e.calId));
    if(!groupEvents.length) continue;
    const rootSum=groupEvents.reduce((sum,e)=>sum+duration(e),0);
    total+=rootSum;
    const fallbackCap=members.filter(c=>c.id!==root.id && groupEvents.some(e=>e.calId===c.id)).reduce((sum,c)=>sum+(Number(c.capacity)||0),0);
    const effectiveRootCap=(Number(root.capacity)||0) || fallbackCap;
    totalCapacity+=effectiveRootCap;
    html += `<div class="group calendarTreeGroup"><div class="groupHead" style="background:${esc(root.color)}55"><span>${esc(root.name)} · ${esc(root.period)}</span>${capacityText(rootSum,effectiveRootCap)}</div>`;
    const direct=groupEvents.filter(e=>e.calId===root.id);
    if(direct.length) html += direct.map(e=>eventItemHtml(e)).join('');
    for(const child of members.filter(c=>c.id!==root.id)){
      const xs=groupEvents.filter(e=>e.calId===child.id); if(!xs.length) continue;
      const sum=xs.reduce((n,e)=>n+duration(e),0), depth=Math.max(1,calendarDepth(child.id));
      html += `<div class="subCalGroup" style="--sub-depth:${depth}"><div class="subCalHead" style="border-left-color:${esc(child.color)}"><span>↳ ${esc(child.name)} · ${esc(child.period)}</span>${capacityText(sum,child.capacity)}</div>${xs.map(e=>eventItemHtml(e)).join('')}</div>`;
    }
    html += `</div>`;
  }
  const overallOver=totalCapacity>0 && total>totalCapacity;
  return html + `<div class="dayTotal ${overallOver?'overallOver':''}">총 계획 ${fmtH(total)}${totalCapacity?` / 캘린더 가용 ${fmtH(totalCapacity)}`:''}</div>`;
}

function calendarOptionsHtml(){
  return cals().map(c=>{
    const depth=calendarDepth(c.id), prefix=depth?`${'　'.repeat(Math.max(0,depth-1))}↳ `:'';
    return `<option value="${esc(c.id)}">${prefix}${esc(c.name)}</option>`;
  }).join('');
}
function syncSelects(){
  const fixedPrev = selectedFixedFilter;
  const opts=calendarOptionsHtml();
  $('#cal').innerHTML=opts; $('#fcal').innerHTML=opts;
  $('#fixedFilter').innerHTML=`<option value="all">전체 캘린더</option>${opts}`;
  if([...$('#fixedFilter').options].some(o=>o.value===fixedPrev)) $('#fixedFilter').value=fixedPrev;
  else { selectedFixedFilter='all'; $('#fixedFilter').value='all'; }
}
function renderSide(){
  syncSelects();
  const hidden=new Set(state.settings.hiddenCalendars||[]);
  $('#calList').innerHTML=cals().map(c=>{
    const depth=calendarDepth(c.id), kids=directChildren(c.id).length;
    return `<div class="calRow ${depth?'subCalendarRow':''}" data-cid="${esc(c.id)}" style="--cal-depth:${depth}"><input class="calVisible" type="checkbox" ${isCalendarHidden(c.id)?'':'checked'} title="표시/숨김"><i class="dot" style="background:${esc(c.color)}"></i><span class="name">${depth?'↳ ':''}${esc(c.name)}</span><small>${esc(c.period)} · ${esc(c.capacity)}h${kids?` · 부속 ${kids}`:''}</small></div>`;
  }).join('');
  $$('.calRow').forEach(row=>{
    row.querySelector('.calVisible').onclick=e=>{
      e.stopPropagation();
      const id=row.dataset.cid, set=new Set(state.settings.hiddenCalendars||[]), ids=[id,...descendants(id).map(c=>c.id)];
      if(e.target.checked) ids.forEach(x=>set.delete(x)); else ids.forEach(x=>set.add(x));
      state.settings.hiddenCalendars=[...set]; save();
    };
    row.onclick=()=>openCal(row.dataset.cid);
  });
  renderFixed(); renderLoad(); renderDdays();
}
function renderFixed(){
  const f=selectedFixedFilter||'all';
  const month=`${cursor.getFullYear()}-${pad(cursor.getMonth()+1)}`;
  const allowed=f==='all'?null:new Set([f,...descendants(f).map(c=>c.id)]);
  const recurring=state.events.filter(e=>e.repeat==='monthly' && (!allowed||allowed.has(e.calId)));
  const manual=state.fixed.filter(x=>!allowed||allowed.has(x.calId));
  const collapsed=state.settings.fixedPanelsCollapsed||{recurring:false,manual:false};

  const recurringRows=recurring.map(e=>{
    const c=cal(e.calId), rule=monthlyRepeatLabel(e);
    const kindLabel={event:'일정',todo:'할 일',habit:'습관/루틴',anniversary:'기념일/D-Day'}[e.kind]||'일정';
    return `<div class="fixed recurringFixed" data-eid="${esc(e.id)}" style="border-left-color:${esc(c.color)}" title="${esc(`${calendarPath(c.id)} · ${rule} · ${durationLabel(e)}`)}"><b>${esc(e.title)}</b><small>${esc(calendarPath(c.id))} · ${esc(kindLabel)} · ${esc(rule)} · ${esc(durationLabel(e))}</small></div>`;
  }).join('') || `<div class="empty compactEmpty">매월 자동반복 일정이 없습니다.</div>`;

  const manualRows=manual.map(x=>{
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
    const tip=used?`배치완료: ${placedLabel}에 배치됨. 달력에서 해당 배치 일정을 삭제하면 다시 활성화됩니다.`:'원하는 날짜로 드래그하세요.';
    return `<div class="fixed manualFixed ${used?'used disabledFixed':''}" draggable="${used?'false':'true'}" aria-disabled="${used?'true':'false'}" data-used="${used?'1':'0'}" data-fid="${esc(x.id)}" style="border-left-color:${esc(c.color)}" title="${esc(tip)}"><b>${used?'✓ 배치완료 · ':''}${esc(x.name)}</b><small>${esc(calendarPath(c.id))} · ${esc(durationLabel(x))}${esc(usedText)}</small></div>`;
  }).join('') || `<div class="empty compactEmpty">날짜 지정 업무를 등록하세요.</div>`;

  $('#fixedList').innerHTML=`
    <div class="fixedGroup">
      <button type="button" class="fixedGroupHead" data-fixed-toggle="recurring" aria-expanded="${collapsed.recurring?'false':'true'}"><span>매월 자동반복 <em>달력에 이미 배치</em></span><span class="fixedGroupMeta">${recurring.length}건 ${collapsed.recurring?'▸':'▾'}</span></button>
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
}

function renderLoad(){
  const s=startWeek(cursor), e=add(s,6), map=buildOccurrenceMap(ds(s),ds(e)), visibleIds=new Set(visibleCals().map(c=>c.id));
  const rows=[];
  for(const root of topLevelCals().filter(c=>visibleIds.has(c.id))){
    const members=[root,...descendants(root.id)].filter(c=>visibleIds.has(c.id));
    let rootSum=0;
    for(const day of Object.values(map)) rootSum += day.filter(x=>members.some(c=>c.id===x.calId)).reduce((a,x)=>a+duration(x),0);
    const childCapFallback=members.filter(c=>c.id!==root.id).reduce((sum,c)=>sum+(Number(c.capacity)||0),0)*7;
    const cap=(Number(root.capacity)||0)*7 || childCapFallback, p=cap?rootSum/cap*100:0;
    rows.push(`<div class="loadLine"><b>${esc(root.name)}</b> ${fmtH(rootSum)}${cap?` / ${fmtH(cap)}`:''}<div class="loadBar"><i class="${p>100?'overBar':''}" style="width:${Math.min(100,p)}%"></i></div></div>`);
    for(const child of members.filter(c=>c.id!==root.id)){
      let sum=0; for(const day of Object.values(map)) sum += day.filter(x=>x.calId===child.id).reduce((a,x)=>a+duration(x),0);
      if(!sum && !Number(child.capacity)) continue;
      const ccap=(Number(child.capacity)||0)*7, cp=ccap?sum/ccap*100:0;
      rows.push(`<div class="loadLine subLoad" style="--cal-depth:${Math.max(1,calendarDepth(child.id))}"><b>↳ ${esc(child.name)}</b> ${fmtH(sum)}${ccap?` / ${fmtH(ccap)}`:''}<div class="loadBar"><i class="${cp>100?'overBar':''}" style="width:${Math.min(100,cp)}%"></i></div></div>`);
    }
  }
  $('#weekLoad').innerHTML=rows.join('') || '<div class="empty">표시 중인 캘린더가 없습니다.</div>';
}
function nextOccurrenceFor(e, from=ds(new Date()), horizonDays=740){
  const ends=ds(add(parse(from),horizonDays));
  const starts=generateOccurrenceStarts(e,from,ends).filter(d=>ds(d)>=from);
  return starts.length?ds(starts[0]):null;
}
function renderDdays(){
  const today=ds(new Date());
  const rows=state.events.filter(e=>e.kind==='anniversary').map(e=>{
    let target;
    if((e.repeat||'none')==='none') target=e.date;
    else target=nextOccurrenceFor(e,today,740);
    if(!target) return null;
    return {e,target,diff:diffDays(today,target)};
  }).filter(Boolean).sort((a,b)=>Math.abs(a.diff)-Math.abs(b.diff)).slice(0,8);
  $('#ddayList').innerHTML=rows.map(({e,target,diff})=>`<div class="ddayRow" data-eid="${esc(e.id)}"><div>${esc(e.title)}<small>${target}</small></div><b>${diff===0?'D-Day':diff>0?`D-${diff}`:`D+${Math.abs(diff)}`}</b></div>`).join('')||'<div class="empty">등록된 기념일이 없습니다.</div>';
  $$('.ddayRow').forEach(x=>x.onclick=()=>openEvent(null,x.dataset.eid));
}

function readDragPayload(dt){
  if(activeDrag) return activeDrag;
  try{
    const fixed=dt.getData('application/x-calendar-fixed'); if(fixed) return {type:'fixed',id:fixed};
    const event=dt.getData('application/x-calendar-event'); if(event) return {type:'event',id:event};
    const plain=dt.getData('text/plain')||'';
    if(plain.startsWith('calendar-fixed:')) return {type:'fixed',id:plain.slice('calendar-fixed:'.length)};
    if(plain.startsWith('calendar-event:')) return {type:'event',id:plain.slice('calendar-event:'.length)};
  }catch(_e){}
  return null;
}
function bindItems(){
  $$('.item').forEach(item=>{
    item.onclick=e=>{
      const id=item.dataset.eid, occ=item.dataset.occurrence;
      if(e.target.closest('[data-action="toggle"]')){ e.stopPropagation(); toggleDone(id,occ); return; }
      e.stopPropagation(); openEvent(occ,id);
    };
    if(item.draggable){
      item.ondragstart=e=>{
        activeDrag={type:'event',id:item.dataset.eid};
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed='move';
        try{ e.dataTransfer.setData('application/x-calendar-event',item.dataset.eid); }catch(_e){}
        e.dataTransfer.setData('text/plain',`calendar-event:${item.dataset.eid}`);
      };
      item.ondragend=()=>{ activeDrag=null; item.classList.remove('dragging'); $$('.dropReady').forEach(el=>el.classList.remove('dropReady')); };
    }
  });
  $$('[data-dropdate]').forEach(x=>{
    x.ondragenter=e=>{ e.preventDefault(); x.classList.add('dropReady'); };
    x.ondragover=e=>{
      e.preventDefault();
      const payload=activeDrag||readDragPayload(e.dataTransfer);
      e.dataTransfer.dropEffect=payload?.type==='fixed'?'copy':'move';
      x.classList.add('dropReady');
    };
    x.ondragleave=e=>{ if(!x.contains(e.relatedTarget)) x.classList.remove('dropReady'); };
    x.ondrop=e=>{
      e.preventDefault(); e.stopPropagation(); x.classList.remove('dropReady');
      const payload=readDragPayload(e.dataTransfer); activeDrag=null;
      if(!payload) return;
      if(payload.type==='fixed'){
        const f=state.fixed.find(z=>z.id===payload.id);
        if(f){
          state.events.push({id:uid(),title:f.name,calId:f.calId,date:x.dataset.dropdate,endDate:x.dataset.dropdate,allDay:true,start:'',end:'',hours:f.hours,noDuration:!!f.noDuration,kind:'todo',place:'',repeat:'none',repeatRule:null,memo:f.memo||'',fixedId:f.id,done:false,doneDates:[]});
          save();
        }
        return;
      }
      if(payload.type==='event' && payload.id) moveEventToDate(payload.id,x.dataset.dropdate);
    };
  });
  $$('.diaryBtn').forEach(b=>b.onclick=e=>{e.stopPropagation();openDiary(b.dataset.diarydate);});
}

function moveEventToDate(id,newDate){
  const e=state.events.find(x=>x.id===id); if(!e || (e.repeat||'none')!=='none') return;
  const span=Math.max(0,diffDays(e.date,e.endDate||e.date));
  e.date=newDate; e.endDate=ds(add(parse(newDate),span)); save();
}
function toggleDone(id,occ){
  const e=state.events.find(x=>x.id===id); if(!e) return;
  if((e.repeat||'none')==='none') e.done=!e.done;
  else {
    e.doneDates=Array.isArray(e.doneDates)?e.doneDates:[];
    const set=new Set(e.doneDates);
    set.has(occ)?set.delete(occ):set.add(occ);
    e.doneDates=[...set].sort();
  }
  save();
}

function renderWeek(){
  const s=startWeek(cursor), days=[0,1,2,3,4,5,6].map(i=>add(s,i)), map=buildOccurrenceMap(ds(s),ds(days[6]));
  $('#range').textContent=`${s.getFullYear()}. ${s.getMonth()+1}. ${s.getDate()} - ${days[6].getFullYear()}. ${days[6].getMonth()+1}. ${days[6].getDate()}`;
  $('#main').className='week';
  $('#main').innerHTML=days.map(d=>{
    const key=ds(d), hasDiary=!!state.diary[key]?.text, h=holidayLabel(key), dow=d.getDay();
    const dayClass=[key===ds(new Date())?'today':'', holidayClass(key), dow===0?'sunday':'', dow===6?'saturday':''].filter(Boolean).join(' ');
    return `<div class="dayCol"><div class="dayHead ${dayClass}"><div class="dayTopLine"><span>${['일','월','화','수','목','금','토'][dow]}</span><button type="button" class="diaryBtn ${hasDiary?'hasDiary':''}" data-diarydate="${key}" title="다이어리">📝</button></div><div class="dateNum">${d.getDate()}</div>${h?`<div class="holidayName">${esc(h)}</div>`:''}</div><div class="dayBody" data-dropdate="${key}" ondblclick="window.__newEvent?.('${key}')">${groupHtml(key,map[key]||[])}</div></div>`;
  }).join('');
  bindItems();
}
function renderMonth(){
  const y=cursor.getFullYear(),m=cursor.getMonth(),first=new Date(y,m,1),s=startWeek(first),end=add(s,41),map=buildOccurrenceMap(ds(s),ds(end));
  $('#range').textContent=`${y}년 ${m+1}월`;
  $('#main').className='month';
  const heads=['월','화','수','목','금','토','일'].map((x,i)=>`<div class="weekdayHeader ${i===5?'saturday':i===6?'sunday':''}">${x}</div>`).join('');
  const cells=[...Array(42)].map((_,i)=>{
    const d=add(s,i),key=ds(d),es=map[key]||[],hasDiary=!!state.diary[key]?.text,h=holidayLabel(key),dow=d.getDay();
    const cellClass=[d.getMonth()!==m?'other':'',holidayClass(key),dow===0?'sunday':'',dow===6?'saturday':''].filter(Boolean).join(' ');
    return `<div class="cell ${cellClass}" data-dropdate="${key}" ondblclick="window.__newEvent?.('${key}')"><div class="mhead"><span>${d.getDate()}</span><button type="button" class="diaryBtn ${hasDiary?'hasDiary':''}" data-diarydate="${key}">${hasDiary?'📝':'＋'}</button></div>${h?`<div class="holidayName">${esc(h)}</div>`:''}${es.map(e=>eventItemHtml(e,true)).join('')}</div>`;
  }).join('');
  $('#main').innerHTML=heads+cells; bindItems();
}
function renderDay(){
  const d=ds(cursor),map=buildOccurrenceMap(d,d),hasDiary=!!state.diary[d]?.text;
  const h=holidayLabel(d); $('#range').textContent=d; $('#main').className='daySingle';
  $('#main').innerHTML=`${h?`<div class="dayHolidayBanner">${esc(h)}</div>`:''}<div class="diaryStrip"><button type="button" class="diaryBtn ${hasDiary?'hasDiary':''}" data-diarydate="${d}">📝 ${hasDiary?'다이어리 보기':'다이어리 작성'}</button></div><div data-dropdate="${d}" ondblclick="window.__newEvent?.('${d}')">${groupHtml(d,map[d]||[])}</div>`; bindItems();
}
function renderList(){
  const start=ds(add(new Date(),-30)),end=ds(add(new Date(),365)),map=buildOccurrenceMap(start,end);
  const rows=[]; for(const [date,es] of Object.entries(map)) for(const e of es){ if((e._occurrenceStart||e.date)===date) rows.push({date,e}); }
  $('#range').textContent='일정 목록'; $('#main').className='listView';
  let last='';
  $('#main').innerHTML=`<div class="listNote">오늘 기준 과거 30일 ~ 앞으로 1년의 일정입니다. 반복 일정도 각 발생일에 표시됩니다.</div>`+(rows.map(({date,e})=>{let h='';if(last!==date){last=date;h=`<div class="listDate ${holidayClass(date)}">${date}${holidayLabel(date)?` · ${esc(holidayLabel(date))}`:''}</div>`}return h+eventItemHtml(e);}).join('')||'<div class="empty">등록된 일정이 없습니다.</div>');
  bindItems();
}
function render(){
  renderSide();
  $$('.views [data-view]').forEach(b=>b.classList.toggle('on',b.dataset.view===view));
  ({week:renderWeek,month:renderMonth,day:renderDay,list:renderList}[view])();
}

function updateAllDayUI(){ $('#timeFields').classList.toggle('hidden',$('#allDay').checked); }
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
    yearlyMonth:clamp(Number($('#yearlyMonth').value)||d.getMonth()+1,1,12),
    yearlyDay:clamp(Number($('#yearlyDay').value)||d.getDate(),1,31),
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
  $('#yearlyMonth').value=rule.yearlyMonth;
  $('#yearlyDay').value=rule.yearlyDay;
  $('#repeatEndType').value=rule.endType||'never';
  $('#repeatEndDate').value=rule.until||'';
  $('#repeatCount').value=rule.count||10;
  updateRepeatUI();
}
function openEvent(date,id,options={}){
  const e=state.events.find(x=>x.id===id);
  const monthlyPreset=!e && options?.preset==='monthlyRecurring';
  activeEventOccurrence=e?(date||e.date):(date||ds(cursor));
  $('#eventTitle').textContent=e?'일정 수정':(monthlyPreset?'매월 자동반복 업무 추가':'일정 등록');
  $('#eid').value=e?.id||''; $('#title').value=e?.title||''; $('#cal').value=e?.calId||cals()[0]?.id||'';
  $('#date').value=e?.date||date||ds(cursor); $('#endDate').value=e?.endDate||e?.date||date||ds(cursor);
  $('#allDay').checked=e?.allDay??true; $('#start').value=e?.start||''; $('#end').value=e?.end||''; setDurationInputs(e?.hours??1); $('#noDuration').checked=!!e?.noDuration; updateDurationUI();
  $('#kind').value=e?.kind||(monthlyPreset?'todo':'event'); $('#place').value=e?.place||''; $('#repeat').value=e?.repeat||(monthlyPreset?'monthly':'none'); $('#memo').value=e?.memo||'';
  $('#repeat').disabled=monthlyPreset;
  $('#deleteEvent').style.visibility=e?'visible':'hidden'; $('#copyEvent').style.visibility=e?'visible':'hidden';
  const occurrenceView=e?{...e,_occurrenceStart:activeEventOccurrence}:null;
  $('#carryEvent').classList.toggle('hidden',!e || e.kind==='anniversary' || (occurrenceView&&isDone(occurrenceView)));
  updateAllDayUI(); setRepeatRule(e||{date:$('#date').value,repeat:$('#repeat').value,repeatRule:null});
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
  const repeat=$('#repeat').value;
  const obj={
    id:id||uid(), title:$('#title').value.trim(), calId:$('#cal').value, date:$('#date').value,
    endDate:$('#endDate').value||$('#date').value, allDay:$('#allDay').checked,
    start:$('#allDay').checked?'':$('#start').value, end:$('#allDay').checked?'':$('#end').value,
    hours:getDurationInputs(), noDuration:$('#noDuration').checked, kind:$('#kind').value, place:$('#place').value.trim(),
    repeat, repeatRule:repeat==='none'?null:getRepeatRule(), memo:$('#memo').value,
    done:old?.done||false, doneDates:old?.doneDates||[], fixedId:old?.fixedId||null
  };
  if(!obj.title) return;
  if(id) state.events[state.events.findIndex(x=>x.id===id)]={...old,...obj}; else state.events.push(obj);
  activeEventOccurrence=null; closeDialog($('#eventDlg')); save();
};
$('#cancelEvent').onclick=()=>{ activeEventOccurrence=null; closeDialog($('#eventDlg')); };
function deleteEventAndUnlink(id){
  state.events=state.events.filter(x=>x.id!==id);
  for(const e of state.events){
    if(Array.isArray(e.carryoverHistory)) e.carryoverHistory=e.carryoverHistory.filter(r=>r.childId!==id);
  }
}
$('#deleteEvent').onclick=()=>{
  const id=$('#eid').value;
  if(id&&confirm('이 일정(반복 일정이면 전체 시리즈)을 삭제할까요?')){ deleteEventAndUnlink(id); activeEventOccurrence=null; closeDialog($('#eventDlg')); save(); }
};
$('#copyEvent').onclick=()=>{
  const id=$('#eid').value, src=state.events.find(x=>x.id===id); if(!src) return;
  const copy={...structuredClone(src),id:uid(),title:`${src.title} 복사`,done:false,doneDates:[],fixedId:null,carryoverCount:0,carryoverFromDate:'',carryoverRootId:'',carryoverParentId:'',carryoverHistory:[]};
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
  const child={
    ...structuredClone(src), id:childId, date:toDate, endDate:toDate, repeat:'none', repeatRule:null,
    hours:remaining, noDuration:skipDuration, done:false, doneDates:[], fixedId:null,
    carryoverCount:nextCount, carryoverFromDate:fromDate,
    carryoverRootId:src.carryoverRootId||src.id, carryoverParentId:src.id, carryoverHistory:[]
  };
  src.carryoverHistory=Array.isArray(src.carryoverHistory)?src.carryoverHistory:[];
  const old=src.carryoverHistory.find(r=>r.fromDate===fromDate);
  if(old && old.childId){ deleteEventAndUnlink(old.childId); src.carryoverHistory=Array.isArray(src.carryoverHistory)?src.carryoverHistory:[]; }
  src.carryoverHistory=src.carryoverHistory.filter(r=>r.fromDate!==fromDate);
  src.carryoverHistory.push({fromDate,toDate,childId,remainingHours:remaining});
  state.events.push(child);
  closeDialog($('#carryDlg')); closeDialog($('#eventDlg')); activeEventOccurrence=null; save();
};
$('#allDay').onchange=updateAllDayUI; $('#noDuration').onchange=()=>updateDurationUI(); $('#repeat').onchange=updateRepeatUI; $('#date').onchange=()=>{
  if(!$('#endDate').value || $('#endDate').value<$('#date').value) $('#endDate').value=$('#date').value;
  $('#yearlyMonth').value=parse($('#date').value).getMonth()+1; $('#yearlyDay').value=parse($('#date').value).getDate(); updateRepeatUI();
}; $('#monthlyMode').onchange=updateMonthlyRepeatUI; $('#monthlyMonthEnd').onchange=updateMonthlyRepeatUI; $('#repeatEndType').onchange=updateRepeatEndUI;

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
function openCal(id){
  const c=state.calendars.find(x=>x.id===id);
  $('#cid').value=c?.id||''; $('#cname').value=c?.name||''; $('#ccolor').value=c?.color||'#d9d9d9';
  $('#cparent').innerHTML=`<option value="">없음 (기본 캘린더)</option>${parentOptionsFor(c?.id||'')}`;
  $('#cparent').value=c?.parentId||'';
  $('#corder').value=c?.order||state.calendars.length+1; $('#cperiod').value=c?.period||'오전'; $('#ccap').value=c?.capacity??8;
  updateCalColorHint();
  $('#deleteCal').style.visibility=c?'visible':'hidden'; openDialog($('#calDlg'));
}
$('#cparent').onchange=()=>{
  updateCalColorHint();
  // 새 부속캘린더를 만들 때만 자동 적용합니다. 기존 캘린더의 수동 색상은 임의로 덮어쓰지 않습니다.
  if(!$('#cid').value && $('#cparent').value) applySuggestedCalendarColor();
};
$('#suggestCalColor').onclick=applySuggestedCalendarColor;
$('#calForm').onsubmit=e=>{
  e.preventDefault();
  const id=$('#cid').value, parentId=$('#cparent').value||'';
  if(id && (parentId===id || descendants(id).some(c=>c.id===parentId))){ alert('자기 자신 또는 자신의 부속캘린더를 상위 캘린더로 지정할 수 없습니다.'); return; }
  const obj={id:id||uid(),name:$('#cname').value.trim(),color:$('#ccolor').value,order:Number($('#corder').value)||1,period:$('#cperiod').value,capacity:Number($('#ccap').value)||0,parentId};
  if(id) state.calendars[state.calendars.findIndex(x=>x.id===id)]=obj; else state.calendars.push(obj);
  closeDialog($('#calDlg')); save();
};
$('#cancelCal').onclick=()=>closeDialog($('#calDlg'));
$('#deleteCal').onclick=()=>{
  const id=$('#cid').value; if(!id) return;
  if(state.calendars.length<=1){ alert('캘린더는 최소 1개가 필요합니다.'); return; }
  const target=state.calendars.find(c=>c.id===id), kids=directChildren(id);
  const msg=kids.length?`이 캘린더의 일정·고정업무를 삭제할까요? 부속캘린더 ${kids.length}개는 한 단계 위로 이동되어 유지됩니다.`:'이 캘린더와 포함된 일정·고정업무를 모두 삭제할까요?';
  if(confirm(msg)){
    const newParent=target?.parentId||'';
    kids.forEach(c=>c.parentId=newParent);
    state.calendars=state.calendars.filter(x=>x.id!==id); state.events=state.events.filter(x=>x.calId!==id); state.fixed=state.fixed.filter(x=>x.calId!==id);
    state.settings.hiddenCalendars=(state.settings.hiddenCalendars||[]).filter(x=>x!==id); closeDialog($('#calDlg')); save();
  }
};

function openFixed(id){
  const f=state.fixed.find(x=>x.id===id);
  $('#fixedTitle').textContent=f?'날짜 지정 배치 업무 수정':'날짜 지정 배치 업무 추가';
  $('#fid').value=f?.id||''; $('#fname').value=f?.name||''; $('#fcal').value=f?.calId||cals()[0]?.id||'';
  setDurationInputs(f?.hours??1,'f'); $('#fnoDuration').checked=!!f?.noDuration; updateDurationUI('f'); $('#fmemo').value=f?.memo||''; $('#deleteFixed').style.visibility=f?'visible':'hidden'; openDialog($('#fixedDlg'));
}
$('#fixedForm').onsubmit=e=>{
  e.preventDefault(); const id=$('#fid').value, obj={id:id||uid(),name:$('#fname').value.trim(),calId:$('#fcal').value,hours:getDurationInputs('f'),noDuration:$('#fnoDuration').checked,memo:$('#fmemo').value};
  if(id) state.fixed[state.fixed.findIndex(x=>x.id===id)]=obj; else state.fixed.push(obj); closeDialog($('#fixedDlg')); save();
};
$('#fnoDuration').onchange=()=>updateDurationUI('f');
$('#cancelFixed').onclick=()=>closeDialog($('#fixedDlg'));
$('#deleteFixed').onclick=()=>{ const id=$('#fid').value; if(id&&confirm('이 고정업무를 삭제할까요?')){state.fixed=state.fixed.filter(x=>x.id!==id);closeDialog($('#fixedDlg'));save();} };

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
  for(const e of state.events){ const hay=[e.title,e.memo,e.place,cal(e.calId).name].join(' ').toLowerCase(); if(hay.includes(q)) results.push({type:'event',id:e.id,title:e.title,meta:`${e.date} · ${cal(e.calId).name}`}); }
  for(const f of state.fixed){ const hay=[f.name,f.memo,cal(f.calId).name].join(' ').toLowerCase(); if(hay.includes(q)) results.push({type:'fixed',id:f.id,title:f.name,meta:`고정업무 · ${cal(f.calId).name}`}); }
  for(const [date,d] of Object.entries(state.diary)){ if((d.text||'').toLowerCase().includes(q)) results.push({type:'diary',id:date,title:`다이어리 ${date}`,meta:d.text.slice(0,60)}); }
  $('#searchResults').innerHTML=results.slice(0,100).map((r,i)=>`<div class="searchResult" data-idx="${i}"><b>${esc(r.title)}</b><small>${esc(r.meta)}</small></div>`).join('')||'<div class="empty">검색 결과가 없습니다.</div>';
  $$('.searchResult').forEach(x=>x.onclick=()=>{const r=results[Number(x.dataset.idx)];closeDialog($('#searchDlg'));if(r.type==='event')openEvent(null,r.id);else if(r.type==='fixed')openFixed(r.id);else openDiary(r.id);});
}
$('#searchBtn').onclick=()=>{ $('#searchInput').value=''; $('#searchResults').innerHTML='<div class="empty">검색어를 입력하세요.</div>'; openDialog($('#searchDlg')); setTimeout(()=>$('#searchInput').focus(),50); };
$('#searchInput').oninput=renderSearch; $('#closeSearch').onclick=()=>closeDialog($('#searchDlg')); $('#searchForm').onsubmit=e=>e.preventDefault();

function setFixedAddMenu(open){
  const menu=$('#fixedAddMenu'), btn=$('#addFixed'); if(!menu||!btn) return;
  const show=typeof open==='boolean'?open:menu.classList.contains('hidden');
  menu.classList.toggle('hidden',!show); btn.setAttribute('aria-expanded',show?'true':'false');
}
$('#addCal').onclick=()=>openCal();
$('#addFixed').onclick=e=>{ e.stopPropagation(); setFixedAddMenu(); };
$('#addRecurringFixed').onclick=e=>{ e.stopPropagation(); setFixedAddMenu(false); openEvent(ds(cursor),null,{preset:'monthlyRecurring'}); };
$('#addManualFixed').onclick=e=>{ e.stopPropagation(); setFixedAddMenu(false); openFixed(); };
$('#fixedAddMenu').onclick=e=>e.stopPropagation();
document.addEventListener('click',e=>{ if(!e.target.closest('.fixedAddWrap')) setFixedAddMenu(false); });
document.addEventListener('keydown',e=>{ if(e.key==='Escape' && !$('#fixedAddMenu').classList.contains('hidden')) setFixedAddMenu(false); });
$('#fixedFilter').onchange=e=>{selectedFixedFilter=e.target.value;renderFixed();};
$('#prev').onclick=()=>{ cursor=view==='month'?new Date(cursor.getFullYear(),cursor.getMonth()-1,1):add(cursor,view==='week'?-7:-1); render(); };
$('#next').onclick=()=>{ cursor=view==='month'?new Date(cursor.getFullYear(),cursor.getMonth()+1,1):add(cursor,view==='week'?7:1); render(); };
$('#today').onclick=()=>{cursor=new Date();render();};
$('#jumpDate').onchange=e=>{ if(e.target.value){cursor=parse(e.target.value);render();} };
$$('.views [data-view]').forEach(b=>b.onclick=()=>{view=b.dataset.view;render();});
$('#sidebarToggle').onclick=()=>$('#sidebar').classList.toggle('open');
$('#main').addEventListener('click',()=>$('#sidebar').classList.remove('open'));

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
    appVersion:'1.21',
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
['eventDlg','calDlg','fixedDlg','diaryDlg','searchDlg','settingsDlg'].forEach(id=>{
  const d=$(`#${id}`); d.addEventListener('cancel',()=>{});
});

loadHolidayData();
render();
