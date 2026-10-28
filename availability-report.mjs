import {relayReservationUrl,availabilityLabel} from './slot-links.mjs';
const short=f=>f.includes('市民体育館')?'上尾市民体育館':f;
export function availabilityReport(slots,{observedAt,coverage=[],testMode=false}={}){
 const clock=new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(observedAt));
 const groups=new Map();
 for(const c of coverage){if(c.complete!==true)throw Error('INCOMPLETE_REPORT');if(!groups.has(c.facility))groups.set(c.facility,[]);}
 for(const s of slots){if(!groups.has(s.facility))groups.set(s.facility,[]);groups.get(s.facility).push(s);}
 const bubbles=[];
 for(const [facility,items] of groups){
  items.sort((a,b)=>a.date.localeCompare(b.date)||a.start-b.start||a.room.localeCompare(b.room));
  const rows=items.map(s=>{const date=new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',weekday:'short'}).format(new Date(s.date+'T00:00:00+09:00'));const room=/市民体育館/.test(facility)?' '+s.room:'';return {type:'text',text:`${s.isNew===true?'🆕 ':''}${availabilityLabel(s).split(' ')[0]} ${date} ${s.start}〜${s.end}時${room}`,size:'sm',wrap:true,color:'#08783E',action:{type:'uri',label:'この枠の申込画面へ',uri:relayReservationUrl(s)}};});
  if(!rows.length)rows.push({type:'text',text:'条件に合う空き枠なし',size:'sm',wrap:true});
  let part=[];const parts=[];
  for(const row of rows){if(Buffer.byteLength(JSON.stringify([...part,row]),'utf8')>23000&&part.length){parts.push(part);part=[];}part.push(row);}if(part.length)parts.push(part);
  for(let i=0;i<parts.length;i++)bubbles.push({type:'bubble',size:'mega',body:{type:'box',layout:'vertical',spacing:'md',contents:[{type:'text',text:short(facility)+(parts.length>1?` (${i+1}/${parts.length})`:''),weight:'bold',size:'lg',wrap:true},{type:'text',text:`条件に合う空き ${items.length}枠`,size:'sm',wrap:true},{type:'text',text:`確認：${clock} 日本時間`,size:'xs',color:'#666666',wrap:true},...parts[i]]}});
 }
 const carousels=[];let chunk=[];
 for(const bubble of bubbles){if((chunk.length>=12||Buffer.byteLength(JSON.stringify([...chunk,bubble]),'utf8')>45000)&&chunk.length){carousels.push(chunk);chunk=[];}chunk.push(bubble);}if(chunk.length)carousels.push(chunk);
 if(carousels.length>4)throw Error('COMPLETE_REPORT_EXCEEDS_SINGLE_PUSH');
 const messages=[{type:'text',text:`【施設別・全件一覧${testMode?'の試験通知':''}】\n確認：${clock} 日本時間\n条件に合う空き枠：全${slots.length}枠（新規${slots.filter(s=>s.isNew===true).length}枠）\n平日18時以降／土日祝は全時間帯。新規・継続の両方を掲載しています。\n施設ごとのカードに日時をすべて載せています。日時をタップすると、その枠の予約画面アシストへ進みます。\n確認後に空きが変わる場合があります。予約はしていません。`}];
 for(let i=0;i<carousels.length;i++)messages.push({type:'flex',altText:`施設別の空き全${slots.length}枠 (${i+1}/${carousels.length})`,contents:{type:'carousel',contents:carousels[i]}});
 return messages;
}
