import crypto from 'node:crypto';
import {GithubStore} from './github-store.mjs';
import {lineClient} from './line-push.mjs';
import {candidates} from './monitor.mjs';
import {jst} from './clock.mjs';
import {flush} from './delivery.mjs';
const e=process.env;
if(e.NOTIFICATION_PROVIDER!=='line')throw Error('LINE_PROVIDER_REQUIRED');
const store=await new GithubStore({repo:e.GITHUB_REPOSITORY,token:e.GITHUB_TOKEN,secret:e.STATE_KEY}).open();
const state=await store.load();
const push=lineClient({token:e.LINE_CHANNEL_ACCESS_TOKEN,userId:e.LINE_USER_ID});
await flush({state,save:s=>store.save(s),push});
if(state.cloudLineTestItem?.status==='done'){
 console.log(JSON.stringify({event:'line_test_already_accepted',receiptId:state.cloudLineTestItem.receipt?.id}));
 process.exit(0);
}
if(state.health?.status!=='healthy'||state.health.sourceMode!=='live'||Date.now()-Date.parse(state.health.observedAt)>600000)throw Error('FRESH_LIVE_SUCCESS_REQUIRED');
if(!state.cloudLineTestItem){
 const slots=candidates(state.latest.observations,jst().date).slice(0,2);
 state.cloudLineTestItem={id:crypto.randomUUID(),status:'ready',title:'クラウドからのLINE通知テスト',message:'クラウドで自動検索する処理が完了しました。以下のカードは今回確認した候補です。予約はしていません。公式サイトで最新状況をご確認ください。',plan:{createdAt:new Date().toISOString(),keys:[],slots}};
 await store.save(state);
}
await push.validate(state.cloudLineTestItem);
state.outbox=[state.cloudLineTestItem];await store.save(state);
await flush({state,save:s=>store.save(s),push});
console.log(JSON.stringify({event:'cloud_line_test_accepted',receiptId:state.cloudLineTestItem.receipt?.id,deviceDeliveryConfirmed:false}));
