import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../types/database.ts';
import { analyze, validateFilters, type Analysis, type AnalysisSource, type Filters } from './analytics.ts';
import { analysisMarkdown } from './analysis-report.ts';
import { enrichActions, type AiConfig } from './ai-insights.ts';
import { stableJson } from './import-contract.ts';
export async function runProjectAnalysis(client: SupabaseClient<Database>, input: { project_id: string; run_id: string; filters: Filters; use_ai?: boolean; consent?: boolean }, actorId: string, config: AiConfig, call: typeof fetch = fetch) {
  const { data: project, error: projectError } = await client.from('projects').select('id,name,workspace_id,default_timezone').eq('id',input.project_id).single();
  if(projectError||!project)throw new Error('项目不存在或当前账号没有访问权限。');
  const { data: member } = await client.from('workspace_members').select('role').eq('workspace_id',project.workspace_id).eq('user_id',actorId).single();
  if(!member||!['owner','editor'].includes(member.role))throw new Error('只有项目编辑者或空间所有者可以保存分析。');
  const filters=validateFilters(input.filters,project.default_timezone);
  const { data: existing,error: existingError } = await client.from('analysis_runs').select('id,filters,ai_status,model_version').eq('project_id',project.id).eq('id',input.run_id).maybeSingle();
  if(existingError)throw new Error('分析历史暂时不可用，请稍后重试。');
  if(existing){
    if(stableJson(existing.filters)!==stableJson(filters))throw new Error('本次请求编号已用于其他筛选条件，请重新运行分析。');
    const {data,error}=await client.from('analysis_results').select('result').eq('project_id',project.id).eq('analysis_run_id',existing.id).eq('result_key','dashboard').single();
    if(error)throw new Error('历史分析结果暂不可用。');
    return {run_id:existing.id,analysis:data.result as unknown as Analysis,ai_status:existing.ai_status,already_applied:true};
  }
  const {data,error}=await client.rpc('get_analysis_source',{target_project:project.id});
  if(error)throw new Error(error.message.includes('ANALYSIS_LIMIT')?'项目超过单次分析上限（内容一万篇、快照五万条、评论一万条、源数据十二 MB），请拆分项目。':'服务器无法读取分析源数据，请确认项目权限后重试。');
  const source=data as unknown as AnalysisSource;
  let analysis=analyze(source,filters);let aiStatus='not_requested';let model:string|null=null;
  if(input.use_ai){
    if(input.consent!==true)throw new Error('启用外部 AI 前，请确认本次发送汇总数据和可能产生 API 费用。');
    if(!config.apiKey||!config.model)throw new Error('外部模型尚未配置，请先使用统计与规则建议。');
    try{analysis=await enrichActions(analysis,config,call);aiStatus='generated';model=config.model;}
    catch{aiStatus='failed';model=config.model;analysis={...analysis,warnings:[...analysis.warnings,'外部模型调用未完成或结果未通过证据校验，本报告使用原有统计与规则建议。']};}
  }
  const body=analysisMarkdown(analysis,project.name,false);
  const saved=await client.rpc('save_analysis_bundle',{target_project:project.id,run_id:input.run_id,source_data:source as unknown as Json,analysis:analysis as unknown as Json,report_body:body,ai_state:aiStatus,model_name:model??undefined});
  if(saved.error)throw new Error('分析结果未完整保存，事务已回滚。请使用同一请求重试。');
  return {run_id:input.run_id,analysis,ai_status:aiStatus,already_applied:false};
}
