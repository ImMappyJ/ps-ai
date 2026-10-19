import {ColorContractError} from '../imaging/color';
import {t,english,errorText} from '../localization/i18n';
import {BUILD_ID} from './build';
import {RelightExtractionError} from '../features/relight/relight-layers';
export type DiagnosticCode='unreachable'|'missing-node'|'missing-model'|'incompatible-api'|'resource-exhausted'|'timeout'|'invalid-output'|'relight-extraction'|'apply-failed'|'source-profile'|'selection-required'|'pending-task'|'pending-backend'|'no-document'|'empty-range'|'source-unavailable'|'source-changed'|'unauthorized'|'rate-limited'|'quota-exceeded'|'cancelled'|'unsupported'|'image-budget'|'decode-failed'|'host-busy'|'clipboard-failed'|'unknown';
export type Stage='connection'|'environment'|'capture'|'inference'|'output'|'lighting-extraction'|'apply';
export class DiagnosticError extends Error {
  constructor(public code:DiagnosticCode,public stage:Stage,message:string){super(message);this.name='DiagnosticError';}
}
export function backendFailureCode(messages:unknown):DiagnosticCode {
  if(!Array.isArray(messages))return 'unknown';
  return messages.some(m=>Array.isArray(m)&&m[0]==='execution_error'&&(
    /(^|\.)(OutOfMemoryError|OOMError)$/.test(String(m[1]?.exception_type??''))||
    /\b(CUDA|HIP|MPS) out of memory\b/i.test(String(m[1]?.exception_message??''))
  ))?'resource-exhausted':'unknown';
}
const guidance:Record<DiagnosticCode,[string,string]>={
  'unreachable':['无法连接后端','确认 ComfyUI 已启动，核对地址、端口和防火墙后重新检查。'],
  'missing-node':['后端缺少节点','按技术详情补齐对应节点；检查完成前不会提交生成。'],
  'missing-model':['后端缺少模型','扫描模型并选择对应架构的实际文件，再重新检查。'],
  'incompatible-api':['接口或模板不兼容','核对配置指南中的 ComfyUI、节点版本与固定模板；不要盲目更新。'],
  'resource-exhausted':['后端报告内存不足','先在 ComfyUI 确认本任务已结束，再降低分辨率或减少并发。'],
  'timeout':['请求超时','确认后端状态；已提交任务请按原 ID 恢复，避免重复生成。'],
  'invalid-output':['候选输出不符合约定','检查尺寸、PNG 位深与 sRGB 配置。已下载文件保留；未下载的候选可按原任务 ID 恢复。'],
  'relight-extraction':['本地光影提取已停止','检查原始 AI 参考图与来源在作用范围内的结构、文字和纹理；参考图仅供检查与导出，不能作为光影层回填。'],
  'apply-failed':['Photoshop 应用失败','候选仍可另存或新建文档；确认来源文档状态，必要时重新捕获。'],
  'source-profile':['无法确定来源色彩空间','若显示色彩恢复按钮，可明确创建本次会话已验证的色彩副本并重新读取。没有可验证记录时，请在副本中指定正确配置文件，再重新捕获；已有候选仍可导出。'],
  'selection-required':['需要编辑选区','撤销可能移除了选区。请在 Photoshop 重新圈选，或在原模式点击“恢复上次选区并重新读取”后检查预览。背景与场景模式请选择要保留的主体；光影重塑也可明确选择“整张图像”后重新读取原图。'],
  'pending-task':['存在未确认任务','打开历史，核对完整任务 ID 和原后端后恢复或取消；未知任务也可明确停止本地跟踪。'],
  'pending-backend':['任务后端与当前配置不同','在设置中切回历史详情中的后端类型和地址，再恢复或取消所选任务。'],
  'no-document':['未打开 Photoshop 文档','先打开要编辑的文档，再重新读取来源。'],
  'empty-range':['编辑范围没有有效像素','检查选区和保护区，让实际编辑范围包含可修改的像素。'],
  'source-unavailable':['来源已失效','重新读取正确的来源文档；已有候选仍可查看或导出。'],
  'source-changed':['来源已改变','重新读取当前来源后再生成；已有候选仍可查看或导出。'],
  'unauthorized':['后端认证失败','检查当前平台的 API Key 和账户权限，再重新连接。'],
  'rate-limited':['后端请求受到限流','稍后按原任务 ID 检查状态；不要重复提交已有任务。'],
  'quota-exceeded':['平台额度或配额不足','检查当前账户的额度和配额；保留原任务 ID，避免重复生成。'],
  'cancelled':['任务已取消','已有候选仍可查看或导出；需要时明确发起新任务。'],
  'unsupported':['当前设置不受支持','调整当前模式、参数或输出格式，再重新检查。'],
  'image-budget':['图像超过处理预算','缩小编辑范围或降低分析分辨率，再重新读取。'],
  'decode-failed':['无法读取图像数据','检查图像格式和完整性；已保存的原始输出仍保留。'],
  'host-busy':['Photoshop 正忙','结束当前 Photoshop 操作或对话框后重试。'],
  'clipboard-failed':['技术详情复制失败','检查剪贴板权限，或导出脱敏诊断报告。'],
  'unknown':['操作未完成','查看技术详情核对原因；保留任务 ID 和候选后再操作。']
};
/** Bounded, content-free diagnostics can leave the plugin through Copy / Export. */
export function redactDiagnostic(value:string):string {
  return value.slice(0,12000)
    .replace(/data:[^\s,]*;base64,[a-z0-9+/=]+/gi,'[image data omitted]')
    .replace(/\b(?:prompt|private[_ -]?prompt)\s*[:=]\s*[^\r\n]+/gi,'prompt: [redacted]')
    .replace(/\bBearer\s+[^\s,;"']+/gi,'Bearer [redacted]')
    .replace(/\b(?:sk|sk-proj)-[a-z0-9_-]+/gi,'[redacted key]')
    .replace(/((?:api[-_ ]?key|authorization|access[_-]?token|token|secret|password|signature|prompt|image)\s*["']?\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;]+)/gi,'$1[redacted]')
    .replace(/https?:\/\/[^\s<>"']+/gi,url=>url.replace(/(https?:\/\/)[^/@\s]+@/i,'$1[redacted]@').replace(/[?#].*$/,'?[redacted]'))
    .replace(/\b[a-z]:[\\/][^\r\n"<>|]*/gi,'[private path]')
    .replace(/\/(?:Users|home|private|tmp|var|mnt)\/[^\s"<>]*/g,'[private path]')
    .replace(/[a-z0-9+/=]{512,}/gi,'[binary data omitted]');
}
const legacy:Partial<Record<DiagnosticCode,string[]>>={
  'no-document':['请先打开 Photoshop 文档','请先打开 Photoshop 文档并建立选区'],
  'empty-range':['编辑范围完全被保护区覆盖','选区上下文没有可读取的像素'],
  'source-unavailable':['来源文档已关闭，候选已保留','来源会话已结束，请重新捕获；候选仍可另存或新建文档'],
  'source-changed':['来源文档尺寸、颜色或内容状态已改变，请重新捕获','活动文档已切换，请在来源文档重新生成','保护区来源文档已改变，请重新指定','保护区来源文档已切换'],
  'unsupported':['支持 RGB / 灰度 8/16-bit；其他模式请先在副本中转换为 RGB，原文档不会自动转换','不支持的工作区或模式','此平台模型不支持当前模式'],
  'image-budget':['区域须为有效尺寸且不超过 1600 万像素'],
  'decode-failed':['需要有效 PNG 图片','RGBA 缓冲区尺寸错误']
};
export function diagnostic(error:unknown,stage:Stage,hasPending=false,context:{mode?:string;selectionScope?:string}={}){
  // Reconstruct only known enums and bounded aggregates. Error messages/causes
  // may contain host or provider content and are unnecessary for this failure.
  const extraction=error instanceof RelightExtractionError&&(error.reason==='structure-mismatch'||error.reason==='unsupported-boundary')?new RelightExtractionError(error.reason,error.metrics):undefined;
  const ordinaryError=error instanceof Error||Object.prototype.toString.call(error)==='[object Error]';
  const message=extraction?.message??(ordinaryError&&typeof (error as Error).message==='string'?(error as Error).message:undefined);
  const selectionMissing=stage==='capture'&&['请先建立编辑选区','选区为空'].some(key=>message===key||message===english[key]);
  const suppliedCode=ordinaryError?(error as Error&{code?:DiagnosticCode}).code:undefined;
  const explicit=error instanceof DiagnosticError||error instanceof ColorContractError?error.code:suppliedCode&&guidance[suppliedCode]?suppliedCode:undefined;
  const normalized=message?Object.entries(legacy).find(([,messages])=>messages!.some(key=>message===key||message===english[key]))?.[0] as DiagnosticCode|undefined:undefined;
  const httpStatus=ordinaryError?(error as Error&{status?:number}).status:undefined;
  const httpCode=httpStatus===401||httpStatus===403?'unauthorized':httpStatus===429?'rate-limited':httpStatus===413?'image-budget':undefined;
  const code:DiagnosticCode=explicit&&guidance[explicit]?explicit:normalized??httpCode??(selectionMissing?'selection-required':stage==='apply'?'apply-failed':'unknown');
  const actualStage=extraction?.stage??(error instanceof DiagnosticError?error.stage:stage);
  let [title,action]=guidance[code];
  if(code==='selection-required')action=context.mode==='relight'?'请在 Photoshop 重新圈选布光范围，或明确选择“整张图像”后重新读取原图。':context.mode==='background'||context.mode==='scene'?'请在 Photoshop 圈选要保留的主体，再预览范围并重新生成。':context.mode?'请在 Photoshop 重新圈选要修改的区域，再预览选区或恢复上次选区。':action;
  const stages:Record<Stage,string>={connection:'连接',environment:'环境检查',capture:'读取来源',inference:'模型生成',output:'下载候选','lighting-extraction':'本地光影提取',apply:'Photoshop 回填'};
  const detail=redactDiagnostic(extraction?`${extraction.name}: ${message}`:ordinaryError?`${(error as Error).name}: ${message}`:String(error)).slice(0,5000),causes:string[]=[];
  let cause=!extraction&&ordinaryError?(error as Error&{cause?:unknown}).cause:undefined;
  for(let i=0;cause&&i<3;i++){causes.push(redactDiagnostic(cause instanceof Error?`${cause.name}: ${cause.message}`:String(cause)).slice(0,1000));cause=(cause as {cause?:unknown})?.cause;}
  return {code,stage:actualStage,stageLabel:t(stages[actualStage]),title:t(title),action:t(action),summary:redactDiagnostic(message?errorTextForSummary(message):t(title)).slice(0,240),build:BUILD_ID,
    effect:t(actualStage==='lighting-extraction'?'本地光影提取未完成；原始 AI 参考图保留，仅供检查和导出，不能作为光影层应用。':actualStage==='apply'?'应用未完成，候选保留；请检查来源文档和历史记录。':actualStage==='capture'?'捕获未完成，尚未上传此范围。':'此步骤未通过；不要把它视为已完成。'),
    retry:t(actualStage==='lighting-extraction'?'无需重新生成；可检查或导出已保存参考图，恢复只查询原 ID，不会自动重新提交。':hasPending?'先按原 ID 恢复或取消；不要重复提交。':'修正后可重试；生成前仍会重新检查。'),
    detail,...(extraction?{reason:extraction.reason,metrics:extraction.metrics}:{}),...(causes.length?{causes}:{})};
}
function errorTextForSummary(message:string):string {const key=Object.keys(english).find(key=>message===key||message===english[key]);return key?t(key):errorText(message);}
