import type { Analysis, CommentResult } from './analytics.ts';
import { csvText } from './import-validation.ts';

export const SENTIMENTS = ['positive','negative','neutral'] as const;
export const HUMAN_LABELS = [...SENTIMENTS,'uncertain'] as const;
export const PREDICTIONS = [...SENTIMENTS,'unknown'] as const;
export const REVIEW_TOPICS = ['内容质量','教程需求','产品体验','价格与成本','发布与互动'] as const;
export const REVIEW_NAMES: Record<string,string> = {positive:'正向',negative:'负向',neutral:'中性',unknown:'规则未判断',uncertain:'人工无法判断'};
export const REVIEW_FILE_LIMIT = 16 * 1024 * 1024;
export type HumanLabel = typeof HUMAN_LABELS[number];
export type ReviewAnnotation = {commentId:string; label:HumanLabel; topics:string[]|null; note:string; reviewer:string; reviewedAt:string; origin:'manual'|'example'};
export type ReviewContext = {projectId:string; scopeHash:string; sourceRevision:string; filters:Analysis['filters']; methods:string[]; synthetic:boolean; rowCount:number};
export type ReviewPacket = {schema:'ci_review_v1';context:ReviewContext;savedAt:string;annotations:ReviewAnnotation[]};
const canonical = (value:unknown):string => Array.isArray(value)?`[${value.map(canonical).join(',')}]`:value!==null&&typeof value==='object'?`{${Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`:JSON.stringify(value);
const ratio = (n:number,d:number) => d?n/d:null;
export async function createReviewContext(analysis:Analysis,projectId:string,synthetic:boolean):Promise<ReviewContext>{
  const rows=analysis.comments.rows;
  if(rows.length>10000||new Set(rows.map(r=>r.id)).size!==rows.length)throw new Error('评论数量超限或编号重复，无法建立复核集。');
  const methods=[...new Set(rows.map(r=>r.method))].sort();
  const base={projectId,sourceRevision:analysis.sourceRevision,filters:analysis.filters,methods,synthetic,rowCount:rows.length};
  const ordered=[...rows].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0).map(r=>({id:r.id,post:r.content_post_id,text:r.text,sample:r.sample_type,label:r.label,topics:[...r.topics].sort(),method:r.method}));
  const bytes=new TextEncoder().encode(canonical({context:base,rows:ordered}));
  const hash=await crypto.subtle.digest('SHA-256',bytes);
  return {...base,scopeHash:Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('')};
}
function checkAnnotation(value:unknown,ids:Set<string>,synthetic:boolean):ReviewAnnotation{
  const a=value as ReviewAnnotation;
  if(!a||typeof a!=='object'||Array.isArray(a)||typeof a.commentId!=='string'||!ids.has(a.commentId)||!HUMAN_LABELS.includes(a.label)
    ||typeof a.note!=='string'||a.note.length>240||typeof a.reviewer!=='string'||!a.reviewer.trim()||a.reviewer.length>80
    ||typeof a.reviewedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(a.reviewedAt)||!Number.isFinite(Date.parse(a.reviewedAt))||new Date(a.reviewedAt).toISOString()!==a.reviewedAt
    ||!['manual','example'].includes(a.origin)||(!synthetic&&a.origin==='example')
    ||(a.topics!==null&&(!Array.isArray(a.topics)||a.topics.length>REVIEW_TOPICS.length||new Set(a.topics).size!==a.topics.length||a.topics.some(t=>!REVIEW_TOPICS.includes(t as typeof REVIEW_TOPICS[number])))))throw new Error('复核记录包含无效编号、标签、主题、备注或标注者。');
  return {commentId:a.commentId,label:a.label,topics:a.topics===null?null:[...a.topics].sort(),note:a.note,reviewer:a.reviewer.trim(),reviewedAt:a.reviewedAt,origin:a.origin};
}
export function validateAnnotations(values:unknown,context:ReviewContext,rows:CommentResult[]):ReviewAnnotation[]{
  if(!Array.isArray(values)||values.length>rows.length)throw new Error('复核记录数量无效。');
  const ids=new Set(rows.map(r=>r.id));const result=values.map(a=>checkAnnotation(a,ids,context.synthetic));
  if(new Set(result.map(a=>a.commentId)).size!==result.length)throw new Error('复核文件含重复评论编号，未合并任何记录。');
  return result.sort((a,b)=>a.commentId<b.commentId?-1:a.commentId>b.commentId?1:0);
}
export function reviewPacket(context:ReviewContext,rows:CommentResult[],annotations:ReviewAnnotation[]):ReviewPacket{
  return {schema:'ci_review_v1',context,savedAt:new Date().toISOString(),annotations:validateAnnotations(annotations,context,rows)};
}
export function parseReviewPacket(text:string,context:ReviewContext,rows:CommentResult[]):ReviewAnnotation[]{
  if(new TextEncoder().encode(text).byteLength>REVIEW_FILE_LIMIT)throw new Error('复核文件超过 16 MiB。');
  let packet:ReviewPacket;
  try{packet=JSON.parse(text);}catch{throw new Error('不是有效的 JSON 复核文件。');}
  if(!packet||packet.schema!=='ci_review_v1'||canonical(packet.context)!==canonical(context))throw new Error('复核文件与当前项目、筛选、评论或方法版本不一致。请先恢复原筛选，不会部分导入。');
  return validateAnnotations(packet.annotations,context,rows);
}
export function mergeReviews(current:ReviewAnnotation[],incoming:ReviewAnnotation[]):ReviewAnnotation[]{
  const merged=new Map(current.map(a=>[a.commentId,a]));
  for(const annotation of incoming){const old=merged.get(annotation.commentId);if(old&&canonical(old)!==canonical(annotation))throw new Error('导入文件与当前标注存在冲突，请先导出当前复核文件。未覆盖任何记录。');merged.set(annotation.commentId,annotation);}
  return [...merged.values()];
}
export function reviewEvaluation(rows:CommentResult[],annotations:ReviewAnnotation[]){
  const byId=new Map(rows.map(row=>[row.id,row]));const reviews=annotations.filter(a=>byId.has(a.commentId));
  const scored=reviews.filter(a=>a.label!=='uncertain');const covered=scored.filter(a=>byId.get(a.commentId)!.label!=='unknown');
  const correct=scored.filter(a=>a.label===byId.get(a.commentId)!.label).length;
  const confusion=SENTIMENTS.map(actual=>({actual,counts:PREDICTIONS.map(predicted=>scored.filter(a=>a.label===actual&&byId.get(a.commentId)!.label===predicted).length)}));
  const classes=SENTIMENTS.map(label=>{
    const support=scored.filter(a=>a.label===label).length;const predicted=scored.filter(a=>byId.get(a.commentId)!.label===label).length;
    const tp=scored.filter(a=>a.label===label&&byId.get(a.commentId)!.label===label).length;const fp=predicted-tp,fn=support-tp;
    return {label,support,predicted,tp,fp,fn,precision:ratio(tp,tp+fp),recall:ratio(tp,tp+fn),f1:support?ratio(2*tp,2*tp+fp+fn):null};
  });
  const present=classes.filter(c=>c.support>0);const topicReviews=reviews.filter(a=>a.topics!==null);let tp=0,fp=0,fn=0;
  for(const a of topicReviews){const predicted=byId.get(a.commentId)!.topics;tp+=a.topics!.filter(t=>predicted.includes(t)).length;fp+=predicted.filter(t=>!a.topics!.includes(t)).length;fn+=a.topics!.filter(t=>!predicted.includes(t)).length;}
  const exact=topicReviews.filter(a=>canonical([...a.topics!].sort())===canonical([...byId.get(a.commentId)!.topics].sort())).length;
  const disagreements=scored.filter(a=>a.label!==byId.get(a.commentId)!.label).map(a=>a.commentId);
  const topicDisagreements=topicReviews.filter(a=>canonical([...a.topics!].sort())!==canonical([...byId.get(a.commentId)!.topics].sort())).map(a=>a.commentId);
  return {total:rows.length,reviewed:reviews.length,unreviewed:rows.length-reviews.length,uncertain:reviews.length-scored.length,eligible:scored.length,covered:covered.length,abstained:scored.length-covered.length,correct,coverage:ratio(covered.length,scored.length),agreement:ratio(correct,scored.length),selectiveAgreement:ratio(correct,covered.length),macroF1:present.length?present.reduce((n,c)=>n+c.f1!,0)/present.length:null,macroClasses:present.length,classes,confusion,disagreements,topicDisagreements,examples:reviews.filter(a=>a.origin==='example').length,topics:{reviewed:topicReviews.length,exactMatch:ratio(exact,topicReviews.length),tp,fp,fn,precision:ratio(tp,tp+fp),recall:ratio(tp,tp+fn),f1:ratio(2*tp,2*tp+fp+fn)}};
}
export function fixedReviewSample(rows:CommentResult[],size=60):string[]{
  const ids=rows.map(r=>r.id).sort();const count=Math.min(Math.max(0,Math.floor(size)),ids.length);
  return Array.from({length:count},(_,i)=>ids[Math.floor(i*ids.length/count)]);
}
export function reviewCsv(rows:CommentResult[],annotations:ReviewAnnotation[]){
  const byId=new Map(annotations.map(a=>[a.commentId,a]));
  return csvText([['评论编号','原文','规则标签','规则主题','方法版本','人工标签','人工主题（空白表示未复核）','主题已复核','标注者（自填）','备注','复核时间','来源'],...rows.map(r=>{const a=byId.get(r.id);return [r.id,r.text,r.label,r.topics.join(';'),r.method,a?.label??'',a?.topics?.join(';')??'',a?.topics!==null&&a?.topics!==undefined?'是':'否',a?.reviewer??'',a?.note??'',a?.reviewedAt??'',a?.origin??''];})]);
}
export function evaluationMarkdown(context:ReviewContext,rows:CommentResult[],annotations:ReviewAnnotation[]){
  const e=reviewEvaluation(rows,annotations);const p=(n:number|null)=>n===null?'不可计算':`${(n*100).toFixed(1)}%`;
  return `# 评论规则与人工复核对照\n\n${context.synthetic?'**合成数据演练，不代表真实模型效果。**':'自填人工标签的局部复核，不代表受众总体或独立盲测。'}\n\n复核 ${e.reviewed}/${e.total}；人工可判断 ${e.eligible}；人工无法判断 ${e.uncertain}；规则拒判 ${e.abstained}。\n\n与人工一致率（含拒判）：${p(e.agreement)}；规则覆盖率：${p(e.coverage)}；已判断样本一致率：${p(e.selectiveAgreement)}。\n\n宏平均 F1：${p(e.macroF1)}，只对有人工样本的 ${e.macroClasses} 类平均；规则未判断计入漏判。\n\n|人工标签|规则正向|规则负向|规则中性|规则未判断|\n|---|---:|---:|---:|---:|\n${e.confusion.map(r=>`|${REVIEW_NAMES[r.actual]}|${r.counts.join('|')}|`).join('\n')}\n\n|人工类别|样本量|Precision|Recall|F1|TP|FP|FN|\n|---|---:|---:|---:|---:|---:|---:|---:|\n${e.classes.map(c=>`|${REVIEW_NAMES[c.label]}|${c.support}|${p(c.precision)}|${p(c.recall)}|${p(c.f1)}|${c.tp}|${c.fp}|${c.fn}|`).join('\n')}\n\n主题已复核 ${e.topics.reviewed} 条；标签集合完全一致 ${p(e.topics.exactMatch)}；微平均 Precision ${p(e.topics.precision)} / Recall ${p(e.topics.recall)} / F1 ${p(e.topics.f1)}。人工明确无主题（空集合）参与主题评估，未复核（null）不参与。\n\n## 复现与边界\n\n- 范围：${context.filters.start} 至 ${context.filters.end}，${context.filters.timezone}。\n- 方法：${context.methods.join(', ')}。\n- 输入指纹：${context.sourceRevision}；复核集 SHA-256：${context.scopeHash}。\n- 未标注记录不参与评估；人工无法判断不当作中性；主题和情感的分母各自独立。\n- 当前筛选/队列仅影响展示；评估包含本复核集所有已保存的标注。固定 60 条为按编号等距取样，不是随机或代表性抽样。\n- 标注者为自行填写，没有身份核验或多标注者一致性裁决；文件散列用于匹配数据，不是作者签名。\n- ${context.synthetic?'内置示例标注 '+e.examples+' 条，仅作操作演练，不能作为训练或测试集质量证明。':'结果基于人工选择的局部样本，尚不能作为经过独立标注集验证的模型效果。'}\n- 原始分析结果和报告未被标注覆盖；本工具不训练模型，不替代正式 NLP 模型选择与可信标注评估。\n`;
}
