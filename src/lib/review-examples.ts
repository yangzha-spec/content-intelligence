import type { CommentResult } from './analytics.ts';
import type { HumanLabel, ReviewAnnotation } from './comment-review.ts';
// Handwritten teaching examples, deliberately independent of classifier outputs.
// These are not independently annotated ground truth or a model benchmark.
const EXAMPLES: {text:string;label:HumanLabel;topics:string[];note:string}[] = [
 {text:'教程很实用，步骤清晰，希望增加更多案例。',label:'positive',topics:['内容质量','教程需求'],note:'示例：肯定教程，同时提出更多案例的需求。'},
 {text:'这个功能体验不错，期待下期更新。',label:'positive',topics:['产品体验','发布与互动'],note:'示例：对功能体验作肯定评价，词典可能未覆盖“不错”。'},
 {text:'价格太贵，预算有限，希望解释成本。',label:'negative',topics:['价格与成本'],note:'示例：明确对价格表达不满。'},
 {text:'看不懂具体操作，演示不清楚。',label:'negative',topics:['内容质量','教程需求'],note:'示例：操作说明缺乏清晰度。'},
 {text:'感谢分享，细节有用，推荐这个系列。',label:'positive',topics:['内容质量','发布与互动'],note:'示例：明确感谢和推荐。'},
 {text:'一般。',label:'neutral',topics:[],note:'示例：中性评价，没有明确主题。'},
 {text:'收到。',label:'neutral',topics:[],note:'示例：中性确认。'},
 {text:'这期主题很有意思，可以讨论一下吗？',label:'positive',topics:['发布与互动'],note:'示例：“有意思”表达兴趣；可讨论在此标为互动需求。'},
 {text:'工具速度让我失望，需要改进功能。',label:'negative',topics:['产品体验'],note:'示例：明确对工具体验失望。'},
 {text:'not helpful for beginners, more examples please.',label:'negative',topics:['内容质量','教程需求'],note:'示例：否定 helpful；不应将其当作正向，规则可能拒判。'},
 {text:'Great guide, helpful examples and useful steps.',label:'positive',topics:['内容质量','教程需求'],note:'示例：明确肯定教程。'},
 {text:'喜欢这个系列，但是价格太贵。',label:'uncertain',topics:['价格与成本','发布与互动'],note:'示例：混合情感，不强行归入单一情感。'},
];
export function exampleReviews(rows:CommentResult[]):ReviewAnnotation[]{
 const sorted=[...rows].sort((a,b)=>a.id.localeCompare(b.id));const used=new Set<string>();
 return EXAMPLES.flatMap(example=>{const row=sorted.find(r=>r.text===example.text&&!used.has(r.id));if(!row)return [];used.add(row.id);return [{commentId:row.id,label:example.label,topics:example.topics,note:example.note,reviewer:'内置教学示例（未独立标注）',reviewedAt:new Date().toISOString(),origin:'example' as const}];});
}
