import {hmac} from '@noble/hashes/hmac.js';import {sha256} from '@noble/hashes/sha2.js';
// Browser/UXP-safe HMAC; no WebCrypto or Node runtime requirement.
const ascii=(value:string)=>Uint8Array.from(value,c=>c.charCodeAt(0));
export function relayProof(token:string,provider:string,nonce:string):string{return Array.from(hmac(sha256,ascii(token),ascii(`ps-ai-relay/1:server:${provider}:${nonce}`)),b=>b.toString(16).padStart(2,'0')).join('');}
