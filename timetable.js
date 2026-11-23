/* v2.129 · Independent weekly timetable module.
   Only the state.timetable subtree is written; host calendar occurrences are read-only. */
const WD=['일','월','화','수','목','금','토'];
const WEEK=[1,2,3,4,5,6,0];
const COLORS=['#d8ebff','#ffe9ba','#dff5d9','#f7dceb','#e9e1ff','#e8ecef','#fae8d0','#d3f1ed'];
const DEFAULT_RANGE={start:'06:00',end:'23:00'};
function id(){return (globalThis.crypto?.randomUUID?.() || `tt-${Date.now()}-${Math.random().toString(36).slice(2)}`);}
function minutes(t){if(t==='24:00')return 1440;if(!/^\d{2}:\d{2}$/.test(String(t)))return NaN;let [h,m]=t.split(':').map(Number);return h>=0&&h<=23&&m>=0&&m<60?h*60+m:NaN;}
function clock(m){return `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;}
function validTime(t,allow24=false){return Number.isFinite(minutes(t))&&(allow24||minutes(t)<1440);}
function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function goodColor(raw){return COLORS.includes(raw)?raw:COLORS[0];}
function normalizeBlock(b){
  if(!b||typeof b!=='object')return null;
  let start=String(b.start||''),end=String(b.end||'');
  if(!validTime(start)||!validTime(end,true)||minutes(end)<=minutes(start))return null;
  const title=String(b.title||'').trim().slice(0,100);
  if(!title)return null;
  return {id:String(b.id||id()),title,start,end,color:goodColor(b.color),...(typeof b.copyGroupId==='string'&&b.copyGroupId.trim()?{copyGroupId:b.copyGroupId.slice(0,100)}:{})};
}
export function defaultTimetable(){return {version:1,range:{...DEFAULT_RANGE},extraTicks:[],scenarios:[{id:'base',name:'기본 시간표',mode:'always',eventIds:[],priority:0,days:{}}]};}
export function normalizeTimetable(input){
  const d=defaultTimetable(),o=input&&typeof input==='object'?input:{};
  const start=validTime(o.range?.start)?o.range.start:DEFAULT_RANGE.start;
  const end=validTime(o.range?.end,true)&&minutes(o.range.end)>minutes(start)?o.range.end:DEFAULT_RANGE.end;
  const raw=Array.isArray(o.scenarios)?o.scenarios:[];
  const scenarios=[],used=new Set();
  for(const s of raw){
    if(!s||typeof s!=='object')continue;
    const sid=String(s.id||id());if(used.has(sid))continue;used.add(sid);
    const days={};
    for(let day=0;day<7;day++){
      const vals=s.days?.[day]??s.days?.[String(day)];
      days[day]=Array.isArray(vals)?vals.slice(0,160).map(normalizeBlock).filter(Boolean):[];
    }
    scenarios.push({id:sid,name:String(s.name||'경우의 수').slice(0,60),mode:sid==='base'?'always':(['has','not'].includes(s.mode)?s.mode:'has'),eventIds:Array.isArray(s.eventIds)?[...new Set(s.eventIds.map(String))].slice(0,50):[],priority:sid==='base'?0:Math.max(1,Math.min(9999,Number(s.priority)||10)),days});
  }
  if(!used.has('base')) scenarios.unshift({...d.scenarios[0],days:{}});
  return {version:1,range:{start,end:minutes(end)>minutes(start)?end:'23:00'},extraTicks:Array.isArray(o.extraTicks)?[...new Set(o.extraTicks.filter(t=>validTime(t)&&minutes(t)%10===0))].slice(0,120).sort((a,b)=>minutes(a)-minutes(b)):[],scenarios};
}
function scenarioById(data,scenarioId){return data.scenarios.find(s=>s.id===scenarioId)||data.scenarios[0];}
function overlap(a,b){return minutes(a.start)<minutes(b.end)&&minutes(b.start)<minutes(a.end);}
function matches(s,occurrences,existingIds){
  if(s.id==='base'||s.mode==='always')return false;
  const ids=s.eventIds;
  if(!ids.length)return false;
  // A deleted or cancelled linked event no longer counts as present: X activates.
  // Detached instances keep their link to the original repeating event ID.
  const found=occurrences.some(e=>ids.includes(String(e.id)) || (e.detachedFromRepeatId && ids.includes(String(e.detachedFromRepeatId))));
  return s.mode==='not'?!found:found;
}
export function resolveTimetableDay(data,day,occurrences=[],existingEvents=[]){
  const ids=new Set(existingEvents.map(x=>String(x.id)));
  const candidates=data.scenarios.filter(s=>matches(s,occurrences,ids)).sort((a,b)=>b.priority-a.priority||data.scenarios.indexOf(a)-data.scenarios.indexOf(b));
  const selected=candidates[0]||scenarioById(data,'base');
  return {scenario:selected,matched:candidates,weekday:new Date(`${day}T12:00:00`).getDay(),date:day};
}
function formatDay(date){const d=new Date(`${date}T12:00:00`);return `${d.getMonth()+1}월 ${d.getDate()}일 ${WD[d.getDay()]}요일`;}
function targetOverlapCount(target,source){return target.filter(b=>overlap(b,source)).length;}

export function createTimetableFeature({getState,save,buildOccurrenceMap,getCursorDate,onTrash=()=>{}}){
  const ui={selected:'base',day:'1',open:false,editingBlock:null,copySource:null,manageId:null,manageSelected:new Set(),manageSearch:'',lastPreview:null,ignoreBlockClickUntil:0};
  let host=null,editor=null,blockDlg=null,caseDlg=null,copyDlg=null,previewDlg=null,ticksDlg=null;
  const data=()=>getState().timetable;
  const notify=()=>save();
  const getCase=()=>scenarioById(data(),ui.selected);
  function getActual(day){return buildOccurrenceMap(day,day,{includeHidden:true,includePreparations:false,includePurchases:false})[day]||[];}
  function resolve(day){return resolveTimetableDay(data(),day,getActual(day),getState().events||[]);}
  const minmax=(days)=>{
    const all=days.flatMap(x=>x||[]);
    const start=Math.min(minutes(data().range.start),...all.map(b=>minutes(b.start)));
    const end=Math.max(minutes(data().range.end),...all.map(b=>minutes(b.end)));
    return {start,end:Math.min(1440,end),ppm:1.25};
  };
  // The weekly board uses percentages to fit into available screen height;
  // dates still use exact minute offsets, independent of visible tick marks.
  function blockHtml(b,r,canEdit=true,fit=false){
    const duration=r.end-r.start;
    const rawHeight=minutes(b.end)-minutes(b.start);
    const y=fit?`${(minutes(b.start)-r.start)/duration*100}%`:`${(minutes(b.start)-r.start)*r.ppm}px`;
    const h=fit?`${rawHeight/duration*100}%`:`${rawHeight*r.ppm}px`;
    const tiny=rawHeight<=20;
    const grips=canEdit&&rawHeight>=30?'<span class="ttResizeHandle ttResizeStart" data-tt-resize="start" aria-hidden="true" title="위쪽을 드래그해 시작시간 변경"></span><span class="ttResizeHandle ttResizeEnd" data-tt-resize="end" aria-hidden="true" title="아래쪽을 드래그해 종료시간 변경"></span>':'';
    return `<button type="button" class="ttBlock ${tiny?'ttBlockTiny':''}" data-tt-block="${escapeHtml(b.id)}" style="top:${y};height:${h};background:${b.color}" title="${escapeHtml(b.start+'–'+b.end+' '+b.title)}" aria-label="${escapeHtml(b.title)} ${b.start}~${b.end}${canEdit?' 수정':''}"><span class="ttBlockMain"><span class="ttBlockTitle">${escapeHtml(b.title)}</span><span class="ttBlockHours">${escapeHtml(b.start)}–${escapeHtml(b.end)}</span></span>${grips}</button>`;
  }
  // Build visible ticks from the selected timetable, without writing them into
  // extraTicks. Editing, deleting, or copying a block therefore updates ticks
  // immediately; manual ticks remain independently editable and persistent.
  function markedMinutes(r,days=[]){
    const values=new Set([r.start,r.end]);
    for(let m=Math.ceil(r.start/60)*60;m<=r.end;m+=60)values.add(m);
    for(const t of (data().extraTicks||[])){
      const m=minutes(t);if(Number.isFinite(m)&&m>r.start&&m<r.end)values.add(m);
    }
    for(const blocks of days){
      for(const block of (blocks||[])){
        for(const time of [block.start,block.end]){
          const m=minutes(time);
          if(Number.isFinite(m)&&m>=r.start&&m<=r.end)values.add(m);
        }
      }
    }
    return [...values].sort((a,b)=>a-b);
  }
  function axisMarks(r,fit,days=[]){
    const pos=m=>fit?`${(m-r.start)/(r.end-r.start)*100}%`:`${(m-r.start)*r.ppm}px`;
    const ticks=markedMinutes(r,days);
    return {
      marks:ticks.map(m=>`<span class="ttAxisTick ${m%60===0?'major':'detail'}" style="top:${pos(m)}" title="${clock(m)}">${clock(m)}</span>`).join(''),
      lines:ticks.map(m=>`<span class="ttTrackLine ${m%60===0?'major':'custom'}" style="top:${pos(m)}"></span>`).join('')
    };
  }
  function gridHtml(days,r,editable=true){
    const {marks,lines}=axisMarks(r,true,days);
    return `<div class="ttWeekBoard"><div class="ttWeekGrid"><div class="ttCorner">시간</div>${WEEK.map(d=>`<div class="ttGridHead">${WD[d]}요일</div>`).join('')}<div class="ttTimeAxis">${marks}</div>${WEEK.map((d,i)=>`<div class="ttDayTrack" data-tt-track="${d}">${lines}${(days[i]||[]).map(b=>blockHtml(b,r,editable,true)).join('')}</div>`).join('')}</div></div>`;
  }
  function draw(){
    if(!ui.open||!host)return;
    if(!data().scenarios.some(s=>s.id===ui.selected))ui.selected='base';
    const s=getCase(),days=WEEK.map(d=>s.days[d]||[]),r=minmax(days);
    const cases=data().scenarios.map(x=>`<button type="button" class="ttCaseTab ${s.id===x.id?'selected':''}" data-tt-case="${escapeHtml(x.id)}" title="${escapeHtml(x.name)}">${escapeHtml(x.name)}</button>`).join('');
    host.innerHTML=`<div class="ttWindow" role="dialog" aria-modal="true" aria-label="주간 시간표 편집">
      <header class="ttWinHead"><div><h2>🕒 주간 시간표</h2><small>월~일 한눈에 보기 · 연결한 캘린더 일정에 따라 자동 적용</small></div><button type="button" id="ttClose" aria-label="닫기">×</button></header>
      <div class="ttUnifiedBar">
        <nav class="ttCaseNav" aria-label="시간표 경우의 수" title="${escapeHtml(s.id==='base'?'다른 조건이 맞지 않으면 기본 시간표 적용':`우선순위 ${s.priority} · ${s.mode==='has'?'연결 일정 있음':'연결 일정 없음'}`)}">${cases}</nav>
        <button type="button" id="ttManageCases" title="경우의 수 추가·수정·삭제·조건 설정">⚙ 경우의 수 관리</button>
        <button type="button" id="ttNewBlock">＋ 시간 등록</button>
        <div class="ttCopyTools"><select id="ttCopyDay" aria-label="복사할 요일">${WEEK.map(d=>`<option value="${d}">${WD[d]}요일 전체</option>`).join('')}</select><button type="button" id="ttCopyDayBtn">요일 복사</button></div>
        <div class="ttRangeTools"><label for="ttRangeStart">시작</label><input type="time" id="ttRangeStart" aria-label="표시 시작시간" value="${data().range.start}" step="600"><label for="ttRangeEnd">종료</label><input type="time" id="ttRangeEnd" aria-label="표시 종료시간" value="${data().range.end}" step="600"></div>
        <button type="button" id="ttEditTicks" title="등록한 일정 시작·종료 눈금은 자동 표시 · 다른 눈금은 수동 추가">🕒 눈금 편집</button>
      </div>
      ${gridHtml(days,r)}<div class="ttFootnote">정각 눈금은 1시간 간격 · 일정 시작·종료 시각은 자동 표시 · 추가 눈금은 수동 편집</div>
    </div>`;
    host.querySelector('#ttClose').onclick=close;
    host.querySelectorAll('[data-tt-case]').forEach(b=>b.onclick=()=>{ui.selected=b.dataset.ttCase;draw();});
    host.querySelector('#ttManageCases').onclick=openManageList;
    host.querySelector('#ttEditTicks').onclick=openTicks;
    host.querySelector('#ttNewBlock').onclick=()=>openBlock(null,Number(ui.day)||1);
    host.querySelector('#ttCopyDayBtn').onclick=()=>openCopy({type:'day',caseId:s.id,day:Number(host.querySelector('#ttCopyDay').value)});
    host.querySelectorAll('[data-tt-block]').forEach(btn=>btn.onclick=e=>{e.stopPropagation();if(Date.now()<ui.ignoreBlockClickUntil)return;const track=btn.closest('[data-tt-track]'),dow=Number(track.dataset.ttTrack);ui.day=String(dow);openBlock(btn.dataset.ttBlock,dow);});
    bindResizeHandles(r);
    host.querySelectorAll('[data-tt-track]').forEach(track=>track.onclick=e=>{
      if(e.target.closest('[data-tt-block]'))return;
      const box=track.getBoundingClientRect(),offset=Math.round((e.clientY-box.top)/Math.max(1,box.height)*(r.end-r.start)/10)*10;
      const start=Math.max(0,Math.min(1430,r.start+offset));ui.day=track.dataset.ttTrack;
      openBlock(null,Number(ui.day),clock(start));
    });
    const rangeUpdate=()=>{
      const start=host.querySelector('#ttRangeStart').value,end=host.querySelector('#ttRangeEnd').value;
      if(!validTime(start)||!validTime(end,true)||minutes(end)<=minutes(start)){alert('표시 종료는 시작보다 늦어야 해.');return;}
      data().range={start,end};notify();draw();
    };
    ['ttRangeStart','ttRangeEnd'].forEach(id=>host.querySelector('#'+id).addEventListener('change',rangeUpdate));
    avoidAxisLabelCollision();
  }
  function avoidAxisLabelCollision(){
    if(!ui.open||!host)return;
    // Keep every horizontal line; only hide text labels when they would collide.
    // Custom labels have priority over nearby hourly labels.
    const labels=[...host.querySelectorAll('.ttWeekGrid .ttAxisTick')];
    for(const el of labels)el.style.visibility='visible';
    const order=labels.map((el,i)=>({el,i,priority:(i===0||i===labels.length-1)?4:(el.classList.contains('detail')?3:1)}))
      .sort((a,b)=>b.priority-a.priority||a.i-b.i);
    const shown=[];
    for(const {el} of order){
      const box=el.getBoundingClientRect();
      if(shown.some(r=>box.top<r.bottom-2&&box.bottom>r.top+2))el.style.visibility='hidden';
      else shown.push(box);
    }
  }
  function show(view){view.classList.remove('hidden');view.setAttribute('aria-hidden','false');}
  function hide(view){view.classList.add('hidden');view.setAttribute('aria-hidden','true');}
  function open(scenario){
    ui.open=true;ui.selected=scenario&&data().scenarios.some(s=>s.id===scenario)?scenario:ui.selected;
    show(host);draw();
  }
  function close(){ui.open=false;hide(host);}
  function formColors(value){return `<div class="ttColors">${COLORS.map(c=>`<label title="블록 색상"><input type="radio" name="ttColor" value="${c}" ${c===value?'checked':''}><span style="background:${c}"></span></label>`).join('')}</div>`;}
  // Keep a durable, opt-in relationship for newly copied blocks. Older copies
  // lack metadata: offer identical-content candidates, never auto-select them.
  function copiesFor(block,caseId,dow){
    const result=[];
    for(const sc of data().scenarios)for(const day of WEEK)for(const other of (sc.days[day]||[])){
      if(sc.id===caseId&&day===dow&&other.id===block.id)continue;
      const linked=!!block.copyGroupId&&other.copyGroupId===block.copyGroupId;
      const same=!other.copyGroupId&&other.title===block.title&&other.start===block.start&&other.end===block.end&&other.color===block.color;
      if(linked||same)result.push({caseId:sc.id,day,id:other.id,linked,name:sc.name,title:other.title});
    }
    return result;
  }
  function saveBlockEdit({caseId,dow,original,formValue,copies=[]}){
    const sc=scenarioById(data(),caseId);
    const {title,start,end,color,targetDow}=formValue;
    const changes={};
    for(const field of ['title','start','end','color'])if(!original||original[field]!==formValue[field])changes[field]=formValue[field];
    const groupId=copies.length?(original?.copyGroupId||id()):original?.copyGroupId;
    const main={...original,id:original?.id||id(),title,start,end,color,...(groupId?{copyGroupId:groupId}:{})};
    const plans=[{sc,day:targetDow,oldDay:dow,oldId:original?.id||null,newBlock:main}];
    if(original&&copies.length){
      for(const item of copies){
        const dest=scenarioById(data(),item.caseId),block=(dest.days[item.day]||[]).find(x=>x.id===item.id);
        if(!block)continue;
        plans.push({sc:dest,day:item.day,oldDay:item.day,oldId:block.id,newBlock:{...block,...changes,copyGroupId:groupId}});
      }
    }
    // Preflight before touching state: changes must not silently overwrite a
    // different appointment. Check planned copies as well as existing blocks.
    const key=(scenario,day,blockId)=>`${scenario.id}:${day}:${blockId}`;
    const moving=new Set(plans.filter(p=>p.oldId).map(p=>key(p.sc,p.oldDay,p.oldId)));
    for(let i=0;i<plans.length;i++)for(let j=i+1;j<plans.length;j++){
      if(plans[i].sc.id===plans[j].sc.id&&plans[i].day===plans[j].day&&overlap(plans[i].newBlock,plans[j].newBlock)){
        alert('변경할 일정끼리 시간이 겹쳐. 요일이나 시간을 다시 확인해 줘.');return false;
      }
    }
    const conflicts=new Map();
    for(const p of plans){
      for(const existing of (p.sc.days[p.day]||[])){
        const k=key(p.sc,p.day,existing.id);
        if(!moving.has(k)&&overlap(existing,p.newBlock))conflicts.set(k,{sc:p.sc,day:p.day,id:existing.id});
      }
    }
    if(conflicts.size&&!confirm(`변경 후 ${conflicts.size}개의 기존 일정과 시간이 겹쳐. 겹치는 일정을 삭제하고 변경할까? 취소하면 아무것도 바뀌지 않아.`))return false;
    for(const conflict of conflicts.values()){
      const block=(conflict.sc.days[conflict.day]||[]).find(b=>b.id===conflict.id);
      if(block)onTrash('ttBlock',{scenarioId:conflict.sc.id,day:conflict.day,block:structuredClone(block)},block.title,'',`${conflict.sc.name} · ${WD[conflict.day]}요일 · 겹침으로 교체`);
    }
    // Only after all validation has passed do we modify the saved timetable.
    for(const sc of data().scenarios)for(const day of WEEK){
      sc.days[day]=(sc.days[day]||[]).filter(b=>!moving.has(key(sc,day,b.id))&&!conflicts.has(key(sc,day,b.id)));
    }
    for(const p of plans){
      (p.sc.days[p.day] ||= []).push(p.newBlock);
      p.sc.days[p.day].sort((a,b)=>minutes(a.start)-minutes(b.start));
    }
    ui.day=String(targetDow);notify();draw();return true;
  }
  function openBlock(blockId,dow,defaultTime,prefill=null){
    const s=getCase(),curr=(s.days[dow]||[]).find(b=>b.id===blockId)||null;
    ui.editingBlock={blockId:curr?.id||null,dow,caseId:s.id};
    const from=prefill?.start||curr?.start||defaultTime||'06:30';
    const to=prefill?.end||curr?.end||clock(Math.min(1440,minutes(from)+60));
    const duplicates=curr?copiesFor(curr,s.id,dow):[];
    const copyNote=duplicates.length?`<section class="ttSyncBox"><label class="ttSyncSwitch"><input type="checkbox" id="ttSyncCopies"><span>변경한 항목을 다른 복사본에도 적용</span></label><small>선택한 경우에만 변경된 항목(이름·시간·색상)을 함께 수정해. 복사본의 요일은 그대로 유지돼.</small><div id="ttSyncTargets" class="ttSyncTargets" hidden>${duplicates.map((item,index)=>`<label class="ttSyncTarget"><input type="checkbox" value="${index}" ${item.linked?'checked':''}><span>${escapeHtml(item.name)} · ${WD[item.day]}요일 ${item.linked?'(연결된 복사본)':'(같은 내용의 일정 후보)'}</span></label>`).join('')}</div></section>`:'';
    blockDlg.innerHTML=`<div class="ttModal"><header><h3>${curr?'시간표 수정':'시간표 일정 추가'}</h3><button type="button" data-close="1">×</button></header><form id="ttBlockForm"><label>일정명<input name="title" required maxlength="100" value="${escapeHtml(curr?.title||'')}" placeholder="예: 개인시간"></label><div class="ttFormRow"><label>요일<select name="dow">${WEEK.map(d=>`<option value="${d}" ${d===dow?'selected':''}>${WD[d]}요일</option>`).join('')}</select></label><label>시작<input name="start" type="time" step="600" value="${from}" required></label><label>종료<input name="end" type="time" step="600" value="${to}" required></label></div><div><small>색상</small>${formColors(curr?.color||COLORS[0])}</div>${copyNote}<footer>${curr?'<button type="button" id="ttBlockDelete" class="ttDanger">삭제</button><button type="button" id="ttBlockCopy">다른 요일·경우의 수로 복사</button>':''}<span></span><button type="button" data-close="1">취소</button><button type="submit" class="ttPrimary">저장</button></footer></form></div>`;
    show(blockDlg);
    // The header × and footer 취소 must BOTH discard edits and close the modal.
    blockDlg.querySelectorAll('[data-close]').forEach(btn=>btn.onclick=()=>hide(blockDlg));
    const toggle=blockDlg.querySelector('#ttSyncCopies'),targets=blockDlg.querySelector('#ttSyncTargets');
    if(toggle)toggle.onchange=()=>{targets.hidden=!toggle.checked;};
    blockDlg.querySelector('#ttBlockForm').onsubmit=e=>{
      e.preventDefault();const fd=new FormData(e.currentTarget);
      const title=String(fd.get('title')||'').trim(),start=String(fd.get('start')),end=String(fd.get('end'));
      const targetDow=Number(fd.get('dow')),color=goodColor(fd.get('ttColor'));
      if(!title||!validTime(start)||!validTime(end,true)||minutes(end)<=minutes(start)||!WEEK.includes(targetDow)){alert('일정명과 시작·종료 시각을 확인해 줘.');return;}
      if(minutes(start)%10!==0||minutes(end)%10!==0){alert('시간은 10분 단위로 입력해 줘.');return;}
      const selected=toggle?.checked?[...targets.querySelectorAll('input:checked')].map(el=>duplicates[Number(el.value)]).filter(Boolean):[];
      if(saveBlockEdit({caseId:s.id,dow,original:curr,formValue:{title,start,end,color,targetDow},copies:selected}))hide(blockDlg);
    };
    blockDlg.querySelector('#ttBlockDelete')?.addEventListener('click',()=>{
      if(!confirm('이 시간표 일정을 삭제할까?'))return;
      const sc=scenarioById(data(),ui.editingBlock.caseId);
      const block=(sc.days[dow]||[]).find(b=>b.id===ui.editingBlock.blockId);
      if(block)onTrash('ttBlock',{scenarioId:sc.id,day:dow,block:structuredClone(block)},block.title,'',`${sc.name} · ${WD[dow]}요일 · ${block.start}~${block.end}`);
      sc.days[dow]=(sc.days[dow]||[]).filter(b=>b.id!==ui.editingBlock.blockId);
      hide(blockDlg);notify();draw();
    });
    blockDlg.querySelector('#ttBlockCopy')?.addEventListener('click',()=>{
      const sc=scenarioById(data(),ui.editingBlock.caseId),block=(sc.days[dow]||[]).find(b=>b.id===blockId);
      if(!block)return;hide(blockDlg);openCopy({type:'block',caseId:sc.id,day:dow,block:{...block}});
    });
  }
  function bindResizeHandles(r){
    const range=r.end-r.start;
    host.querySelectorAll('[data-tt-resize]').forEach(handle=>{
      handle.addEventListener('pointerdown',down=>{
        if(down.pointerType==='mouse'&&down.button!==0)return;
        const el=handle.closest('[data-tt-block]'),track=handle.closest('[data-tt-track]');
        const block=(getCase().days[Number(track.dataset.ttTrack)]||[]).find(b=>b.id===el.dataset.ttBlock);
        if(!block)return;
        down.preventDefault();down.stopPropagation();
        const bound=track.getBoundingClientRect(),edge=handle.dataset.ttResize;
        const first=minutes(block.start),last=minutes(block.end);
        const original=edge==='start'?first:last;
        // Resize by distance MOVED, rather than using the pointer's absolute
        // location. A hidden 8px hit area has its centre a few pixels away
        // from the real boundary; absolute snapping made the original time
        // difficult to reach and caused the block to jump on first movement.
        const pressY=down.clientY;
        const pxPerMinute=bound.height/Math.max(1,range);
        let next=original,dragged=false;
        const move=e=>{
          if(e.pointerId!==down.pointerId)return;
          e.preventDefault();
          const deltaY=e.clientY-pressY;
          if(Math.abs(deltaY)>3)dragged=true;
          const shifted=original+Math.round(deltaY/Math.max(0.01,pxPerMinute)/10)*10;
          next=edge==='start'?Math.max(r.start,Math.min(last-10,shifted)):Math.min(r.end,Math.max(first+10,shifted));
          // Always update the preview, including when the drag comes BACK to
          // the original boundary. Returning early used to leave it visually
          // stuck at a previously previewed time.
          const start=edge==='start'?next:first,end=edge==='end'?next:last;
          el.style.top=`${(start-r.start)/range*100}%`;
          el.style.height=`${(end-start)/range*100}%`;
          el.querySelector('.ttBlockHours').textContent=`${clock(start)}–${clock(end)}`;
          el.title=`${clock(start)}–${clock(end)} ${block.title}`;
        };
        const cleanup=()=>{
          window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',finish);
          window.removeEventListener('pointercancel',cancel);
        };
        const finish=e=>{
          if(e.pointerId!==down.pointerId)return;
          cleanup();
          ui.ignoreBlockClickUntil=Date.now()+450;
          if(dragged&&next!==(edge==='start'?first:last)){
            // The drag is a visual PREVIEW only. Reset the block immediately
            // before showing the edit dialog; Save commits the new times, while
            // Cancel/×/Escape/backdrop leave the original calendar untouched.
            const proposed={start:clock(edge==='start'?next:first),end:clock(edge==='end'?next:last)};
            const day=Number(track.dataset.ttTrack);
            const blockId=block.id;
            draw();
            openBlock(blockId,day,null,proposed);
          }else draw();
        };
        const cancel=e=>{if(e.pointerId!==down.pointerId)return;cleanup();draw();};
        window.addEventListener('pointermove',move,{passive:false});
        window.addEventListener('pointerup',finish);window.addEventListener('pointercancel',cancel);
        try{handle.setPointerCapture(down.pointerId);}catch(_e){}
      });
    });
  }
  function linkedChoices(selectedIds=new Set(),filter=''){
    let rows=(getState().events||[]).filter(e=>e.id&&e.title&&String(e.title).toLowerCase().includes(filter.toLowerCase()));
    // Selected IDs remain at the front even in large calendars.
    rows.sort((a,b)=>Number(selectedIds.has(String(b.id)))-Number(selectedIds.has(String(a.id)))||String(a.title).localeCompare(String(b.title),'ko'));
    const shown=rows.slice(0,100);
    return `${shown.map(e=>`<label class="ttLinkItem"><input type="checkbox" value="${escapeHtml(e.id)}" ${selectedIds.has(String(e.id))?'checked':''}><span>${escapeHtml(e.title)} <small>${escapeHtml(e.repeat!=='none'?'↻ 반복 · '+e.date:e.date)}</small></span></label>`).join('')||'<p class="ttMuted">일치하는 캘린더 일정이 없어.</p>'}${rows.length>100?'<p class="ttMuted">100개까지만 표시 중이야. 검색어를 더 입력해 줘.</p>':''}`;
  }
  function openManageList(){
    const rows=data().scenarios.map(sc=>`<div class="ttManageItem"><div><strong>${escapeHtml(sc.name)}</strong><small>${sc.id==='base'?'기본 적용':`${sc.mode==='has'?'일정 있음':'일정 없음'} · 우선순위 ${sc.priority} · 연결 ${sc.eventIds.length}개`}</small></div><button type="button" data-tt-manage-item="${escapeHtml(sc.id)}">수정</button>${sc.id==='base'?'':`<button type="button" class="ttDanger" data-tt-delete-item="${escapeHtml(sc.id)}">삭제</button>`}</div>`).join('');
    caseDlg.innerHTML=`<div class="ttModal ttManageModal"><header><h3>⚙ 경우의 수 관리</h3><button type="button" data-close="1">×</button></header><p class="ttManageIntro">기본 시간표는 조건이 맞는 경우의 수가 없을 때 적용돼.</p><div class="ttManageList">${rows}</div><footer class="ttManageFooter"><span></span><button type="button" id="ttCaseListClose">닫기</button><button type="button" id="ttCaseListAdd" class="ttPrimary">＋ 경우의 수 추가</button></footer></div>`;
    show(caseDlg);
    caseDlg.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>hide(caseDlg));
    caseDlg.querySelector('#ttCaseListClose').onclick=()=>hide(caseDlg);
    caseDlg.querySelector('#ttCaseListAdd').onclick=()=>openManage(null);
    caseDlg.querySelectorAll('[data-tt-manage-item]').forEach(btn=>btn.onclick=()=>openManage(btn.dataset.ttManageItem));
    caseDlg.querySelectorAll('[data-tt-delete-item]').forEach(btn=>btn.onclick=()=>{
      if(!confirm('이 경우의 수와 요일별 시간표를 삭제할까? 다른 경우의 수는 그대로 남아.'))return;
      const removed=data().scenarios.find(x=>x.id===btn.dataset.ttDeleteItem);
      if(removed)onTrash('ttScenario',structuredClone(removed),removed.name,'','경우의 수와 전체 주간 시간표');
      data().scenarios=data().scenarios.filter(x=>x.id!==btn.dataset.ttDeleteItem);
      if(ui.selected===btn.dataset.ttDeleteItem)ui.selected='base';
      notify();draw();openManageList();
    });
  }
  function openTicks(){
    const extra=(data().extraTicks||[]);
    ticksDlg.innerHTML=`<div class="ttModal ttTicksModal"><header><h3>🕒 시간 눈금 편집</h3><button type="button" data-close="1">×</button></header>
      <p class="ttTicksIntro">기본은 1시간 눈금이고, 등록한 일정의 시작·종료 시각은 자동으로 눈금에 표시돼. 아래에서는 일정과 관계없이 항상 표시할 눈금만 추가·삭제할 수 있어.</p>
      <form id="ttTickForm"><label>추가할 시각 (10분 단위)<input type="time" id="ttTickTime" name="tickTime" step="600" value="06:30" required></label><button type="submit" class="ttPrimary">＋ 눈금 추가</button></form>
      <div class="ttTickList">${extra.length?extra.map(t=>`<div class="ttTickItem"><span>${escapeHtml(t)}</span><button type="button" data-tick-remove="${escapeHtml(t)}" aria-label="${escapeHtml(t)} 눈금 삭제">×</button></div>`).join(''):'<span class="ttMuted">수동 추가 눈금이 없어. 일정의 시작·종료 시각은 자동 표시돼.</span>'}</div><footer class="ttManageFooter"><span></span><button type="button" data-close="1">닫기</button></footer></div>`;
    show(ticksDlg);
    ticksDlg.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>hide(ticksDlg));
    ticksDlg.querySelector('#ttTickForm').onsubmit=e=>{
      e.preventDefault();const value=ticksDlg.querySelector('#ttTickTime').value;
      if(!validTime(value)||minutes(value)%10!==0){alert('10분 단위의 시각으로 입력해 줘.');return;}
      data().extraTicks=[...new Set([...(data().extraTicks||[]),value])].sort((a,b)=>minutes(a)-minutes(b));
      notify();draw();openTicks();
    };
    ticksDlg.querySelectorAll('[data-tick-remove]').forEach(b=>b.onclick=()=>{
      data().extraTicks=(data().extraTicks||[]).filter(t=>t!==b.dataset.tickRemove);
      notify();draw();openTicks();
    });
  }
  function openManage(caseId){
    const sc=caseId?scenarioById(data(),caseId):null;
    ui.manageId=sc?.id||null;ui.manageSelected=new Set(sc?.eventIds||[]);ui.manageSearch='';
    const isBase=sc?.id==='base';
    caseDlg.innerHTML=`<div class="ttModal ttManageModal"><header><h3>${sc?'경우의 수 설정':'경우의 수 추가'}</h3><button type="button" data-close="1">×</button></header><form id="ttManageForm"><label>이름<input name="name" maxlength="60" required value="${escapeHtml(sc?.name||'')}" placeholder="예: 운동 O, 출근 X"></label>${isBase?'<p class="ttMuted">기본 시간표는 조건 없이 적용되는 기본값이야.</p>':`<div class="ttFormRow"><label>적용 조건<select name="mode"><option value="has" ${sc?.mode==='has'?'selected':''}>연결된 일정이 있는 날 (O)</option><option value="not" ${sc?.mode==='not'?'selected':''}>연결된 일정이 없는 날 (X)</option></select></label><label>우선순위<input name="priority" type="number" min="1" max="9999" value="${sc?.priority||10}"></label></div><small class="ttMuted">여러 조건이 동시에 맞으면 숫자가 큰 경우의 수가 적용돼. 같은 숫자라면 먼저 등록한 경우가 우선이야.</small><div class="ttLinks"><strong>연결할 캘린더 일정 선택</strong><input id="ttLinkSearch" type="search" placeholder="일정명 검색 (예: 헬스장)"><div id="ttLinkChoices">${linkedChoices(ui.manageSelected)}</div></div>`}<footer>${sc&&!isBase?'<button type="button" id="ttCaseDelete" class="ttDanger">경우의 수 삭제</button>':''}<span></span><button type="button" data-close="1">취소</button><button type="submit" class="ttPrimary">저장</button></footer></form></div>`;
    show(caseDlg);caseDlg.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>hide(caseDlg));
    const choices=caseDlg.querySelector('#ttLinkChoices');
    function bindChoiceEvents(){choices?.querySelectorAll('input[type=checkbox]').forEach(box=>box.onchange=()=>{if(box.checked)ui.manageSelected.add(box.value);else ui.manageSelected.delete(box.value);});}
    bindChoiceEvents();caseDlg.querySelector('#ttLinkSearch')?.addEventListener('input',e=>{ui.manageSearch=e.target.value;choices.innerHTML=linkedChoices(ui.manageSelected,ui.manageSearch);bindChoiceEvents();});
    caseDlg.querySelector('#ttManageForm').onsubmit=e=>{
      e.preventDefault();const fd=new FormData(e.currentTarget);const name=String(fd.get('name')||'').trim();if(!name)return;
      if(isBase){sc.name=name;}
      else{
        const mode=String(fd.get('mode')||'has'),priority=Math.max(1,Math.min(9999,Number(fd.get('priority'))||10));
        if(!ui.manageSelected.size){alert('연결할 캘린더 일정을 한 개 이상 선택해 줘.');return;}
        if(sc){sc.name=name;sc.mode=mode;sc.priority=priority;sc.eventIds=[...ui.manageSelected];}
        else{const obj={id:id(),name,mode,priority,eventIds:[...ui.manageSelected],days:{}};data().scenarios.push(obj);ui.selected=obj.id;}
      }
      notify();draw();openManageList();
    };
    caseDlg.querySelector('#ttCaseDelete')?.addEventListener('click',()=>{
      if(!confirm('이 경우의 수와 요일별 시간표를 삭제할까? 다른 경우의 수는 그대로 남아.'))return;
      onTrash('ttScenario',structuredClone(sc),sc.name,'','경우의 수와 전체 주간 시간표');
      data().scenarios=data().scenarios.filter(x=>x.id!==sc.id);ui.selected='base';notify();draw();openManageList();
    });
  }
  function openCopy(source){
    ui.copySource=source;
    const sc=scenarioById(data(),source.caseId);
    const label=source.type==='day'?`${sc.name} · ${WD[source.day]}요일 전체`:`${sc.name} · ${WD[source.day]}요일 · ${source.block?.title}`;
    const rows=data().scenarios.map(s=>`<div class="ttTargetRow"><b>${escapeHtml(s.name)}</b><div>${WEEK.map(d=>`<label><input type="checkbox" class="ttCopyTarget" data-tt-dest-case="${escapeHtml(s.id)}" data-tt-dest-day="${d}" ${s.id===source.caseId&&d===source.day?'disabled':''}><span>${WD[d]}</span></label>`).join('')}</div></div>`).join('');
    copyDlg.innerHTML=`<div class="ttModal ttCopyModal"><header><h3>${source.type==='day'?'요일 전체 복사':'일정 복사'}</h3><button type="button" data-close="1">×</button></header><p class="ttMuted">원본: ${escapeHtml(label)}</p><p class="ttMuted">대상 요일을 여러 개 선택해 한 번에 붙여넣을 수 있어. 같은 시간이 겹치면 실행 전에 확인해.</p><div class="ttCopyTargets">${rows}</div><footer><span></span><button type="button" data-close="1">취소</button><button type="button" class="ttPrimary" id="ttCopyApply">선택한 곳에 복사</button></footer></div>`;
    show(copyDlg);copyDlg.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>hide(copyDlg));
    copyDlg.querySelector('#ttCopyApply').onclick=()=>{
      const targets=[...copyDlg.querySelectorAll('.ttCopyTarget:checked')].map(e=>({caseId:e.dataset.ttDestCase,day:Number(e.dataset.ttDestDay)}));
      if(!targets.length){alert('복사할 경우의 수와 요일을 선택해 줘.');return;}
      const from=scenarioById(data(),source.caseId),src=source.type==='day'?(from.days[source.day]||[]).map(b=>({...b})): [source.block];
      if(!src.length){alert('원본 요일에 등록된 일정이 없어.');return;}
      let collisions=0,replaceDays=0;
      for(const t of targets){const dest=scenarioById(data(),t.caseId).days[t.day]||[];
        if(source.type==='day'){if(dest.length)replaceDays++;}
        else collisions+=targetOverlapCount(dest,src[0]);
      }
      if((collisions||replaceDays)&&!confirm(source.type==='day'?`선택한 ${targets.length}곳 중 기존 일정이 있는 요일 ${replaceDays}개를 전부 교체할까?`:`선택한 ${targets.length}곳 중 겹치는 일정 ${collisions}개를 삭제하고 복사할까?`))return;
      // A confirmed overwrite is also a deletion. Keep every displaced block recoverable.
      for(const t of targets){
        const dest=scenarioById(data(),t.caseId),blocks=dest.days[t.day]||[];
        const displaced=source.type==='day'?blocks:blocks.filter(b=>overlap(b,src[0]));
        for(const b of displaced)onTrash('ttBlock',{scenarioId:dest.id,day:t.day,block:structuredClone(b)},b.title,'',`${dest.name} · ${WD[t.day]}요일 · 복사로 교체`);
      }
      // Give both the source and newly created copies a persistent group ID.
      // Existing saved blocks still work without one, via the identical-content
      // candidates offered in the edit dialog.
      const sourceBlocks=source.type==='day'?(from.days[source.day]||[]):[(from.days[source.day]||[]).find(b=>b.id===source.block.id)].filter(Boolean);
      for(const b of sourceBlocks)if(!b.copyGroupId)b.copyGroupId=id();
      const originals=sourceBlocks.map(b=>({...b}));
      for(const t of targets){
        const dest=scenarioById(data(),t.caseId);
        if(!dest.days[t.day])dest.days[t.day]=[];
        if(source.type==='day')dest.days[t.day]=originals.map(b=>({...b,id:id()}));
        else{dest.days[t.day]=dest.days[t.day].filter(b=>!overlap(b,originals[0]));dest.days[t.day].push({...originals[0],id:id()});}
        dest.days[t.day].sort((a,b)=>minutes(a.start)-minutes(b.start));
      }
      hide(copyDlg);notify();draw();alert(`${targets.length}곳에 복사했어.`);
    };
  }
  function openDay(date){
    const found=resolve(date),s=found.scenario,day=found.weekday,blocks=(s.days[day]||[]).slice().sort((a,b)=>minutes(a.start)-minutes(b.start));
    const labels=found.matched.map(c=>`${c.name} (우선순위 ${c.priority})`).join(' · ');
    ui.lastPreview=date;
    const range=minmax([blocks]);const height=(range.end-range.start)*range.ppm;
    const {marks,lines}=axisMarks(range,false,[blocks]);
    previewDlg.innerHTML=`<div class="ttPreviewWindow"><header><div><h2>🕒 ${formatDay(date)}</h2><p>적용 시간표: <strong>${escapeHtml(s.name)}</strong></p>${labels?`<small>충족 조건: ${escapeHtml(labels)}</small>`:''}</div><button data-close="1" type="button">×</button></header><div class="ttPreviewActions"><button id="ttPreviewEdit" type="button">주간 시간표 크게 보기·편집</button></div>${blocks.length?`<div class="ttPreviewScroll"><div class="ttPreviewTrack"><div class="ttTimeAxis" style="height:${height}px">${marks}</div><div class="ttDayTrack" style="height:${height}px">${lines}${blocks.map(b=>blockHtml(b,range,false)).join('')}</div></div></div>`:'<div class="ttEmptyDay">이 경우의 수에 등록된 시간표가 없어. 주간 편집 화면에서 추가할 수 있어.</div>'}</div>`;
    show(previewDlg);previewDlg.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>hide(previewDlg));
    previewDlg.querySelector('#ttPreviewEdit').onclick=()=>{hide(previewDlg);open(s.id);};
    previewDlg.querySelectorAll('[data-tt-block]').forEach(el=>el.onclick=()=>{hide(previewDlg);open(s.id);openBlock(el.dataset.ttBlock,day);});
  }
  function injectIcons(){
    const main=document.querySelector('#main');if(!main)return;
    const insert=(container,date,insideButton=false)=>{
      if(!container || !/^\d{4}-\d{2}-\d{2}$/.test(date)||container.querySelector(`[data-tt-date="${date}"]`))return;
      const b=document.createElement(insideButton?'span':'button');
      if(!insideButton)b.type='button';else{b.setAttribute('role','button');b.tabIndex=0;}
      b.className='ttDateClock';b.textContent='🕒';b.dataset.ttDate=date;
      b.setAttribute('aria-label',`${date} 시간표 보기`);b.title=`${date} 시간표 보기`;
      const click=e=>{e.preventDefault();e.stopImmediatePropagation();e.stopPropagation();openDay(date);};
      b.addEventListener('click',click);
      b.addEventListener('dblclick',e=>{e.preventDefault();e.stopPropagation();});
      b.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){click(e);}});
      container.appendChild(b);
    };
    main.querySelectorAll('.scheduleDateHead[data-dropdate]').forEach(el=>insert(el.querySelector('.dateHeadRight')||el,el.dataset.dropdate));
    main.querySelectorAll('.cell[data-dropdate]').forEach(el=>insert(el.querySelector('.monthHeadRight')||el,el.dataset.dropdate));
    main.querySelectorAll('.multiCompactCell[data-dropdate]').forEach(el=>insert(el.querySelector('.multiCompactDate')||el,el.dataset.dropdate));
    main.querySelectorAll('.mobileDayTab[data-mobile-date]').forEach(el=>insert(el,el.dataset.mobileDate,true));
    const mobile=main.querySelector('.mobileSelectedDayHead');if(mobile){const date=main.querySelector('.mobileDayTab.selected')?.dataset.mobileDate;insert(mobile,date);}
    const day=main.querySelector('.dayCompactTop');if(day)insert(day.querySelector('.dayCompactRight')||day,getCursorDate());
    main.querySelectorAll('.listDate').forEach(el=>{const date=(el.textContent||'').match(/^\d{4}-\d{2}-\d{2}/)?.[0];if(date)insert(el,date);});
  }
  function init(){
    const mount=id=>{const el=document.createElement('div');el.id=id;el.className='ttOverlay hidden';el.setAttribute('aria-hidden','true');document.body.appendChild(el);el.addEventListener('click',e=>{if(e.target===el)hide(el);});return el;};
    host=mount('ttEditorOverlay');blockDlg=mount('ttBlockOverlay');caseDlg=mount('ttCaseOverlay');copyDlg=mount('ttCopyOverlay');previewDlg=mount('ttPreviewOverlay');ticksDlg=mount('ttTicksOverlay');
    document.getElementById('timetableOpenBtn')?.addEventListener('click',()=>open());
    window.addEventListener('resize',()=>{if(ui.open)avoidAxisLabelCollision();});
    document.addEventListener('keydown',e=>{
      if(e.key!=='Escape')return;
      const top=[ticksDlg,copyDlg,caseDlg,blockDlg,previewDlg,host].find(x=>!x.classList.contains('hidden'));
      if(top){if(top===host)close();else hide(top);}
    });
  }
  return {init,injectIcons,open,openDay,resolve};
}
