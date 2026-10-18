export class ServiceError extends Error {
  constructor(public status:number,public code:string,message:string,public outcomeUnknown=false){super(message);this.name='ServiceError';}
}
export type PublicFailureCode='unauthorized'|'rate-limited'|'quota-exceeded'|'timeout'|'unreachable'|'unsupported'|'invalid-output'|'image-budget'|'incompatible-api'|'cancelled';
/** Only adapter-owned structured codes can establish an actionable cause. */
export function publicFailureCode(code:unknown):PublicFailureCode|undefined {
  const codes:Record<string,PublicFailureCode>={authentication:'unauthorized',unauthorized:'unauthorized','rate-limit':'rate-limited','rate-limited':'rate-limited','quota-exceeded':'quota-exceeded',timeout:'timeout',connection:'unreachable',unreachable:'unreachable','invalid-input':'unsupported',unsupported:'unsupported','invalid-output':'invalid-output','image-budget':'image-budget','incompatible-api':'incompatible-api',cancelled:'cancelled'};
  return typeof code==='string'&&Object.prototype.hasOwnProperty.call(codes,code)?codes[code]:undefined;
}
// Provider error text can contain private prompts, URLs or credentials. Never echo it.
export function platformCode(value:unknown):string {
  return typeof value==='string'&&['InvalidApiKey','InvalidParameter','DataInspectionFailed','InternalError','Throttling','Throttling.RateQuota','ModelNotFound','AccessDenied'].includes(value)?value:'ProviderError';
}
