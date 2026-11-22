import {scanCategory} from './browser-workflow.mjs';
import {periods,jst,inHours} from './clock.mjs';

const HOME='https://www.pf-yoyaku.com/User/ageo/Home';
const facilities=[['haraichi','原市公民館'],['hirakata','平方公民館'],['kamihira','上平公民館'],['oishi','大石公民館'],['oya','大谷公民館'],['arena','自動車精工 上尾市民体育館（市民体育館）']];
export function facilityOrder(now=new Date()) {
  const offset=Math.floor(now.getTime()/3600000)%facilities.length;
  return [...facilities.slice(offset),...facilities.slice(0,offset)];
}

export function browserSettings(env=process.env) {
  const engine=env.BROWSER_ENGINE||'chromium';
  if(!['chromium','firefox','webkit'].includes(engine))throw Error('UNSUPPORTED_BROWSER_ENGINE');
  return {engine,launch:{headless:true,...(engine==='chromium'?{chromiumSandbox:true}:{})}};
}

export async function collect({dir,env=process.env,smokeOnly=false}) {
  if(env.CLOUD_BROWSER_APPROVED!=='true')throw Error('CLOUD_BROWSER_METHOD_NOT_APPROVED');
  if(!inHours(new Date()))return {observations:[],coverage:[],skipped:true};
  const {engine,launch}=browserSettings(env);
  const drivers=await import('playwright');
  const browser=await drivers[engine].launch(launch);
  const observations=[],coverage=[],{starts,end}=periods(),today=jst().date;
  let context,page;
  let pageErrors=[],failedRequests=[],homeStatus=null,homeResponse=null;
  async function fresh(){
    if(!inHours(new Date()))throw Error('SERVICE_CLOSED');
    if(context)await context.close();
    context=await browser.newContext({locale:'ja-JP',timezoneId:'Asia/Tokyo'});
    await context.route('https://www.pf-yoyaku.com/**',route=>inHours(new Date())?route.continue():route.abort('blockedbyclient'));
    page=await context.newPage();page.setDefaultTimeout(20000);
    pageErrors=[];failedRequests=[];
    page.on('pageerror',error=>{if(pageErrors.length<12)pageErrors.push(String(error.message).slice(0,1000));});
    page.on('requestfailed',request=>{if(failedRequests.length<12){const u=new URL(request.url());failedRequests.push({path:u.origin+u.pathname,type:request.resourceType(),error:request.failure()?.errorText});}});
    page.on('dialog',async dialog=>{await dialog.dismiss();});
    let response;
    try{response=await page.goto(HOME,{waitUntil:'domcontentloaded',timeout:30000});}
    catch(error){throw new Error('PAGE_NOT_READY: Home navigation failed',{cause:error});}
    homeStatus=response?.status();
    const headers=response?.headers()??{};
    homeResponse={status:homeStatus,server:headers.server,contentType:headers['content-type'],contentLength:headers['content-length']};
    if(homeStatus>=400)throw Error('PAGE_NOT_READY: Home HTTP '+homeStatus);
    return {playwright:{
      domSnapshot:()=>page.locator('body').ariaSnapshot(),
      getByRole:(...a)=>page.getByRole(...a),getByText:(...a)=>page.getByText(...a),
      getByLabel:(...a)=>page.getByLabel(...a)
    },goto:url=>page.goto(url)};
  }
  let tab,recovered=false;
  try {
    tab=await fresh();
    let firstMonth=true;
    for(const [key,name] of (smokeOnly?facilityOrder().slice(0,1):facilityOrder())) {
      let facilityComplete=true;
      for(let i=0;i<(smokeOnly?1:starts.length);i++) {
        const begin=new Date(starts[i]+'T00:00:00Z');
        const lastDate=new Date(Date.UTC(begin.getUTCFullYear(),begin.getUTCMonth()+1,0)).toISOString().slice(0,10);
        const options={category:key==='arena'?'市民体育館':'公民館',facilities:[name],startDate:starts[i],lastDate,period:'1ヶ月',outputDirectory:dir,categoryKey:key+'-'+i,maxBatches:1};
        let resume=null;
        try {
          // A fresh guest session for each month; there is never a second live tab.
          if(!firstMonth)tab=await fresh();
          firstMonth=false;
          for(;;){
            if(!inHours(new Date()))throw Error('SERVICE_CLOSED');
            const result=await scanCategory(tab,{...options,resume});
            if(smokeOnly)return {observations:result.observations,coverage:[],smokeOnly:true};
            // Only append each already-saved batch once.
            if(result.complete){observations.push(...result.observations);break;}
            resume=result;
          }
        }catch(e){
          if(resume)observations.push(...resume.observations);
          facilityComplete=false;
          if(!inHours(new Date())||String(e.message).startsWith('SERVICE_CLOSED'))throw Object.assign(e,{partial:{observations,coverage}});
          if(recovered)throw Object.assign(e,{partial:{observations,coverage}});
          recovered=true;
          // Retry this month from scratch once, keeping previous observations.
          tab=await fresh();resume=null;
          try{
            for(;;){if(!inHours(new Date()))throw Error('SERVICE_CLOSED');const r=await scanCategory(tab,{...options,resume});if(smokeOnly)return {observations:r.observations,coverage:[],smokeOnly:true};if(r.complete){observations.push(...r.observations);break;}resume=r;}
          }catch(retry){throw Object.assign(retry,{partial:{observations,coverage}});}
          facilityComplete=true;
        }
      }
      if(facilityComplete)coverage.push({facility:name,start:today,end,complete:true});
    }
    return {observations,coverage};
  }catch(error){
    // Guest-only diagnostics go exclusively into encrypted monitor state, never public logs/artifacts.
    try {
      const u=new URL(page.url());
      error.browserFailure={at:new Date().toISOString(),url:u.origin==='null'?HOME:u.origin+u.pathname,homeStatus,homeResponse,browserVersion:browser.version(),browserEngine:engine,
        title:await page.title(),snapshot:(await page.locator('body').ariaSnapshot()).slice(0,18000),
        pageErrors,failedRequests};
    }catch{}
    throw error;
  }finally{await browser.close();}
}
