import {ComfyClient,HttpError} from './client';import type {Status} from './client';import type {Graph} from './workflow';
export interface JobRecord {id:string;clientId:string;state:string;graph:Graph;createdAt:string;detail?:string;[key:string]:unknown}
export interface JobStore {save(record:JobRecord):Promise<void>}
export const PENDING_STATES=['submitting','queued','running','unknown','cancelling'];
export class JobCoordinator {
  constructor(private client:ComfyClient,private store:JobStore){}
  async submit(record:JobRecord):Promise<void> {
    record.state='submitting';await this.store.save(record);
    try {await this.client.submit(record.graph,record.id,record.clientId);record.state='queued';}
    catch(error) {
      record.state=error instanceof HttpError&&error.status>=400&&error.status<500?'failed':'unknown';
      record.detail=error instanceof Error?error.message:String(error);
    }
    await this.store.save(record);
  }
  async cancel(record:JobRecord):Promise<Status> {
    record.state='cancelling';await this.store.save(record);
    const acknowledged=await this.client.cancel(record.id);
    let status=await this.client.status(record.id);
    if(status.state==='ready'){record.state='ready';record.outputs=status.images;}
    else if(status.state==='failed'||status.state==='cancelled')record.state=status.state;
    else if(acknowledged&&status.state==='unknown'){record.state='cancelled';status={state:'cancelled'};}
    else {record.state=acknowledged?'cancelling':status.state;record.detail=acknowledged?'已发送指定任务取消，等待终态':'取消未确认；继续保留原任务 ID';}
    await this.store.save(record);return status;
  }
}
