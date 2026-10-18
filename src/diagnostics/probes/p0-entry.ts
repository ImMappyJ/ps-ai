import {PhotoshopAdapter} from '../../infrastructure/photoshop/photoshop';import {runHostProbe} from '../p0-host';import {uuid} from '../../infrastructure/backends/client';
declare const require:(name:string)=>any;
const ps=require('photoshop'),uxp=require('uxp');
uxp.entrypoints.setup({panels:{p0:{show(){}}}});
async function main() {
  let report:unknown;const trace:string[]=[];
  try {report=await runHostProbe(ps,new PhotoshopAdapter(ps,uuid()),trace);}
  catch(error){report={passed:false,error:error instanceof Error?error.message:String(error),stack:error instanceof Error?error.stack:undefined,date:new Date().toISOString(),trace};}
  const root=await uxp.storage.localFileSystem.getDataFolder();const file=await root.createFile('p0-host-report.json',{overwrite:true});
  await file.write(JSON.stringify(report,null,2));
  const out=document.getElementById('report');if(out)out.textContent=JSON.stringify(report,null,2);
  console.log('PS-AI P0 REPORT',file.nativePath,JSON.stringify(report));
}
void main();
