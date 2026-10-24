// Cloud copy of the observed single-tab UI workflow. Requires explicit method approval.
// No private endpoints, login secrets, or reservation calls.
import fs from 'node:fs/promises';

export async function ready(tab,heading) {
  for(let attempt=0;attempt<4;attempt++) {
    const snapshot=await tab.playwright.domSnapshot();
    if(snapshot.includes('処理を続行できません。')) throw Error('SESSION_ENDED');
    if(snapshot.includes('- dialog "エラー"')) throw Error('SITE_ERROR: '+snapshot.slice(-600));
    if(/- (?:generic|text): "?Loading/.test(snapshot)) {
      try {await tab.playwright.getByText('Loading',{exact:true}).waitFor({state:'hidden',timeoutMs:15000});}catch{}
      continue;
    }
    if(snapshot.includes(`heading "${heading}"`))return snapshot;
    try{await tab.playwright.getByRole('heading',{name:heading,exact:true}).waitFor({state:'visible',timeoutMs:15000});}catch{}
  }
  throw Error('PAGE_NOT_READY: '+heading);
}

export async function recoverHome(tab) {
  const snapshot=await tab.playwright.domSnapshot();
  if(snapshot.includes('button "Homeに戻る"'))await tab.playwright.getByRole('button',{name:'Homeに戻る',exact:true}).click();
  else if(snapshot.includes('text: Homeに戻る'))await tab.playwright.getByText('Homeに戻る',{exact:true}).click();
  else await tab.goto('https://www.pf-yoyaku.com/User/ageo/Home');
  await ready(tab,'空き照会・申込');
}

export async function scanCategory(tab,{category,facilities,startDate,outputDirectory,categoryKey,maxBatches=1,resume=null,period='3ヶ月'}) {
  if(!withinServiceHours())throw Error('SERVICE_CLOSED: outside 08:30–23:50 JST');
  if(!resume) {
  await ready(tab,'空き照会・申込');
  await tab.playwright.getByRole('button',{name:category,exact:true}).click();
  await ready(tab,'施設選択');
  for(const name of facilities)await tab.playwright.getByRole('checkbox',{name,exact:true}).check();
  await tab.playwright.getByRole('button',{name:'次へ進む',exact:true}).click();
  await ready(tab,'施設別空き状況');
  await tab.playwright.getByLabel('表示期間',{exact:true}).fill(startDate);
  await tab.playwright.getByText(period,{exact:true}).click();
  await tab.playwright.getByRole('button',{name:'表示',exact:true}).click();
  // Wait for the actual date grid, not only the selected radio or old heading.
  const monthCount={'1ヶ月':1,'2ヶ月':2,'3ヶ月':3}[period];
  if(monthCount) {
    const start=new Date(startDate+'T00:00:00Z');
    const finish=new Date(start);finish.setUTCMonth(finish.getUTCMonth()+monthCount);
    const dayCount=Math.round((finish-start)/86400000);
    await tab.playwright.getByRole('row').filter({hasText:category==='公民館'?'集会室兼体育室':/^\s*アリーナ/}).first().getByRole('checkbox').nth(dayCount-1).waitFor({state:'attached',timeoutMs:15000});
  }
  }
  const daySnapshot=resume?.daySnapshot??await ready(tab,'施設別空き状況');
  await fs.mkdir(outputDirectory,{recursive:true});
  await fs.writeFile(`${outputDirectory}/${categoryKey}-days.txt`,daySnapshot,'utf8');
  const rows=tab.playwright.getByRole('row').filter({hasText:category==='公民館'?'集会室兼体育室':/^\s*アリーナ/});
  const tasks=resume?.tasks??[];
  if(!resume) {
  for(let r=0;r<await rows.count();r++) {
    const statuses=await rows.nth(r).getByRole('checkbox').evaluateAll(es=>es.map(e=>({text:e.parentElement.textContent.trim(),disabled:e.disabled})));
    statuses.forEach((s,i)=>{if(!s.disabled&&/^(空き|一部空き)$/.test(s.text))tasks.push({r,i});});
  }
  }
  const observations=resume?.observations??[];
  let nextOffset=resume?.nextOffset??0;
  const stop=Math.min(tasks.length,nextOffset+10*maxBatches);
  for(let offset=nextOffset;offset<stop;offset+=10) {
    if(!withinServiceHours())throw Error('SERVICE_CLOSED: preserve partial observations');
    await ready(tab,'施設別空き状況');
    const allLabels=rows.locator('label');
    const active=await allLabels.evaluateAll(es=>es.map((e,i)=>e.classList.contains('active')?i:-1).filter(i=>i>=0));
    for(const index of active)await allLabels.nth(index).click();
    let selected=0;
    for(const task of tasks.slice(offset,offset+10)) {
      const cell=rows.nth(task.r).getByRole('checkbox').nth(task.i);
      const info=await cell.evaluate(e=>({text:e.parentElement.textContent.trim(),disabled:e.disabled,active:e.parentElement.classList.contains('active')}));
      if(info.disabled||!/^(空き|一部空き)$/.test(info.text))continue;
      // Click the observed parent label so Vue's selection model is updated.
      if(await rows.nth(task.r).locator('label').count()!==await rows.nth(task.r).getByRole('checkbox').count())throw Error('Unexpected day-label layout; inspect visible DOM.');
      const label=rows.nth(task.r).locator('label').nth(task.i);
      if(!info.active)await label.click();
      if(!await cell.evaluate(e=>e.parentElement.classList.contains('active')))throw Error('DAY_SELECTION_NOT_ACTIVE');
      selected++;
    }
    if(!selected){nextOffset=offset+10;continue;}
    await tab.playwright.getByRole('button',{name:'次へ進む',exact:true}).click();
    const snapshot=await ready(tab,'時間帯別空き状況');
    const selectability=await tab.playwright.getByRole('checkbox',{name:/^\d+時から\d+時まで$/}).evaluateAll(es=>es.map(e=>!e.disabled&&!e.parentElement.classList.contains('disabled')));
    const item={snapshot,selectability,session:'guest',observedAt:new Date().toISOString(),batch:offset/10};
    observations.push(item);
    await fs.writeFile(`${outputDirectory}/${categoryKey}-${offset/10}.json`,JSON.stringify(item,null,2),'utf8');
    await tab.playwright.getByRole('button',{name:'前に戻る',exact:true}).click();
    await ready(tab,'施設別空き状況');
    nextOffset=offset+10;
  }
  return {observations,daySnapshot,tasks,nextOffset,candidateDays:tasks.length,complete:nextOffset>=tasks.length};
}

export function japanNow(now=new Date()) {
  const text=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(now);
  return {date:text.slice(0,10),time:text.slice(11,16)};
}
export function withinServiceHours(now=new Date()) {
  const {time}=japanNow(now);return time>='08:30'&&time<='23:50';
}



