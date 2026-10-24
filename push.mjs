export function notifier({topic,fetcher=fetch}){
 if(!/^ageo-[a-f\d]{32,64}$/.test(topic??''))throw Error('STRONG_PRIVATE_TOPIC_REQUIRED');
 const base='https://ntfy.sh/'+topic;
 async function recent(){
  const response=await fetcher(base+'/json?poll=1&since=12h',{signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error('NTFY_READ_HTTP_'+response.status);
  if(response.headers.get('X-Messages-Truncated')==='1')throw Error('NTFY_HISTORY_TRUNCATED');
  return (await response.text()).split('\n').filter(Boolean).map(x=>JSON.parse(x)).filter(x=>x.event==='message');
 }
 return {
  async find(item){return (await recent()).find(x=>x.title===item.title&&x.message===item.message)??null;},
  async send(item){
   if(Buffer.byteLength(item.message,'utf8')>3500)throw Error('NOTIFICATION_TOO_LONG');
   const response=await fetcher('https://ntfy.sh/',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({topic,title:item.title,message:item.message,click:'https://www.pf-yoyaku.com/User/ageo/Home',priority:3}),signal:AbortSignal.timeout(30000)});
   if(!response.ok)throw Object.assign(Error('NTFY_HTTP_'+response.status),{definitelyRejected:response.status>=400&&response.status<500});
   const receipt=await response.json();
   if(!receipt.id||receipt.event!=='message'||receipt.topic!==topic)throw Error('NTFY_RECEIPT_INVALID');
   return {id:receipt.id,accepted:true};
  }
 };
}
