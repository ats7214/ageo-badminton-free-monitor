import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Only consumes browser observations. It never signs in or sends reservations.
const HOLIDAYS = new Set(['2026-01-01','2026-01-12','2026-02-11','2026-02-23','2026-03-20','2026-04-29','2026-05-03','2026-05-04','2026-05-05','2026-05-06','2026-07-20','2026-08-11','2026-09-21','2026-09-22','2026-09-23','2026-10-12','2026-11-03','2026-11-23','2027-01-01','2027-01-11','2027-02-11','2027-02-23','2027-03-21','2027-03-22','2027-04-29','2027-05-03','2027-05-04','2027-05-05','2027-07-19','2027-08-11','2027-09-20','2027-09-23','2027-10-11','2027-11-03','2027-11-23']);
export const key = s => [s.facility,s.room,s.date,s.start,s.end].join('|');
export function parseSnapshot(observation) {
  const {snapshot,observedAt,session='unknown',selectability=[]}=observation;
  if (!snapshot?.includes('heading "時間帯別空き状況"') || snapshot.includes('- dialog "エラー"')) throw Error('Valid time-detail page required; failed checks are not empty availability.');
  if(!Number.isFinite(Date.parse(observedAt))) throw Error('Observation timestamp required.');
  let facility='', date='', room='', index=0;
  const slots=[];
  for (const line of snapshot.split('\n')) {
    const h=line.match(/^\s*- heading "(.+)" \[level=3\]/);
    if(h) { facility=h[1]; date=''; room=''; }
    const d=line.match(/^\s*- (?:generic|text): .*?(\d{4})年\s*(\d+)月(\d+)日/);
    if(d) { date=`${d[1]}-${d[2].padStart(2,'0')}-${d[3].padStart(2,'0')}`; room=''; }
    const r=line.match(/^\s*- (?:generic|text): .*?(集会室兼体育室|体育室|アリーナ(?:\s*[１２12]\s*[／/]\s*[１２12]\s*[ＡＢAB])?)/);
    if(r) room=r[1].trim().replace(/"$/,'');
    const t=line.match(/^\s*- checkbox "(\d+)時から(\d+)時まで"/);
    if(!t) continue;
    const selectable=selectability[index++];
    if(!facility||!date||!room) throw Error('Slot missing visible facility/date/room context.');
    slots.push({facility,room,date,start:Number(t[1]),end:Number(t[2]),observedAt,session,selectable:typeof selectable==='boolean'?selectable:null});
  }
  if(selectability.length && selectability.length!==index) throw Error('Checkbox observation alignment mismatch.');
  return slots;
}
export function wanted(s, today) {
  if(s.date<today) return false;
  const year=Number(s.date.slice(0,4));
  if(year<2026||year>2027) throw Error('Refresh official holiday data before monitoring this year.');
  const weekday=new Date(s.date+'T00:00:00Z').getUTCDay();
  return weekday===0||weekday===6||HOLIDAYS.has(s.date)||s.start>=18;
}
export function price(s) {
  if(/原市|平方/.test(s.facility)) return s.start>=18?2100:1600;
  if(/大石|上平|大谷/.test(s.facility)) return s.start>=18?3100:2400;
  if(/市民体育館/.test(s.facility)&&/アリーナ.*[１２12].*[ＡＢAB]/.test(s.room)) return 3200;
  return null;
}
export function candidates(observations,today) {
  const map=new Map();
  for(const observation of observations) for(const s of parseSnapshot(observation)) if(wanted(s,today)) map.set(key(s),{...s,facilityFee:price(s)});
  return [...map.values()].sort((a,b)=>a.date.localeCompare(b.date)||a.start-b.start||key(a).localeCompare(key(b),'ja'));
}
export function prepare(state,slots,now) {
  const pending=slots.filter(s=>!state.delivered?.[key(s)] || state.delivered[key(s)].inactive);
  // Never overwrite coverage or delivered history on a failed/partial fetch.
  return {createdAt:now,keys:pending.map(key),slots:pending};
}
export function reconcile(state,slots,coverage=[]) {
  const next=structuredClone(state); const available=new Set(slots.map(key));
  for(const [k,delivery] of Object.entries(next.delivered??{})) {
    const [facility,,date]=k.split('|');
    if(coverage.some(c=>c.complete===true&&c.facility===facility&&date>=c.start&&date<=c.end)&&!available.has(k)) delivery.inactive=true;
  }
  return next;
}
export function acknowledge(state,plan,messageId) {
  if(!messageId) throw Error('Successful Gmail message ID required before acknowledging.');
  const next=structuredClone(state); next.delivered??={};
  for(const k of plan.keys) next.delivered[k]={messageId,at:plan.createdAt,inactive:false};
  return next;
}
export async function atomicJson(filename,data) {
  await fs.mkdir(path.dirname(filename),{recursive:true});
  const temporary=filename+'.tmp';
  await fs.writeFile(temporary,JSON.stringify(data,null,2),'utf8');
  await fs.rename(temporary,filename);
}
export function emailHtml(plan) {
  const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const rows=plan.slots.map(s=>`<tr><td>${escape(s.facility)} ${escape(s.room)}</td><td>${s.date}</td><td>${s.start}:00〜${s.end}:00</td><td>${s.facilityFee??'要確認'}円</td><td>${s.session==='authenticated'&&s.selectable===true?'ログイン中の画面で選択可能':'空き表示・申込資格は要確認'}</td></tr>`).join('');
  return `<p>上尾市のバドミントン利用候補です。予約はしていません。</p><p>平日18時以降・土日祝全時間／6〜10人。全対象施設を平等に調べ、日付・開始時刻順に表示します。シャトル代・追加設備代は含みません。</p><table border="1"><tr><th>施設</th><th>日付</th><th>時間</th><th>施設代の目安</th><th>申込可否</th></tr>${rows}</table><p>確認時点：${escape(plan.createdAt)}。空きは変動します。<a href="https://www.pf-yoyaku.com/User/ageo/Home">公式予約サイト</a>で再確認してください。</p>`;
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [command,...args]=process.argv.slice(2);
  if(command==='prepare') {
    const [statePath,inputPath,planPath,today]=args;
    let state; try{state=JSON.parse(await fs.readFile(statePath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;state={delivered:{}};}
    const input=JSON.parse(await fs.readFile(inputPath,'utf8'));
    const observations=Array.isArray(input)?input:input.observations;
    const slots=candidates(observations,today);
    state=reconcile(state,slots,input.coverage??[]);
    const plan=prepare(state,slots,new Date().toISOString());
    await atomicJson(statePath,state);
    await atomicJson(planPath,plan); await fs.writeFile(planPath+'.html',emailHtml(plan),'utf8');
    console.log(JSON.stringify({candidateCount:slots.length,newCount:plan.keys.length,planPath}));
  } else if(command==='ack') {
    const [statePath,planPath,messageId]=args;
    let state;try{state=JSON.parse(await fs.readFile(statePath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;state={delivered:{}};}
    await atomicJson(statePath,acknowledge(state,JSON.parse(await fs.readFile(planPath,'utf8')),messageId));
    console.log('Acknowledged successful delivery.');
  } else { throw Error('Use prepare STATE INPUT PLAN YYYY-MM-DD, or ack STATE PLAN GMAIL_MESSAGE_ID'); }
}

