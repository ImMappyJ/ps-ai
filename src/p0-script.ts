import {PhotoshopAdapter} from './photoshop';import {runHostProbe} from './p0-host';import {uuid} from './client';
declare const require:(name:string)=>any;
export async function main():Promise<void> {
  const ps=require('photoshop'),uxp=require('uxp');let report:Record<string,unknown>;const trace:string[]=[];const initialDocumentCount=ps.app.documents.length;
  try{report=await runHostProbe(ps,new PhotoshopAdapter(ps,uuid()),trace);}
  catch(error){report={passed:false,error:error instanceof Error?error.message:String(error),stack:error instanceof Error?error.stack:undefined,date:new Date().toISOString(),trace};}
  report.initialDocumentCount=initialDocumentCount;report.finalDocumentCount=ps.app.documents.length;if(initialDocumentCount!==ps.app.documents.length){report.passed=false;report.error='Probe leaked or closed a pre-existing document';}
  const folder=await uxp.storage.localFileSystem.getTemporaryFolder();const file=await folder.createFile('ps-ai-p0-script-report.json',{overwrite:true});await file.write(JSON.stringify(report,null,2));
  console.log('PS-AI P0 SCRIPT',file.nativePath,JSON.stringify(report));
  await ps.core.showAlert(JSON.stringify(report,null,2)+'\n报告：'+file.nativePath);
}
