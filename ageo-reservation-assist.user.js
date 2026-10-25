// ==UserScript==
// @name         上尾バドミントン 予約画面アシスト
// @namespace    ageo-badminton-free-monitor
// @version      0.2.0
// @description  LINEの対象枠を画面で選び、申込内容入力で停止します。ログインと予約確定は本人操作です。
// @match        https://www.pf-yoyaku.com/User/ageo/*
// @run-at       document-idle
// @inject-into  content
// @noframes
// @grant        none
// ==/UserScript==
(function () {
 'use strict';
 const HOME='https://www.pf-yoyaku.com/User/ageo/Home';
 const KEY='ageo-reservation-assist-v1',TTL=20*60*1000;
 const halls=['原市公民館','平方公民館','上平公民館','大石公民館','大谷公民館'];
 const gym='自動車精工 上尾市民体育館（市民体育館）';
 const normalize=s=>String(s??'').normalize('NFKC').replace(/\s+/g,'').trim();
 function validate(t){
  if(!t||t.v!==1||![...halls,gym].includes(t.f))throw Error('通知の施設指定が正しくありません');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(t.d)||new Date(t.d+'T00:00:00Z').toISOString().slice(0,10)!==t.d)throw Error('通知の日付が正しくありません');
  if(!Number.isInteger(t.s)||!Number.isInteger(t.e)||t.s<9||t.e>22||t.s>=t.e)throw Error('通知の時間指定が正しくありません');
  if(halls.includes(t.f)?t.r!=='集会室兼体育室':!/^アリーナ\s*[１1][／/]\s*[２2][ＡＢAB]$/.test(t.r))throw Error('通知の体育室指定が正しくありません');
  return {v:1,f:t.f,r:t.r,d:t.d,s:t.s,e:t.e};
 }
 function link(t){return HOME+'?openExternalBrowser=1#ageo-slot='+encodeURIComponent(JSON.stringify(validate(t)));}
 function fromHash(hash){if(!hash.startsWith('#ageo-slot='))return null;return validate(JSON.parse(decodeURIComponent(hash.slice(11))));}
 function plan(view,t){
  validate(t);
  // Boundary checks precede every navigation action, including Next.
  if(view.boundary)return {type:'done',message:'申込内容の入力画面まで進みました。内容を確認し、申し込みはご自身で行ってください。'};
  if(view.error)return {type:'stop',message:view.error};
  if(view.login)return {type:'wait',message:'公式サイトでログインしてください。ログイン後に続けます。'};
  if(view.loading)return {type:'wait',message:'公式サイトの表示を待っています。'};
  if(view.stage==='home')return {type:view.loggedOut?'login':'category',message:view.loggedOut?'公式サイトでの本人ログインを待ちます。':'対象の施設種類を開きます。'};
  if(view.stage==='facilities')return {type:view.facilitiesReady?'next':'facility',message:'通知の施設を選択しています。'};
  if(view.stage==='days'){
   if(view.date!==t.d)return {type:'date',message:'通知の日付を設定しています。'};
   if(!view.oneDay)return {type:'period',message:'通知の1日だけを表示します。'};
   if(!view.gridMatches)return {type:'display',message:'対象日の空き状況を表示しています。'};
   if(!view.dayFound)return {type:'stop',message:'対象の体育室を見つけられません。自動操作を停止しました。'};
   if(view.dayUnavailable)return {type:'stop',message:'対象日は選択できません。満室・受付期間・利用条件を公式サイトで確認してください。'};
   return {type:view.daySelected?'next':'day',message:'対象日の体育室を選択しています。'};
  }
  if(view.stage==='times'){
   if(!view.exactTarget)return {type:'stop',message:'施設・日付・体育室が通知と一致しないため停止しました。'};
   if(view.timeCount!==1)return {type:'stop',message:'通知の時間帯を一意に確認できないため停止しました。'};
   if(view.timeUnavailable)return {type:'stop',message:'対象の時間は選択できません。空きの変更や利用条件を確認してください。'};
   return {type:view.timeSelected?'next':'time',message:'通知の時間帯を選んで申込内容入力へ進みます。'};
  }
  return {type:'stop',message:'対応していない画面のため、自動操作を停止しました。'};
 }
 const api={validate,link,fromHash,plan,normalize,TTL};
 if(typeof module==='object'&&module.exports){module.exports=api;return;}
 if(window.top!==window.self||location.origin!=='https://www.pf-yoyaku.com'||!location.pathname.startsWith('/User/ageo/'))return;
 let state;
 try{
  const target=fromHash(location.hash);
  if(target){state={target,createdAt:Date.now(),paused:false};sessionStorage.setItem(KEY,JSON.stringify(state));}
  else state=JSON.parse(sessionStorage.getItem(KEY)||'null');
  if(!state)return;
  validate(state.target);
  if(Date.now()-state.createdAt>TTL){sessionStorage.removeItem(KEY);return;}
 }catch{sessionStorage.removeItem(KEY);return;}
 const t=state.target;
 const panel=document.createElement('section');panel.id='ageo-reservation-assist';
 panel.style.cssText='position:fixed;z-index:2147483647;left:8px;right:8px;bottom:8px;padding:12px;background:#effff3;color:#123;border:2px solid #06a84f;border-radius:12px;font:14px/1.5 sans-serif;box-shadow:0 3px 18px #0003;';
 const title=document.createElement('strong');title.textContent=`予約画面アシスト：${t.f} ${t.d} ${t.s}〜${t.e}時`;
 const status=document.createElement('div');status.setAttribute('role','status');
 const cancel=document.createElement('button');cancel.type='button';cancel.textContent='自動操作を中止';
 cancel.style.cssText='margin-top:8px;padding:7px 14px;background:white;border:1px solid #666;border-radius:6px;';
 cancel.onclick=()=>{state.paused=true;sessionStorage.removeItem(KEY);status.textContent='中止しました。画面はこのまま手動で操作できます。';};
 panel.append(title,status,cancel);document.body.append(panel);
 const visible=e=>!!e&&!panel.contains(e)&&!e.hidden&&e.getClientRects().length>0;
 const all=selector=>[...document.querySelectorAll(selector)].filter(visible);
 const exact=(selector,name)=>all(selector).filter(e=>normalize(e.textContent)===normalize(name));
 const button=name=>{const found=exact('button',name);if(found.length!==1||found[0].disabled)throw Error(`「${name}」を安全に選択できないため停止しました。`);return found[0];};
 const boxLabel=e=>e.closest('label')||e.parentElement;
 const chosen=e=>e.checked||boxLabel(e).classList.contains('active');
 const disabled=e=>e.disabled||boxLabel(e).classList.contains('disabled');
 function getView(){
  const headings=all('h1,h2,h3').map(e=>normalize(e.textContent));
  const content=normalize(document.body.innerText.replace(panel.innerText,''));
  const heading=s=>headings.includes(normalize(s));
  const boundary=headings.some(s=>/^(申込内容入力|申込内容の入力|申込内容確認|申込内容の確認|申込完了|予約完了)$/.test(s));
  const login=all('input[type="password"]').length>0;
  const error=heading('処理を続行できません。')?'公式サイトのセッションが終了しました。公式サイトのHomeからやり直してください。':content.includes('私はロボットではありません')?'本人による認証が必要なため停止しました。':null;
  const loading=all('[aria-busy="true"],.loading').length>0||all('div,span').some(e=>normalize(e.textContent)==='Loading');
  let stage=heading('施設選択')?'facilities':heading('施設別空き状況')?'days':heading('時間帯別空き状況')?'times':heading('空き照会・申込')?'home':'unknown';
  const boxes=all('input[type="checkbox"]');
  const wanted=boxes.filter(e=>normalize(boxLabel(e).textContent)===normalize(t.f));
  const selected=boxes.filter(chosen);
  const facilitiesReady=wanted.length===1&&chosen(wanted[0])&&selected.every(e=>e===wanted[0]);
  const dates=all('input[type="date"]');
  const dateInput=dates.length===1?dates[0]:null;
  const period=all('input[type="radio"]').find(e=>normalize(boxLabel(e).textContent)==='1日');
  // The gym's date grid has one parent Arena row; halves A/B appear later.
  const dayRoom=halls.includes(t.f)?t.r:'アリーナ';
  const roomRows=all('tr').filter(e=>normalize(e.querySelector('td,th')?.textContent)===normalize(dayRoom));
  const row=roomRows.length===1?roomRows[0]:null;
  const dayBoxes=row?[...row.querySelectorAll('input[type="checkbox"]')].filter(visible):[];
  const day=dayBoxes.length===1?dayBoxes[0]:null;
  const slash=t.d.replaceAll('-','/');
  const gridMatches=!!row&&dayBoxes.length===1&&all('th').some(e=>normalize(e.textContent).includes(slash));
  const timeName=`${t.s}時から${t.e}時まで`;
  // A and B can share identical hours. Match the observed room container first.
  const roomGroups=all('.events-group').filter(e=>{
   const label=e.querySelector('.events-group-title,.events-group-name');
   return label?normalize(label.textContent)===normalize(t.r):normalize(e.textContent).startsWith(normalize(t.r));
  });
  const timeScope=roomGroups.length===1?roomGroups[0]:null;
  const times=timeScope?[...timeScope.querySelectorAll('input[type="checkbox"]')].filter(e=>visible(e)&&normalize(e.getAttribute('aria-label')||boxLabel(e).textContent)===timeName):[];
  const [y,m,d]=t.d.split('-').map(Number);
  const exactTarget=heading(t.f)&&content.includes(normalize(`${y}年${m}月${d}日`))&&content.includes(normalize(t.r));
  return {stage,boundary,login,error,loading,loggedOut:content.includes('現在ログインしていません'),facilitiesReady,date:dateInput?.value,oneDay:!!period?.checked,gridMatches,dayFound:!!row&&!!day,dayUnavailable:day?disabled(day):true,daySelected:day?chosen(day)&&selected.every(e=>e===day):false,exactTarget,timeCount:times.length,timeUnavailable:times.length===1?disabled(times[0]):true,timeSelected:times.length===1?chosen(times[0])&&selected.every(e=>e===times[0]):false,dom:{boxes,wanted,dateInput,period,row,day,time:times[0]}};
 }
 function clickLabel(e){if(!e||disabled(e))throw Error('対象項目を選択できないため停止しました。');boxLabel(e).click();}
 let busy=false,finished=false;
 async function tick(){
  if(state.paused||finished||busy)return;
  busy=true;
  try{
   if(Date.now()-state.createdAt>TTL)throw Error('20分経過したため停止しました。LINEのカードから開き直してください。');
   const jp=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date());
   if(jp<'08:30'||jp>'23:50')throw Error('公式サイトの照会時間外のため停止しました。');
   const v=getView(),a=plan(v,t);status.textContent=a.message;
   if(a.type==='done'||a.type==='stop'){finished=true;sessionStorage.removeItem(KEY);cancel.textContent='閉じる';cancel.onclick=()=>panel.remove();return;}
   if(a.type==='wait'){
    // A login modal can interrupt Next on the time page. Once the person has
    // logged in, permit that same non-final Next action to resume once.
    if(v.login&&state.lastAction){state.lastAction=null;sessionStorage.setItem(KEY,JSON.stringify(state));}
    return;
   }
   const actionKey=location.pathname+'|'+v.stage+'|'+a.type;
   if(state.lastAction===actionKey){if(Date.now()-state.lastActionAt>15000)throw Error('画面の進行を確認できず停止しました。手動で状態を確認してください。');return;}
   state.lastAction=actionKey;state.lastActionAt=Date.now();sessionStorage.setItem(KEY,JSON.stringify(state));
   switch(a.type){
    case 'login':{const b=exact('button','ログイン').filter(e=>!e.disabled);if(!b.length)throw Error('ログインボタンを確認できません。');b[0].click();break;}
    case 'category':button(halls.includes(t.f)?'公民館':'市民体育館').click();break;
    case 'facility':{
     if(v.dom.wanted.length!==1)throw Error('対象施設を一意に確認できません。');
     for(const e of v.dom.boxes)if(chosen(e)&&e!==v.dom.wanted[0])clickLabel(e);
     if(!chosen(v.dom.wanted[0]))clickLabel(v.dom.wanted[0]);break;
    }
    case 'date':{
     if(!v.dom.dateInput)throw Error('表示期間の入力欄を確認できません。');
     const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
     setter.call(v.dom.dateInput,t.d);v.dom.dateInput.dispatchEvent(new Event('input',{bubbles:true}));v.dom.dateInput.dispatchEvent(new Event('change',{bubbles:true}));break;
    }
    case 'period':if(!v.dom.period)throw Error('1日表示を確認できません。');boxLabel(v.dom.period).click();break;
    case 'display':button('表示').click();break;
    case 'day':
    case 'time':{
     const target=a.type==='day'?v.dom.day:v.dom.time;
     for(const e of v.dom.boxes)if(chosen(e)&&e!==target)clickLabel(e);
     if(!chosen(target))clickLabel(target);break;
    }
    case 'next':if(!['facilities','days','times'].includes(v.stage))throw Error('許可されていない画面遷移です。');button('次へ進む').click();break;
    default:throw Error('不明な操作のため停止しました。');
   }
  }catch(e){finished=true;sessionStorage.removeItem(KEY);status.textContent=String(e.message);}
  finally{busy=false;}
 }
 // Only normal visible UI actions. No fetch/XHR, account data, or final submit.
 setInterval(tick,700);tick();
})();
