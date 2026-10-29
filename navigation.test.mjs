import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {lineMessages} from './line-push.mjs';
const source=fs.readFileSync(new URL('./ageo-reservation-assist.user.js',import.meta.url),'utf8');
const context={module:{exports:{}},Date,encodeURIComponent,decodeURIComponent};vm.runInNewContext(source,context);
const {validate,link,fromHash,plan}=context.module.exports;
const target={v:1,f:'平方公民館',r:'集会室兼体育室',d:'2026-10-31',s:9,e:12};
const view={stage:'days',date:target.d,oneDay:true,gridMatches:true,dayFound:true,dayUnavailable:false,daySelected:false};
test('navigation link carries only slot data in fragment and opens external browser',()=>{
 const u=new URL(link(target));assert.equal(u.origin,'https://www.pf-yoyaku.com');assert.equal(u.searchParams.get('openExternalBrowser'),'1');assert.equal(u.searchParams.has('password'),false);assert.equal(JSON.stringify(fromHash(u.hash)),JSON.stringify(target));assert.ok(u.href.length<1000);
});
test('other facilities, rooms, invalid dates and time ranges are rejected',()=>{
 for(const change of [{f:'別の施設'},{r:'会議室'},{d:'2026-02-31'},{s:8},{e:23},{s:12,e:12}])assert.throws(()=>validate({...target,...change}));
});
test('login is a manual wait without navigation actions',()=>assert.equal(plan({stage:'home',login:true},target).type,'wait'));
test('home opens login first when logged out',()=>assert.equal(plan({stage:'home',loggedOut:true},target).type,'login'));
test('application input and confirmation boundaries stop even with Next present',()=>{
 for(const stage of ['home','days','times'])assert.equal(plan({stage,boundary:true,timeSelected:true,timeCount:1,exactTarget:true},target).type,'done');
});
test('session errors stop instead of retrying or treating as no vacancy',()=>assert.equal(plan({...view,error:'セッション終了'},target).type,'stop'));
test('date, period and grid are verified before choosing the day',()=>{
 assert.equal(plan({...view,date:'2026-10-30'},target).type,'date');assert.equal(plan({...view,oneDay:false},target).type,'period');assert.equal(plan({...view,gridMatches:false},target).type,'display');assert.equal(plan(view,target).type,'day');
});
test('unavailable or missing day never proceeds',()=>{
 assert.equal(plan({...view,dayUnavailable:true},target).type,'stop');assert.equal(plan({...view,dayFound:false},target).type,'stop');
});
test('exact selected date proceeds once to time page',()=>assert.equal(plan({...view,daySelected:true},target).type,'next'));
test('different target or ambiguous time selection stops',()=>{
 const v={stage:'times',exactTarget:true,timeCount:1,timeUnavailable:false,timeSelected:false};assert.equal(plan(v,target).type,'time');assert.equal(plan({...v,exactTarget:false},target).type,'stop');assert.equal(plan({...v,timeCount:2},target).type,'stop');assert.equal(plan({...v,timeUnavailable:true},target).type,'stop');assert.equal(plan({...v,timeSelected:true},target).type,'next');
});
test('unrecognized pages never click any final reservation control',()=>assert.equal(plan({stage:'confirmation'},target).type,'stop'));
test('LINE assist button carries the same target while ordinary cards stay unchanged',()=>{
 const item={title:'空き',message:'候補',plan:{slots:[{facility:target.f,room:target.r,date:target.d,start:target.s,end:target.e}]}};
 const old=lineMessages(item)[1].contents.footer.contents[0].action;
 const assisted=lineMessages(item,{navigationAssist:true})[1].contents.footer.contents[0].action;
 assert.equal(new URL(old.uri).hash,'');assert.equal(JSON.stringify(fromHash(new URL(assisted.uri).hash)),JSON.stringify(target));
});


test('official grid dates accept unpadded month/day without matching a different day',()=>{
 const matches=context.module.exports.gridDateMatches;
 for(const value of ['2026/11/3(火)～','2026/11/03','2026年11月3日','2026/1/3'])assert.equal(matches(value,value.includes('/1/')?'2026-01-03':'2026-11-03'),true);
 for(const value of ['2026/11/13','2026/11/30','2026/12/3'])assert.equal(matches(value,'2026-11-03'),false);
});
