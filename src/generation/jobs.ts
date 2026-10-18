import {HttpError} from '../infrastructure/backends/client';import type {Status} from '../infrastructure/backends/client';import type {Graph} from './workflow';
import type {GenerationRequest} from '../infrastructure/backends/gateway-protocol';
export interface JobRecord {id:string;clientId:string;state:string;graph:Graph;createdAt:string;detail?:string;request?:GenerationRequest;backend?:'comfyui'|'gateway';tracking?:'detached';sourceName?:string;[key:string]:unknown}
export interface JobTransport {submitJob(record:JobRecord):Promise<string>;status(id:string):Promise<Status>;cancel(id:string):Promise<boolean>}
export interface JobStore {save(record:JobRecord):Promise<void>}
export const PENDING_STATES=['submitting','queued','running','unknown','cancelling'];
/** Detaching is a local choice for unknown outcomes; it never changes remote state. */
export function blocksGeneration(record:JobRecord):boolean {return PENDING_STATES.includes(record.state)&&!(record.state==='unknown'&&record.tracking==='detached');}
export class JobCoordinator {
  constructor(private client:JobTransport,private store:JobStore){}
  async submit(record:JobRecord):Promise<void> {
    record.state='submitting';await this.store.save(record);
    try {await this.client.submitJob(record);record.state='queued';}
    catch(error) {
      record.state=error instanceof HttpError&&error.status>=400&&error.status<500?'failed':'unknown';
      record.detail=error instanceof Error?error.message:String(error);
    }
    await this.store.save(record);
  }
  async cancel(record:JobRecord):Promise<Status> {
    record.state='cancelling';await this.store.save(record);
    let acknowledged:boolean,status:Status;
    try {
      acknowledged=await this.client.cancel(record.id);
      status=await this.client.status(record.id);
    }catch(error){
      // Transport failure proves neither cancellation nor a terminal remote state.
      record.state='unknown';await this.store.save(record);throw error;
    }
    if(status.state==='ready'){record.state='ready';record.outputs=status.images;}
    else if(status.state==='failed'||status.state==='cancelled')record.state=status.state;
    else if(acknowledged&&status.state==='unknown'){record.state='cancelled';status={state:'cancelled'};}
    else {record.state=acknowledged?'cancelling':status.state;record.detail=record.backend==='gateway'&&!acknowledged?'后续候选已停止；当前平台任务继续，完成后保留结果':acknowledged?'已发送指定任务取消，等待终态':'取消未确认；继续保留原任务 ID';}
    await this.store.save(record);return status;
  }
}
