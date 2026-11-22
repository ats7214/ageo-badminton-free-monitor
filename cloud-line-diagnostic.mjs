// Explicit manual diagnostic: independent from availability, encrypted and once only.
import crypto from 'node:crypto';
import {GithubStore} from './github-store.mjs';
import {lineClient} from './line-push.mjs';
import {flush} from './delivery.mjs';
const e=process.env;
if(e.GITHUB_ACTIONS!=='true'||e.GITHUB_REPOSITORY_VISIBILITY!=='public'||e.NOTIFICATION_PROVIDER!=='line')throw Error('CLOUD_LINE_CONFIGURATION_REQUIRED');
const store=await new GithubStore({repo:e.GITHUB_REPOSITORY,token:e.GITHUB_TOKEN,secret:e.STATE_KEY}).open();
const state=await store.load();
if(!state||state.outbox?.length)throw Error('PENDING_DELIVERY_MUST_BE_RESOLVED_FIRST');
const push=lineClient({token:e.LINE_CHANNEL_ACCESS_TOKEN,userId:e.LINE_USER_ID});
const info=await push.preflight();
state.lineDiagnostic??={history:{delivered:{}},outbox:[]};
const d=state.lineDiagnostic;
d.checkedAt=new Date().toISOString();d.quotaCheck={limit:info.limit,used:info.used,remaining:info.remaining};
d.item??={id:crypto.randomUUID(),status:'ready',title:'11/22 クラウドからのLINE接続確認',message:'これは無料クラウドからの通知テストです。予約サイトの空き検索はまだ復旧していません。空き枠や予約確定の通知ではありません。',plan:{createdAt:new Date().toISOString(),keys:[],slots:[]}};
const save=()=>store.save(state);
await push.validate(d.item);
await save();
if(d.item.status!=='done'){
 d.outbox=[d.item];await save();
 await flush({state:d,save,push});
}
console.log(JSON.stringify({event:'line_diagnostic',validated:true,remainingBefore:info.remaining,accepted:d.item.status==='done',receiptId:d.item.receipt?.id,deviceDeliveryConfirmed:false}));
