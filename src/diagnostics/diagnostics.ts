import {ColorContractError} from '../imaging/color';
import {t} from '../localization/i18n';
export type DiagnosticCode='unreachable'|'missing-node'|'missing-model'|'incompatible-api'|'resource-exhausted'|'timeout'|'invalid-output'|'apply-failed'|'source-profile'|'selection-required'|'unknown';
export type Stage='connection'|'environment'|'capture'|'inference'|'output'|'apply';
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
  'apply-failed':['Photoshop 应用失败','候选仍可另存或新建文档；确认来源文档状态，必要时重新捕获。'],
  'source-profile':['无法确定来源色彩空间','确认选择了当前文档的原文件；无法识别颜色声明时，请在副本中指定正确配置文件，再重新捕获。'],
  'selection-required':['需要编辑选区','请先在 Photoshop 建立编辑选区；光影重塑也可在“布光范围”中明确选择“整张图像”，再打开工作台或重新读取原图。'],
  'unknown':['操作未完成，原因尚未确认','展开技术详情核对报错；保留任务 ID 和候选，确认状态后再操作。']
};
export function diagnostic(error:unknown,stage:Stage,hasPending=false){
  const code=error instanceof DiagnosticError||error instanceof ColorContractError?error.code:stage==='apply'?'apply-failed':'unknown';
  const actualStage=error instanceof DiagnosticError?error.stage:stage;
  const [title,action]=guidance[code];
  const stages:Record<Stage,string>={connection:'连接',environment:'环境检查',capture:'读取来源',inference:'模型生成',output:'下载候选',apply:'Photoshop 回填'};
  return {code,stage:actualStage,stageLabel:t(stages[actualStage]),title:t(title),action:t(action),
    effect:t(actualStage==='apply'?'应用未完成，候选保留；请检查来源文档和历史记录。':actualStage==='capture'?'捕获未完成，尚未上传此范围。':'此步骤未通过；不要把它视为已完成。'),
    retry:t(hasPending?'先按原 ID 恢复或取消；不要重复提交。':'修正后可重试；生成前仍会重新检查。'),
    detail:(error instanceof Error?`${error.name}: ${error.message}`:String(error)).slice(0,5000)};
}
