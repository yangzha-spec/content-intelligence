import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database,Json } from '../types/database.ts';
import type { Analysis,AnalysisSource } from './analytics.ts';
import { aiConfigured,aiRequestBody,applyAiActions,AiProviderError,enrichActions,type AiConfig } from './ai-insights.ts';
import { sha256,stableJson } from './import-contract.ts';

export type { AiCallUsage } from './ai-control-status.ts';
export class AiControlError extends Error{
 code:string;status:number;retryAfter?:number;
 constructor(message:string,code:string,status=429,retryAfter?:number){super(message);this.name='AiControlError';this.code=code;this.status=status;this.retryAfter=retryAfter;}
}
type Gate={decision:'acquired'|'cached'|'in_progress'|'limited'|'disabled';state?:'generated'|'failed'|'uncertain';actions?:unknown;code?:string;retry_after?:number};
export async function controlledAi(client:SupabaseClient<Database>,analysis:Analysis,source:AnalysisSource,projectId:string,runId:string,config:AiConfig,call:typeof fetch=fetch){
 if(!analysis.insights.length)return {analysis,aiStatus:'not_requested',model:null as string|null};
 if(!config.model)throw new AiControlError('外部模型尚未配置，请先使用统计与规则建议。','AI_NOT_CONFIGURED',400);
 aiRequestBody(analysis,config);
 const inputHash=await sha256(stableJson({projectId,runId,model:config.model,engine:analysis.version,filters:analysis.filters,posts:source.posts,metrics:source.metrics,comments:source.comments}));
 const token=crypto.randomUUID();
 const reserved=await client.rpc('reserve_ai_call',{target_project:projectId,target_run:runId,input_hash:inputHash,token,allow_acquire:aiConfigured(config)});
 if(reserved.error){
  if(reserved.error.message.includes('AI_REQUEST_CHANGED'))throw new AiControlError('本次请求的数据、模型或操作者已改变，请刷新分析并建立新请求。','AI_REQUEST_CHANGED',409);
  throw new AiControlError('调用控制暂不可用，未发起外部模型请求。请稍后使用同一请求恢复。','AI_CONTROL_UNAVAILABLE',503);
 }
 const gate=reserved.data as unknown as Gate;
 if(gate.decision==='disabled')throw new AiControlError('外部模型尚未配置或未启用，请先使用统计与规则建议。','AI_NOT_CONFIGURED',400);
 if(gate.decision==='in_progress')throw new AiControlError('本次 AI 请求正在处理中，请稍后使用同一请求恢复，不要新建请求。','AI_IN_PROGRESS',409,gate.retry_after);
 if(gate.decision==='limited')throw new AiControlError(gate.code==='AI_USER_DAILY_LIMIT'?'今日个人调用次数已用完，请等待重置或关闭 AI 保存规则报告。':gate.code==='AI_GLOBAL_DAILY_LIMIT'?'应用今日调用次数已用完，请等待重置或关闭 AI 保存规则报告。':'已有 AI 请求在处理，请稍后使用同一请求恢复。',gate.code||'AI_LIMITED',429,gate.retry_after);
 let state: 'generated'|'failed'|'uncertain';let actions:unknown;
 if(gate.decision==='cached'){if(!['generated','failed','uncertain'].includes(String(gate.state)))throw new AiControlError('已保存的调用状态无效，未继续执行。','AI_CONTROL_INVALID',503);state=gate.state!;actions=gate.actions;}
 else if(gate.decision==='acquired'){
  let providerId:string|null=null,failure:string|undefined;state='generated';
  try{const generated=await enrichActions(analysis,config,call,{clientRequestId:`ci-${runId}`,onProviderId:id=>{providerId=id;}});actions=generated.insights.map(i=>({id:i.id,action:i.action}));}
  catch(error){const e=error instanceof AiProviderError?error:new AiProviderError('timeout_network',true);state=e.uncertain?'uncertain':'failed';failure=e.code;providerId=e.requestId||providerId;actions=[];}
  const checkpoint=await client.rpc('finish_ai_call',{target_run:runId,token,final_state:state,outcome:actions as Json,failure,provider_id:providerId??undefined});
  if(checkpoint.error||!checkpoint.data)throw new AiControlError('外部调用结果尚未确认保存。请保留同一请求稍后恢复，不会直接重新调用模型。','AI_CHECKPOINT_UNCONFIRMED',503);
  const cached=checkpoint.data as unknown as {state:typeof state;actions:unknown};if(!['generated','failed','uncertain'].includes(cached.state))throw new AiControlError('调用检查点状态无效，请保留请求编号核对。','AI_CONTROL_INVALID',503);state=cached.state;actions=cached.actions;
 }else throw new AiControlError('调用控制返回了无效结果，未继续执行。','AI_CONTROL_INVALID',503);
 if(state==='generated'){
  try{return {analysis:applyAiActions(analysis,actions),aiStatus:'generated',model:config.model};}
  catch{throw new AiControlError('已保存的模型结果未通过校验，不会重新发起调用。请保留请求编号核对。','AI_CACHE_INVALID',503);}
 }
 const warning=state==='uncertain'?'外部调用结果未确认，本请求不会自动重发；报告保留原有统计与规则建议。调用次数仍计入今日上限。':'外部模型调用未完成或结果未通过校验，本请求不会自动重发，报告使用原有统计与规则建议。调用次数仍计入今日上限。';
 return {analysis:{...analysis,warnings:[...analysis.warnings,warning]},aiStatus:state,model:config.model};
}
