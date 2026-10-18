import {buildGraph} from '../generation/workflow';import {DiagnosticError} from './diagnostics';import type {ModelFiles} from '../infrastructure/config/profile';
export function checkEnvironment(hostVersion:string,nodes:Record<string,any>,models?:ModelFiles,outputDepth:8|16=8):void {
  if(!/^\d+\./.test(hostVersion)||Number(hostVersion.split('.')[0])<27)throw new DiagnosticError('incompatible-api','environment','需要 Photoshop 27.0 或更高版本；其他版本未验证');
  if(outputDepth===16&&!nodes.PS_AISavePNG16?.input)throw new DiagnosticError('missing-node','environment','缺少节点 PS_AISavePNG16：把 comfyui/ps_ai_sdr16 复制到 ComfyUI/custom_nodes 后重启后端，或选择 8-bit 输出');
  const options={requestId:'setup-check',prompt:'compatibility check',seed:42,steps:25,resolution:768,models,outputDepth};
  const graphs=[buildGraph(options),buildGraph({...options,source:'fixture.png',guide:'guide.png',reference:'reference.png'})];
  const fail=(field:string)=>{throw new DiagnosticError('incompatible-api','environment',`节点模板字段不匹配：${field}`);};
  for(const graph of graphs){
  for(const node of Object.values(graph)){
    const schema=nodes[node.class_type]?.input;
    if(!schema)fail(node.class_type);
    for(const [field,definition] of Object.entries(schema.required??{}) as [string,any][]){
      if(field in node.inputs)continue;
      const template=definition?.[1]?.template;
      // Auto-grow groups are represented by dotted input names, never the root.
      const count=Object.keys(node.inputs).filter(name=>name.startsWith(field+'.')).length;
      if(definition?.[0]!=='COMFY_AUTOGROW_V3'||!template||count<(template.min??0))fail(`${node.class_type}.${field} required`);
    }
    for(const [field,value] of Object.entries(node.inputs)){
      const [root,dynamic,...rest]=field.split('.');let definition=schema.required?.[root]??schema.optional?.[root];
      if(!Array.isArray(definition))fail(`${node.class_type}.${field}`);
      if(dynamic){
        const template=definition[1]?.template,inputs=template?.input?.required;
        if(rest.length||definition[0]!=='COMFY_AUTOGROW_V3'||!template?.names?.includes(dynamic)||!inputs||Object.keys(inputs).length!==1)fail(`${node.class_type}.${field}`);
        definition=Object.values(inputs)[0];if(!Array.isArray(definition))fail(`${node.class_type}.${field}`);
      }
      if(Array.isArray(value)){
        const from=graph[value[0]],outputs=from&&nodes[from.class_type]?.output;
        if(!outputs||!Number.isInteger(value[1])||value[1]<0||value[1]>=outputs.length)fail(`${node.class_type}.${field} output`);
        // This pinned template has concrete socket types; ambiguous/wildcard
        // schemas need explicit support rather than an optimistic green check.
        if(outputs[value[1]]!==definition[0])fail(`${node.class_type}.${field} type`);
        continue;
      }
      const choices=Array.isArray(definition[0])?definition[0]:definition[1]?.options;
      // Uploaded image names are added after this read-only check.
      if(choices&&!(node.class_type==='LoadImage'&&field==='image')&&!choices.includes(value))fail(`${node.class_type}.${field}=${value}`);
      if(!choices&&((definition[0]==='INT'&&!Number.isInteger(value))||(definition[0]==='FLOAT'&&(typeof value!=='number'||!Number.isFinite(value)))||(definition[0]==='STRING'&&typeof value!=='string')||(definition[0]==='BOOLEAN'&&typeof value!=='boolean')))fail(`${node.class_type}.${field} type`);
      if(typeof value==='number'&&((definition[1]?.min!==undefined&&value<definition[1].min)||(definition[1]?.max!==undefined&&value>definition[1].max)))fail(`${node.class_type}.${field}=${value}`);
    }
  }
  }
}
