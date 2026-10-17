import type {Server} from 'node:http';

// Some Windows dynamic ranges include Fetch-forbidden ports (for example 6000).
// Probe the actual Fetch policy, retaining OS allocation and valid low ports.
export async function listenLoopback(server:Server):Promise<void>{
  for(let attempt=0;attempt<32;attempt++){
    await new Promise<void>((resolve,reject)=>{
      server.once('error',reject);
      server.listen(0,'127.0.0.1',()=>{server.off('error',reject);resolve();});
    });
    try{
      const probe=await fetch(`http://127.0.0.1:${(server.address() as {port:number}).port}/__test_port_probe__`,{method:'HEAD'});
      await probe.body?.cancel();return;
    }catch(error){
      await new Promise<void>((resolve,reject)=>server.close(cause=>cause?reject(cause):resolve()));
      if((error as {cause?:{message?:string}}).cause?.message!=='bad port')throw error;
    }
  }
  throw new Error('Unable to allocate a Fetch-compatible loopback test port');
}
