import {buildGraph} from './workflow';import {DiagnosticError} from './diagnostics';import type {ModelFiles} from './profile';
export function checkEnvironment(hostVersion:string,nodes:Record<string,any>,models?:ModelFiles):void {
  if(!/^\d+\./.test(hostVersion)||Number(hostVersion.split('.')[0])<27)throw new DiagnosticError('incompatible-api','environment','需要 Photoshop 27.0 或更高版本；其他版本未验证');
  const graph=buildGraph({requestId:'setup-check',prompt:'compatibility check',seed:42,steps:25,resolution:768,source:'fixture.png',guide:'guide.png',reference:'reference.png',models});
  const fail=(field:string)=>{throw new DiagnosticError('incompatible-api','environment',`节点模板字段不匹配：${field}`);};
  for(const node of Object.values(graph)){
    const schema=nodes[node.class_type]?.input;
    if(!schema)fail(node.class_type);
    for(const [field,value] of Object.entries(node.inputs)){
      const [root,dynamic]=field.split('.'),definition=schema.required?.[root]??schema.optional?.[root];
      if(!Array.isArray(definition))fail(`${node.class_type}.${field}`);
      if(dynamic){if(!definition[1]?.template?.names?.includes(dynamic))fail(`${node.class_type}.${field}`);continue;}
      if(Array.isArray(value)){
        const from=graph[value[0]],outputs=from&&nodes[from.class_type]?.output;
        if(!outputs||!Number.isInteger(value[1])||value[1]<0||value[1]>=outputs.length)fail(`${node.class_type}.${field} output`);
        continue;
      }
      const choices=Array.isArray(definition[0])?definition[0]:definition[1]?.options;
      // Uploaded image names are added after this read-only check.
      if(choices&&!(node.class_type==='LoadImage'&&field==='image')&&!choices.includes(value))fail(`${node.class_type}.${field}=${value}`);
      if(typeof value==='number'&&((definition[1]?.min!==undefined&&value<definition[1].min)||(definition[1]?.max!==undefined&&value>definition[1].max)))fail(`${node.class_type}.${field}=${value}`);
    }
  }
}
