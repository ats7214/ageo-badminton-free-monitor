import {seal,unseal} from './vault.mjs';

export class GithubStore {
 constructor({repo,token,secret,fetcher=fetch,branch='monitor-state'}){
  if(!/^[\w.-]+\/[\w.-]+$/.test(repo??'')||!token)throw Error('GITHUB_CONFIGURATION_REQUIRED');
  Object.assign(this,{repo,token,secret,fetcher,branch,sha:null});
 }
 async request(url,options={}){
  const response=await this.fetcher('https://api.github.com/repos/'+this.repo+url,{
   ...options,headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+this.token,'X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'},signal:AbortSignal.timeout(30000)});
  if(response.status===404)return null;
  if(!response.ok)throw Error('GITHUB_HTTP_'+response.status);
  return response.json();
 }
 async open(){
  const repo=await this.request('');
  // Refuse private repositories so execution cannot consume a billed allowance.
  if(!repo||repo.visibility!=='public'||repo.archived)throw Error('FREE_PUBLIC_REPOSITORY_REQUIRED');
  if(!await this.request('/git/ref/heads/'+this.branch)){
   const base=await this.request('/git/ref/heads/'+repo.default_branch);
   if(!base?.object?.sha)throw Error('DEFAULT_BRANCH_REQUIRED');
   await this.request('/git/refs',{method:'POST',body:JSON.stringify({ref:'refs/heads/'+this.branch,sha:base.object.sha})});
  }
  return this;
 }
 async load(){
  const file=await this.request('/contents/state.enc.json?ref='+this.branch);
  if(!file){this.sha=null;return null;}
  this.sha=file.sha;
  return unseal(JSON.parse(Buffer.from(file.content,'base64').toString('utf8')),this.secret);
 }
 async save(value){
  const content=Buffer.from(JSON.stringify(seal(value,this.secret))).toString('base64');
  const body={message:'Update encrypted monitoring state',content,branch:this.branch,...(this.sha?{sha:this.sha}:{})};
  const saved=await this.request('/contents/state.enc.json',{method:'PUT',body:JSON.stringify(body)});
  if(!saved?.content?.sha)throw Error('STATE_SAVE_NOT_CONFIRMED');
  this.sha=saved.content.sha;
 }
}
