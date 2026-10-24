import test from 'node:test';
import assert from 'node:assert/strict';
import {seal,unseal} from './vault.mjs';
import {notifier} from './push.mjs';
import {GithubStore} from './github-store.mjs';
import {flush,messages,processInput,onlineStatus,notice} from './delivery.mjs';
import {facilityOrder} from './collector.mjs';
import {inHours,periods} from './clock.mjs';
import {candidates} from './monitor.mjs';

const secret='a'.repeat(64),topic='ageo-'+'a'.repeat(32);
const fixture=(date='2026年12月19日')=>({snapshot:`- heading "時間帯別空き状況" [level=2]\n- heading "平方公民館" [level=3]\n- generic: ${date}\n- generic: 集会室兼体育室\n- checkbox "12時から15時まで"`,selectability:[false],session:'guest',observedAt:'2026-10-24T13:00:00Z'});
const state=()=>({history:{delivered:{}},outbox:[]});
const input=()=>({observations:[fixture()],coverage:[]});
const mock=()=>({send:async()=>({id:'receipt',accepted:true}),find:async()=>null});
const args=s=>({state:s,input:input(),today:'2026-10-24',save:async()=>{},push:mock()});

test('encrypted state round trips without exposing history',()=>{
 const value={history:'private activity',topic};const wrapped=seal(value,secret);
 assert.equal(JSON.stringify(wrapped).includes('private activity'),false);
 assert.deepEqual(unseal(wrapped,secret),value);
});
test('wrong key and tampered ciphertext fail closed',()=>{
 const wrapped=seal({x:1},secret);assert.throws(()=>unseal(wrapped,'b'.repeat(64)));
 wrapped.tag=Buffer.alloc(16).toString('base64');assert.throws(()=>unseal(wrapped,secret));
});
test('strong topic required',()=>assert.throws(()=>notifier({topic:'ageo'}),/STRONG/));
test('ntfy acceptance requires actual server receipt',async()=>{
 const requests=[];const push=notifier({topic,fetcher:async(url,options)=>{requests.push({url,options});return new Response(JSON.stringify({id:'real-shaped-id',event:'message',topic}));}});
 assert.equal((await push.send({title:'テスト',message:'test'})).id,'real-shaped-id');assert.equal(JSON.parse(requests[0].options.body).topic,topic);
});
test('ntfy explicit rejection is retryable; bad receipt is not accepted',async()=>{
 const push=notifier({topic,fetcher:async()=>new Response('limit',{status:429})});
 await assert.rejects(push.send({title:'t',message:'m'}),e=>e.definitelyRejected===true);
 await assert.rejects(notifier({topic,fetcher:async()=>new Response('{}')}).send({title:'t',message:'m'}),/RECEIPT/);
});
test('ntfy uncertain delivery can be matched against cached message',async()=>{
 const push=notifier({topic,fetcher:async()=>new Response(JSON.stringify({event:'message',id:'found',title:'t',message:'m'})+'\n')});
 assert.equal((await push.find({title:'t',message:'m'})).id,'found');
});
test('send success survives restart without duplicate',async()=>{
 let saved,sends=0;const options={...args(state()),save:async x=>{saved=structuredClone(x);},push:{...mock(),send:async()=>({id:String(++sends)})}};
 assert.equal((await processInput(options)).newCount,1);
 assert.equal((await processInput({...options,state:structuredClone(saved)})).newCount,0);assert.equal(sends,1);
});
test('ambiguous send recovers from server cache without resending',async()=>{
 const s=state();let saved;
 await assert.rejects(processInput({...args(s),save:async x=>{saved=structuredClone(x);},push:{...mock(),send:async()=>{throw Error('socket');}}}));
 assert.equal(saved.outbox[0].status,'sending');
 await flush({state:saved,save:async()=>{},push:{send:async()=>{throw Error('duplicate');},find:async()=>({id:'cached'})}});
 assert.equal(Object.keys(saved.history.delivered).length,1);
});
test('missing ambiguous receipt blocks resend',async()=>{
 const s=state();s.outbox=messages([{facility:'平方公民館',room:'体育室',date:'2026-12-19',start:12,end:15}], '2026-10-24','2026-10-24T13:00:00Z');s.outbox[0].status='sending';
 await assert.rejects(flush({state:s,save:async()=>{},push:mock()}),/UNCERTAIN/);
});
test('durable state failure before sending prevents notification',async()=>{
 let sends=0;await assert.rejects(processInput({...args(state()),save:async()=>{throw Error('disk');},push:{...mock(),send:async()=>{sends++;}}}));assert.equal(sends,0);
});
test('partial empty fetch never marks a slot as disappeared',async()=>{
 const s=state();await processInput(args(s));await processInput({...args(s),input:{observations:[],coverage:[]}});
 assert.equal((await processInput(args(s))).newCount,0);
});
test('complete disappearance then reappearance notifies again',async()=>{
 const s=state();await processInput(args(s));await processInput({...args(s),input:{observations:[],coverage:[{facility:'平方公民館',start:'2026-10-24',end:'2026-12-31',complete:true}]}});
 assert.equal((await processInput(args(s))).newCount,1);
});
test('large candidate list splits into safe complete messages',()=>{
 const slots=Array.from({length:180},(_,i)=>({facility:'自動車精工 上尾市民体育館（市民体育館）',room:'アリーナ1/2B',date:'2026-12-19',start:i,end:i+1,facilityFee:3200}));
 const groups=messages(slots,'2026-10-24','2026-10-24T13:00:00Z');assert.equal(groups.flatMap(x=>x.plan.keys).length,180);assert.ok(groups.every(x=>Buffer.byteLength(x.message)<3500));
});
test('online closing dates distinguish halls and gym',()=>{
 assert.match(onlineStatus({facility:'平方公民館',date:'2026-10-27'},'2026-10-24'),/締切後/);
 assert.match(onlineStatus({facility:'上尾市民体育館',date:'2026-10-27'},'2026-10-24'),/資格/);
});
test('free configuration rejects private repository before starting browser',async()=>{
 const store=new GithubStore({repo:'test/repo',token:'fake',secret,fetcher:async()=>new Response(JSON.stringify({visibility:'private'}))});
 await assert.rejects(store.open(),/FREE_PUBLIC/);
});
test('state write conflict stops rather than replacing newer history',async()=>{
 const store=new GithubStore({repo:'test/repo',token:'fake',secret,fetcher:async()=>new Response('{}',{status:409})});
 await assert.rejects(store.save(state()),/409/);
});
test('facilities rotate fairly and date boundaries remain enforced',()=>{
 const first=new Set(Array.from({length:6},(_,hour)=>facilityOrder(new Date(Date.UTC(2026,9,24,hour)))[0][0]));assert.equal(first.size,6);
 assert.equal(inHours(new Date('2026-10-23T23:29:00Z')),false);assert.equal(inHours(new Date('2026-10-23T23:30:00Z')),true);
 assert.equal(periods(new Date('2026-12-31T12:00:00Z')).end,'2027-02-28');
});
test('same incident is notified only once, recovery can be notified',async()=>{
 const s=state();let sends=0;const options={state:s,fingerprint:'SITE_ERROR',title:'t',message:'m',save:async()=>{},push:{...mock(),send:async()=>({id:String(++sends)})}};
 assert.equal(await notice(options),true);assert.equal(await notice(options),false);
 assert.equal(await notice({...options,fingerprint:'recovered'}),true);assert.equal(sends,2);
});
test('accepted outbox survives state-save crash without resend',async()=>{
 const s=state();s.outbox=messages([{facility:'平方公民館',room:'体育室',date:'2026-12-19',start:12,end:15}], '2026-10-24','2026-10-24T13:00:00Z');
 s.outbox[0].status='accepted';s.outbox[0].receipt={id:'previously-accepted'};
 await flush({state:s,save:async()=>{},push:{...mock(),send:async()=>{throw Error('duplicate');}}});
 assert.equal(Object.values(s.history.delivered)[0].messageId,'previously-accepted');
});
test('GitHub state load/decrypt/save uses expected SHA and encrypted body',async()=>{
 const wrapped=seal(state(),secret);let put;
 const store=new GithubStore({repo:'test/repo',token:'fake',secret,fetcher:async(url,options)=>{
  if(options.method==='PUT'){put=JSON.parse(options.body);return new Response(JSON.stringify({content:{sha:'next'}}));}
  return new Response(JSON.stringify({sha:'original',content:Buffer.from(JSON.stringify(wrapped)).toString('base64')}));
 }});
 const value=await store.load();await store.save(value);assert.equal(put.sha,'original');assert.equal(store.sha,'next');
 assert.deepEqual(unseal(JSON.parse(Buffer.from(put.content,'base64').toString()),secret),value);
});
test('compact browser text retains date and room before time checkbox',()=>{
 const obs=fixture();obs.snapshot=obs.snapshot.replace('- generic: 2026年12月19日\n- generic: 集会室兼体育室','- text: 2026年12月19日 (土) 集会室兼体育室 定員200 名');
 const slots=candidates([obs],'2026-10-24');assert.equal(slots.length,1);assert.equal(slots[0].room,'集会室兼体育室');
});
