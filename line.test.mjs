import test from 'node:test';
import assert from 'node:assert/strict';
import {lineMessages,lineClient,RESERVATION_URL,availabilityLabel} from './line-push.mjs';
import {flush} from './delivery.mjs';
const item=()=>({id:'123e4567-e89b-42d3-a456-426614174000',title:'空き通知',message:'全枠の詳細',plan:{slots:[{facility:'上平公民館',room:'体育室',date:'2026-11-21',start:18,end:22,facilityFee:3100}]}});
const userId='U'+'1'.repeat(32),token='dummy-test-token';
const quotaReply=url=>url.endsWith('/quota')?new Response(JSON.stringify({type:'limited',value:200})):url.endsWith('/consumption')?new Response(JSON.stringify({totalUsage:0})):null;
test('LINE card has official link, preview and explicit unreserved status',()=>{
 const m=lineMessages(item());assert.equal(m.length,2);assert.match(m[1].altText,/上平/);
 assert.match(JSON.stringify(m),/予約未確定/);assert.equal(m[1].contents.footer.contents[0].action.uri,RESERVATION_URL);
});
test('all slots remain in text even when cards are capped at three',()=>{
 const i=item();i.plan.slots=Array(20).fill(i.plan.slots[0]);i.message='全20枠を含む本文';
 const m=lineMessages(i);assert.equal(m[0].text,i.title+'\n'+i.message);assert.equal(m[1].contents.contents.length,3);
});
test('notice without slots stays plain text',()=>assert.equal(lineMessages({...item(),plan:{slots:[]}}).length,1));

test('production relay keeps exact slot without credentials or default-browser query',()=>{
 const i=item(),slot=i.plan.slots[0];
 const c=lineClient({token,userId,navigationAssist:true,safariRelay:true});c.prepare(i);
 const action=i.line.body.messages[1].contents.footer.contents[0].action;
 const u=new URL(action.uri);assert.equal(u.origin,'https://ats7214.github.io');
 assert.equal(u.search,'');assert.equal(u.pathname,'/ageo-badminton-free-monitor/');
 assert.deepEqual(JSON.parse(decodeURIComponent(u.hash.slice(1))),{v:1,f:slot.facility,r:slot.room,d:slot.date,s:slot.start,e:slot.end});
 assert.equal(action.label,'この枠の申込画面へ');
});
test('card uses observed icons without guessing from selectability and removes manual route',()=>{
 assert.equal(availabilityLabel({availabilityIcon:'dist/images/icons.svg#circle'}),'○ 空きあり');
 assert.equal(availabilityLabel({availabilityIcon:'dist/images/icons.svg#triangle'}),'△ 施設に問い合わせ');
 assert.equal(availabilityLabel({availabilityIcon:'dist/images/icons.svg#cross'}),'× 空きなし');
 assert.match(availabilityLabel({selectable:true}),/未確認/);
 assert.match(availabilityLabel({availabilityIcon:'#unexpected',selectable:true}),/未確認/);
 const i=item();i.plan.slots[0].availabilityIcon='#circle';i.plan.slots[0].observedAt='2026-10-25T12:24:37Z';
 const m=lineMessages(i),body=JSON.stringify(m[1].contents.body);
 assert.match(body,/○ 空きあり/);assert.match(body,/21:24/);assert.doesNotMatch(body,/ログイン後：|表示期間/);
 assert.equal(m[1].contents.footer.contents.length,1);
});
test('missing credentials fail before network',()=>{assert.throws(()=>lineClient({token:'',userId}));assert.throws(()=>lineClient({token,userId:'display-name'}));});
test('free quota exhausted means no push request',async()=>{
 let posts=0;const c=lineClient({token,userId,fetcher:async(url,o)=>{if(o.method==='POST')posts++;return url.endsWith('/quota')?quotaReply(url):new Response('{"totalUsage":200}');}});
 await assert.rejects(c.send(item()),/MONTHLY_LIMIT/);assert.equal(posts,0);
});
test('paid or unlimited plan is not silently accepted',async()=>{
 const c=lineClient({token,userId,fetcher:async()=>new Response('{"type":"none"}')});await assert.rejects(c.send(item()),/FREE_PLAN/);
});
test('push uses stable retry key, private recipient and notification enabled',async()=>{
 let body,headers;const c=lineClient({token,userId,fetcher:async(url,o)=>quotaReply(url)??(body=JSON.parse(o.body),headers=o.headers,new Response('{}',{headers:{'x-line-request-id':'accepted-id'}}))});
 const r=await c.send(item());assert.equal(r.id,'accepted-id');assert.equal(r.deviceDeliveryConfirmed,false);assert.equal(body.to,userId);assert.equal(body.notificationDisabled,false);assert.equal(headers['X-Line-Retry-Key'],item().id);
});
test('409 accepted request ID recovers without a new retry key',async()=>{
 const c=lineClient({token,userId,now:()=>Date.parse('2026-10-25T01:00:00Z'),fetcher:async()=>new Response('{}',{status:409,headers:{'x-line-accepted-request-id':'prior-id'}})});
 assert.equal((await c.recover(item(),'2026-10-25T00:00:00Z')).id,'prior-id');
});
test('expired ambiguous request blocks resend',async()=>{
 let calls=0;const c=lineClient({token,userId,now:()=>Date.parse('2026-10-27T00:00:00Z'),fetcher:async()=>{calls++;}});
 await assert.rejects(c.recover(item(),'2026-10-25T00:00:00Z'),/RETRY_WINDOW/);assert.equal(calls,0);
});
test('API rejection is not a success receipt',async()=>{
 const c=lineClient({token,userId,fetcher:async url=>quotaReply(url)??new Response('{}',{status:401})});await assert.rejects(c.send(item()),/401/);
});
test('LINE validation is a separate non-delivery call',async()=>{
 let path;const c=lineClient({token,userId,fetcher:async url=>{path=url;return new Response('{}');}});assert.equal(await c.validate(item()),true);assert.ok(path.endsWith('/message/validate/push'));
});
test('durable outbox saves recipient/body/key before ambiguous LINE send and recovers 409',async()=>{
 const s={history:{delivered:{}},outbox:[{...item(),status:'ready',plan:{...item().plan,keys:[],createdAt:'2026-10-25T00:00:00Z'}}]};let saved,firstBody;
 const first=lineClient({token,userId,fetcher:async(url,o)=>{const q=quotaReply(url);if(q)return q;firstBody=o.body;throw Error('timeout');}});
 await assert.rejects(flush({state:s,save:async x=>{saved=structuredClone(x);},push:first}),/timeout/);
 assert.equal(saved.outbox[0].line.body.to,userId);assert.equal(saved.outbox[0].status,'sending');
 const next=lineClient({token,userId,fetcher:async(url,o)=>{assert.equal(o.body,firstBody);return new Response('{}',{status:409,headers:{'x-line-accepted-request-id':'already-sent'}});}});
 await flush({state:saved,save:async()=>{},push:next});assert.equal(saved.outbox.length,0);
});
test('pending LINE recipient cannot be changed after preparation',async()=>{
 const i=item();const first=lineClient({token,userId});first.prepare(i);
 const next=lineClient({token,userId:'U'+'2'.repeat(32),fetcher:async()=>{throw Error('must not send');}});
 await assert.rejects(next.recover(i,i.line.firstAttemptAt),/RECIPIENT_CHANGED/);
});
test('pending ntfy send is never resent through LINE',async()=>{
 const s={outbox:[{...item(),status:'sending'}]};await assert.rejects(flush({state:s,save:async()=>{},push:lineClient({token,userId})}),/PENDING_NTFY/);
});

