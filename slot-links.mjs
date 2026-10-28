import crypto from 'node:crypto';
export const RESERVATION_URL='https://www.pf-yoyaku.com/User/ageo/Home';
export function availabilityLabel(s){
 const icon=String(s.availabilityIcon??'').split('#')[1];
 if(icon==='circle')return '○ 空きあり';
 if(icon==='triangle')return '△ 施設に問い合わせ';
 if(icon==='cross')return '× 空きなし';
 return '記号未確認（公式画面で確認）';
}
export function assistedReservationUrl(s){
 const target={v:1,f:s.facility,r:s.room,d:s.date,s:s.start,e:s.end};
 return RESERVATION_URL+'?openExternalBrowser=1#ageo-slot='+encodeURIComponent(JSON.stringify(target));
}
export function relayReservationUrl(s){
 const target={v:1,f:s.facility,r:s.room,d:s.date,s:s.start,e:s.end};
 const id=crypto.createHash('sha256').update(JSON.stringify(target)).digest('hex').slice(0,16);
 return 'https://ats7214.github.io/ageo-badminton-free-monitor/?slot='+id+'#'+encodeURIComponent(JSON.stringify(target));
}
