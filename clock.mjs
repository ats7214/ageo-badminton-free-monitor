export function jst(now=new Date()) {
 const iso=new Date(now.getTime()+9*3600000).toISOString();
 return {date:iso.slice(0,10),time:iso.slice(11,16),hour:iso.slice(11,13)};
}
export const inHours=now=>{const t=jst(now).time;return t>='08:30'&&t<='23:50';};
export function periods(now=new Date()) {
 const {date}=jst(now),[y,m]=date.split('-').map(Number);
 return {starts:[date,...[1,2].map(n=>new Date(Date.UTC(y,m-1+n,1)).toISOString().slice(0,10))],end:new Date(Date.UTC(y,m+2,0)).toISOString().slice(0,10)};
}
