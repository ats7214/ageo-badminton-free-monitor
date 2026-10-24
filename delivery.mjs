import crypto from 'node:crypto';
import {candidates,key,prepare,reconcile,acknowledge} from './monitor.mjs';

export function onlineStatus(slot,today){
 const days=Math.round((new Date(slot.date+'T00:00:00Z')-new Date(today+'T00:00:00Z'))/86400000);
 return days>=(/市民体育館/.test(slot.facility)?3:4)?'申込資格は要確認':'ネット申込締切後・窓口へ要確認';
}
export function messages(slots,today,createdAt){
 const groups=[];let group=[];
 const line=s=>`${s.date} ${s.start}〜${s.end}時 ${s.facility} ${s.room} ${s.facilityFee??'要確認'}円 [${onlineStatus(s,today)}]`;
 for(const slot of slots){
  if(Buffer.byteLength([...group,slot].map(line).join('\n'),'utf8')>2900&&group.length){groups.push(group);group=[];}
  group.push(slot);
 }
 if(group.length)groups.push(group);
 return groups.map((items,i)=>({id:crypto.randomUUID(),status:'ready',plan:{createdAt,keys:items.map(key),slots:items},
  title:`上尾バドミントン ${items.length}枠（${i+1}/${groups.length}）`,
  message:items.map(line).join('\n')+'\n6〜10人／予約未確定。タップで公式サイト。\n確認：'+createdAt}));
}
export async function flush({state,save,push,now=new Date()}){
 const today=now.toISOString().slice(0,10);
 if(state.quota?.date!==today)state.quota={date:today,count:0};
 for(const item of state.outbox??[]){
  if(item.status==='done')continue;
  let receipt;
  if(item.status==='accepted')receipt=item.receipt;
  else if(item.status==='sending'){
   // Reconcile the server cache; never blindly resend an ambiguous publication.
   receipt=await push.find(item);
   if(!receipt?.id)throw Error('DELIVERY_UNCERTAIN_NEEDS_REVIEW');
  }else{
   if(state.quota.count>=200)throw Error('FREE_DAILY_NOTIFICATION_LIMIT');
   item.status='sending';state.quota.count++;await save(state);
   try{receipt=await push.send(item);}
   catch(e){if(e.definitelyRejected){item.status='ready';await save(state);}throw e;}
   if(!receipt?.id)throw Error('DELIVERY_NOT_CONFIRMED');
  }
  item.status='accepted';item.receipt=receipt;await save(state);
  state.history=acknowledge(state.history,item.plan,receipt.id);item.status='done';await save(state);
 }
 state.outbox=[];await save(state);
}
export async function processInput({state,input,today,save,push,now=new Date()}){
 await flush({state,save,push,now});
 const slots=candidates(input.observations,today);
 state.history=reconcile(state.history,slots,input.coverage??[]);
 const plan=prepare(state.history,slots,now.toISOString());
 state.latest={observedAt:now.toISOString(),candidateCount:slots.length,newCount:plan.keys.length,observations:input.observations,coverage:input.coverage};
 state.outbox=messages(plan.slots,today,plan.createdAt);await save(state);
 await flush({state,save,push,now});
 return {candidateCount:slots.length,newCount:plan.keys.length};
}
export async function notice({state,fingerprint,title,message,save,push,now=new Date()}){
 if(state.lastNoticeFingerprint===fingerprint)return false;
 if(state.outbox?.length)throw Error('PENDING_DELIVERY_MUST_BE_RESOLVED_FIRST');
 state.lastNoticeFingerprint=fingerprint;
 state.outbox=[{id:crypto.randomUUID(),status:'ready',title,message,plan:{createdAt:now.toISOString(),keys:[],slots:[]}}];
 await save(state);await flush({state,save,push,now});return true;
}
