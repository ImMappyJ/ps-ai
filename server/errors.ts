export class ServiceError extends Error {
  constructor(public status:number,public code:string,message:string,public outcomeUnknown=false){super(message);this.name='ServiceError';}
}
// Provider error text can contain private prompts, URLs or credentials. Never echo it.
export function platformCode(value:unknown):string {
  return typeof value==='string'&&['InvalidApiKey','InvalidParameter','DataInspectionFailed','InternalError','Throttling','Throttling.RateQuota','ModelNotFound','AccessDenied'].includes(value)?value:'ProviderError';
}
