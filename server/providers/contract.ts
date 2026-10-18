import type {GatewayCapabilities,GenerationRequest} from '../../src/infrastructure/backends/gateway-protocol';

export type ProviderStatus={state:'queued'|'running'|'ready'|'failed'|'cancelled'|'unknown';imageUrl?:string;detail?:string};
export type ProviderSubmission={taskId:string}|{image:Uint8Array};
// Task APIs have a durable remote identity; inline APIs do not. Never invent one.
export interface ImageProvider {
  readonly id?:string;
  readonly execution?:'task'|'inline';
  readonly baseUrl:string;
  readonly configured:boolean;
  capabilities():GatewayCapabilities;
  submit(request:GenerationRequest,images:Uint8Array[]):Promise<ProviderSubmission>;
  poll?(taskId:string):Promise<ProviderStatus>;
  download?(url:string):Promise<Uint8Array>;
  normalizeOutput?(bytes:Uint8Array,request:GenerationRequest,assumeSrgb?:boolean):Uint8Array;
}
