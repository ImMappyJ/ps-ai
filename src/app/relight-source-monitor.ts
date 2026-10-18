/** Adobe's documented action event names. Notifications only invalidate; never read pixels here. */
const SOURCE_EVENTS=['open','close','select','set','make','delete','move','canvasSize','imageSize','convertMode','crop','undoEvent'];
interface NotificationAction {
  addNotificationListener?(events:string[],callback:()=>void):Promise<void>|void;
  removeNotificationListener?(events:string[],callback:()=>void):Promise<void>|void;
}

/** One workbench-owned subscription with bounded coalescing and async-registration cleanup. */
export function observeRelightSource(action:NotificationAction,invalidate:()=>void,report:(message:string)=>void):()=>void {
  let disposed=false,registered=false,removed=false,timer:ReturnType<typeof setTimeout>|undefined;
  const events=[...SOURCE_EVENTS];
  const callback=()=>{
    if(disposed||timer!==undefined)return;
    timer=setTimeout(()=>{timer=undefined;if(!disposed)invalidate();},0);
  };
  const remove=()=>{
    if(!registered||removed)return;removed=true;
    try{Promise.resolve(action.removeNotificationListener!(events,callback)).catch(()=>report('来源通知监听器清理失败；关闭并重新加载插件后重试'));}
    catch{report('来源通知监听器清理失败；关闭并重新加载插件后重试');}
  };
  if(typeof action.addNotificationListener!=='function'||typeof action.removeNotificationListener!=='function')report('宿主来源通知不可用；将于重开、重新读取、提交和应用时核对来源');
  else{
    try{Promise.resolve(action.addNotificationListener(events,callback)).then(()=>{registered=true;if(disposed)remove();},()=>{if(!disposed)report('来源通知注册失败；将于重开、重新读取、提交和应用时核对来源');});}
    catch{report('来源通知注册失败；将于重开、重新读取、提交和应用时核对来源');}
  }
  return ()=>{if(disposed)return;disposed=true;if(timer!==undefined){clearTimeout(timer);timer=undefined;}remove();};
}
