import crypto from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';

function key(value){if(!/^[a-f\d]{64}$/i.test(value??''))throw Error('INVALID_STATE_KEY');return Buffer.from(value,'hex');}
export function seal(value,secret){
 const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key(secret),iv);
 cipher.setAAD(Buffer.from('ageo-free-monitor:v1'));
 const body=Buffer.concat([cipher.update(gzipSync(Buffer.from(JSON.stringify(value)))),cipher.final()]);
 return {version:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),body:body.toString('base64')};
}
export function unseal(value,secret){
 if(value.version!==1)throw Error('UNSUPPORTED_STATE_VERSION');
 const decipher=crypto.createDecipheriv('aes-256-gcm',key(secret),Buffer.from(value.iv,'base64'));
 decipher.setAAD(Buffer.from('ageo-free-monitor:v1'));decipher.setAuthTag(Buffer.from(value.tag,'base64'));
 const bytes=Buffer.concat([decipher.update(Buffer.from(value.body,'base64')),decipher.final()]);
 return JSON.parse(gunzipSync(bytes).toString('utf8'));
}
