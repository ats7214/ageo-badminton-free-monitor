// Manual, guest-only connection diagnosis. No LINE client or reservation actions.
import {lookup} from 'node:dns/promises';
import {GithubStore} from './github-store.mjs';
import {inHours} from './clock.mjs';
const e=process.env,home='https://www.pf-yoyaku.com/User/ageo/';
if(e.GITHUB_ACTIONS!=='true'||e.GITHUB_REPOSITORY_VISIBILITY!=='public'||e.CLOUD_BROWSER_APPROVED!=='true'||e.MONITOR_ENABLED!=='true')throw Error('APPROVED_FREE_CLOUD_REQUIRED');
if(!inHours(new Date())){console.log('Outside service hours; no reservation-site requests made.');process.exit(0);}
const channel=e.CONNECTION_CHANNEL||'msedge';
if(!['msedge','chrome'].includes(channel))throw Error('UNSUPPORTED_INSTALLED_BROWSER');
const store=await new GithubStore({repo:e.GITHUB_REPOSITORY,token:e.GITHUB_TOKEN,secret:e.STATE_KEY}).open();
const state=await store.load();
if(!state)throw Error('EXISTING_STATE_REQUIRED');
const record={at:new Date().toISOString(),runId:e.GITHUB_RUN_ID,runnerOS:e.RUNNER_OS,channel,entryUrl:home,documents:[]};
let browser,page;
const clean=url=>{const u=new URL(url);return u.origin+u.pathname;};
try{
 record.dns=await lookup(new URL(home).hostname,{all:true});
 const {chromium}=await import('playwright');
 browser=await chromium.launch({channel,headless:true,chromiumSandbox:true});
 record.browserVersion=browser.version();
 const context=await browser.newContext({locale:'ja-JP',timezoneId:'Asia/Tokyo'});
 await context.route('https://www.pf-yoyaku.com/**',route=>inHours(new Date())?route.continue():route.abort('blockedbyclient'));
 page=await context.newPage();
 page.on('dialog',d=>d.dismiss());
 const cdp=await context.newCDPSession(page);
 await cdp.send('Network.enable');
 cdp.on('Network.requestWillBeSent',v=>{
  if(v.type==='Document'&&v.request.url.startsWith(home)){
   record.requestHeaders=Object.fromEntries(Object.entries(v.request.headers).filter(([k])=>['user-agent','accept-language','sec-ch-ua','sec-ch-ua-platform','accept'].includes(k.toLowerCase())));
  }
 });
 cdp.on('Network.responseReceived',v=>{
  if(v.type!=='Document'||!v.response.url.startsWith('https://www.pf-yoyaku.com/'))return;
  const r=v.response;
  record.documents.push({url:clean(r.url),status:r.status,protocol:r.protocol,remoteIPAddress:r.remoteIPAddress,remotePort:r.remotePort,fromDiskCache:r.fromDiskCache,fromServiceWorker:r.fromServiceWorker,
   headers:Object.fromEntries(Object.entries(r.headers).filter(([k])=>['server','content-type','content-length','date','cache-control','vary'].includes(k.toLowerCase()))),
   tls:r.securityDetails?{protocol:r.securityDetails.protocol,issuer:r.securityDetails.issuer,validFrom:r.securityDetails.validFrom,validTo:r.securityDetails.validTo}:null});
 });
 const response=await page.goto(home,{waitUntil:'domcontentloaded',timeout:30000});
 record.status=response?.status();
 if(record.status<400){try{await page.getByRole('heading',{name:'空き照会・申込',exact:true}).waitFor({state:'visible',timeout:15000});}catch{}}
 record.url=clean(page.url());record.title=await page.title();
 record.snapshot=(await page.locator('body').ariaSnapshot()).slice(0,6000);
 record.ready=record.snapshot.includes('heading "空き照会・申込"');
}catch(error){record.error=String(error.message).slice(0,3000);}
finally{await browser?.close();}
// Communication details and guest DOM remain encrypted; do not upload an artifact.
let safe=JSON.stringify(record);
for(const secret of [e.STATE_KEY,e.GITHUB_TOKEN])if(secret)safe=safe.replaceAll(secret,'[redacted]');
state.connectionChecks=[...(state.connectionChecks??[]),JSON.parse(safe)].slice(-8);
await store.save(state);
console.log(JSON.stringify({event:'connection_check',runId:record.runId,channel,status:record.status??null,ready:record.ready===true,recorded:true}));
if(!record.ready)process.exitCode=1;
