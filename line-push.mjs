// LINE adapter; optional Safari navigation assistance stays disabled by default.
import crypto from 'node:crypto';
const BASE='https://api.line.me/v2/bot';
export const RESERVATION_URL='https://www.pf-yoyaku.com/User/ageo/Home';
const uuid=/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const text=(value,extra={})=>({type:'text',text:String(value),wrap:true,...extra});
export function availabilityLabel(s){
 const icon=String(s.availabilityIcon??'').split('#')[1];
 if(icon==='circle')return '○ 空きあり';
 if(icon==='triangle')return '△ 施設に問い合わせ';
 if(icon==='cross')return '× 空きなし';
 return '記号未確認（公式画面で確認）';
}
export function observedLabel(s){
 if(!Number.isFinite(Date.parse(s.observedAt)))return '確認時刻：未記録';
 return '確認：'+new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(s.observedAt))+' 日本時間';
}
export function reservationMemo(s){
 const category=/市民体育館/.test(s.facility)?'市民体育館':'公民館';
 return `${s.facility} ${s.room}\n${s.date} ${s.start}:00〜${s.end}:00\n操作：${category} → ${s.facility} → 表示期間 ${s.date}・1日 → ${s.room} → ${s.start}〜${s.end}時\n予約未確定・公式サイトで最新状況を確認`;
}

export function assistedReservationUrl(s){
 const target={v:1,f:s.facility,r:s.room,d:s.date,s:s.start,e:s.end};
 return RESERVATION_URL+'?openExternalBrowser=1#ageo-slot='+encodeURIComponent(JSON.stringify(target));
}
export function lineMessages(item,{navigationAssist=false}={}){
 const slots=item.plan?.slots??[];
 const summary={type:'text',text:(item.title+'\n'+item.message).slice(0,5000)};
 if((item.title+'\n'+item.message).length>5000)throw Error('LINE_TEXT_TOO_LONG');
 if(!slots.length)return [summary];
 const bubbles=slots.slice(0,3).map(s=>({type:'bubble',body:{type:'box',layout:'vertical',spacing:'md',contents:[
  text('空き枠が見つかりました',{weight:'bold',color:'#06C755',size:'lg'}),
  text(s.facility+' '+s.room,{weight:'bold'}),
  text(`${s.date} ${s.start}:00〜${s.end}:00`),
  text('予約状況：'+availabilityLabel(s),{weight:'bold',color:s.availabilityIcon?.endsWith('#circle')?'#08783E':'#805800'}),
  text(observedLabel(s),{size:'sm',color:'#666666'}),
  text(`施設代目安：${s.facilityFee??'要確認'}${s.facilityFee==null?'':'円'}`),
  text('6〜10人で利用予定／予約未確定・申込資格は要確認',{size:'sm',color:'#666666'})
 ]},footer:{type:'box',layout:'vertical',spacing:'sm',contents:[
  {type:'button',style:'primary',color:'#06C755',action:{type:'uri',label:navigationAssist?'この枠の申込画面へ':'公式サイトを開く',uri:navigationAssist?assistedReservationUrl(s):RESERVATION_URL}}
 ]}}));
 // Full text preserves every slot; cards show only the first three examples.
 const first=slots[0];
 return [summary,{type:'flex',altText:`空き${slots.length}枠：${first.facility} ${first.date} ${first.start}時〜`.slice(0,400),
  contents:bubbles.length===1?bubbles[0]:{type:'carousel',contents:bubbles}}];
}

export function lineClient({token,userId,fetcher=fetch,now=()=>Date.now(),navigationAssist=false}){
 if(typeof token!=='string'||!token.trim()||/[\r\n]/.test(token))throw Error('LINE_TOKEN_REQUIRED');
 if(!/^U[a-f\d]{32}$/i.test(userId??''))throw Error('LINE_USER_ID_REQUIRED');
 const binding=crypto.createHash('sha256').update(userId).digest('hex');
 function prepare(item){
  if(item.line){if(item.line.binding!==binding||item.line.body.to!==userId||item.line.retryKey!==item.id)throw Error('LINE_PENDING_RECIPIENT_CHANGED');return;}
  item.line={binding,retryKey:item.id,firstAttemptAt:new Date(now()).toISOString(),body:{to:userId,messages:lineMessages(item,{navigationAssist}),notificationDisabled:false}};
 }
 async function request(path,options={}){
  return fetcher(BASE+path,{...options,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...options.headers},signal:AbortSignal.timeout(30000)});
 }
 async function jsonGet(path){const r=await request(path);if(!r.ok)throw Error('LINE_CHECK_HTTP_'+r.status);return r.json();}
 async function quota(){
  const plan=await jsonGet('/message/quota');
  if(plan.type!=='limited'||plan.value!==200)throw Error('LINE_JAPAN_FREE_PLAN_NOT_CONFIRMED');
  const usage=await jsonGet('/message/quota/consumption');
  if(!Number.isInteger(usage.totalUsage)||usage.totalUsage<0)throw Error('LINE_USAGE_INVALID');
  if(usage.totalUsage>=200)throw Object.assign(Error('LINE_FREE_MONTHLY_LIMIT'),{definitelyRejected:true});
  return {limit:200,used:usage.totalUsage,remaining:200-usage.totalUsage};
 }
 async function post(item){
  if(!uuid.test(item.id??''))throw Error('LINE_DURABLE_RETRY_KEY_REQUIRED');
  prepare(item);
  const r=await request('/message/push',{method:'POST',headers:{'X-Line-Retry-Key':item.line.retryKey},body:JSON.stringify(item.line.body)});
  const id=r.status===409?r.headers.get('x-line-accepted-request-id'):r.headers.get('x-line-request-id');
  if((r.status===200||r.status===409)&&id)return {id,accepted:true,provider:'line',deviceDeliveryConfirmed:false};
  throw Object.assign(Error('LINE_PUSH_HTTP_'+r.status),{definitelyRejected:r.status>=400&&r.status<500&&r.status!==409});
 }
 return {
  provider:'line',quota,prepare,
  async preflight(){const account=await jsonGet('/info');await jsonGet('/profile/'+userId);return {accountName:account.displayName,...await quota()};},
  async validate(item){const r=await request('/message/validate/push',{method:'POST',body:JSON.stringify({messages:lineMessages(item,{navigationAssist})})});if(!r.ok)throw Error('LINE_VALIDATE_HTTP_'+r.status);return true;},
  async send(item){await quota();return post(item);},
  async recover(item,firstAttemptAt){
   const age=now()-Date.parse(firstAttemptAt);
   // LINE retry keys expire after 24 h; require manual review well before then.
   if(!Number.isFinite(age)||age<0||age>23*3600000)throw Error('LINE_RETRY_WINDOW_NEEDS_REVIEW');
   // Same durable key and identical body; a 409 accepted ID confirms prior acceptance.
   return post(item);
  }
 };
}
