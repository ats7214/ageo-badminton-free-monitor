import fs from 'node:fs/promises';
import {GithubStore} from './github-store.mjs';
import {unseal} from './vault.mjs';
import {notifier} from './push.mjs';
import {flush,processInput,notice} from './delivery.mjs';
import {collect} from './collector.mjs';
import {inHours,jst} from './clock.mjs';

const env=process.env;
if(env.MONITOR_ENABLED!=='true'){console.log('Not enabled; no requests made.');process.exit(0);}
if(!inHours(new Date())){console.log('Outside service hours; no requests made.');process.exit(0);}
if(env.GITHUB_ACTIONS!=='true'||env.GITHUB_REPOSITORY_VISIBILITY!=='public')throw Error('FREE_STANDARD_GITHUB_RUNNER_REQUIRED');
if(env.CLOUD_BROWSER_APPROVED!=='true')throw Error('BROWSER_METHOD_NOT_APPROVED');
const store=await new GithubStore({repo:env.GITHUB_REPOSITORY,token:env.GITHUB_TOKEN,secret:env.STATE_KEY}).open();
let state=await store.load();
if(!state){
 const seed=unseal(JSON.parse(await fs.readFile(new URL('./seed.enc.json',import.meta.url),'utf8')),env.STATE_KEY);
 state={history:seed,outbox:[],health:{status:'initializing'}};await store.save(state);
}
const save=value=>store.save(value),push=notifier({topic:env.NTFY_TOPIC});
const smokeOnly=env.SMOKE_ONLY==='true';
if(!smokeOnly)await flush({state,save,push});
const previous=state.health;
try{
 state.health={status:'running',startedAt:new Date().toISOString(),previous};await save(state);
 const input=await collect({dir:'data/observations',smokeOnly});
 if(input.skipped){state.health=previous;await save(state);process.exit(0);}
 if(input.smokeOnly){
  state.smoke={testedAt:new Date().toISOString(),observations:input.observations,coverage:[]};state.health=previous;await save(state);
  console.log(JSON.stringify({event:'smoke_only',observationCount:input.observations.length,fullCoverage:false,notificationsSent:0}));process.exit(0);
 }
 const result=await processInput({state,input,today:jst().date,save,push});
 state.health={status:'healthy',completedAt:new Date().toISOString(),...result};await save(state);
 if(previous?.status==='failed')await notice({state,fingerprint:'recovered',title:'上尾の空き確認が復旧しました',message:'施設の空き確認と通知履歴の照合が正常に完了しました。',save,push});
 console.log(JSON.stringify({event:'completed',...result}));
}catch(e){
 const fingerprint=String(e.message).split(':')[0].slice(0,100);
 let detail=String(e.message).slice(0,6000);
 for(const value of [env.STATE_KEY,env.NTFY_TOPIC,env.GITHUB_TOKEN])if(value)detail=detail.replaceAll(value,'[redacted]');
 state.health={status:'failed',fingerprint,detail,lastSuccessful:previous?.status==='healthy'?previous:previous?.lastSuccessful};
 if(e.partial)state.partial=e.partial;
 await save(state);
 if(!smokeOnly&&!state.outbox?.length){
  try{await notice({state,fingerprint,title:'上尾の空き確認に失敗しました',message:'現在、空き状況を確認できません。「空きなし」とは扱っていません。次の定期実行で再確認します。',save,push});}
  catch{console.error('Failure notice could not be delivered.');}
 }
 // Failed checks keep previous availability and delivered history intact.
 console.error(JSON.stringify({event:'failed',fingerprint,detail}));process.exitCode=1;
}
