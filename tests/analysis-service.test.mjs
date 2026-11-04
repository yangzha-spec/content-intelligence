import {test} from 'node:test';import assert from 'node:assert/strict';import{createClient}from'@supabase/supabase-js';
import{runProjectAnalysis}from'../src/lib/analysis-service.ts';
const project='10000000-0000-4000-8000-000000000001',run='20000000-0000-4000-8000-000000000001',actor='30000000-0000-4000-8000-000000000001';
const filters={platform:'youtube',profile:'test',start:'2026-10-01',end:'2026-10-31',metric:'views',topic:'',timezone:'Asia/Shanghai'};
function fixture(){const state={role:'owner',saved:null,calls:[],gate:null,denied:null,saveFailures:0,checkpointFailures:0,source:{posts:[{id:'p1',content_key:'p1',platform:'youtube',title:'Private source title',content_type:'video',topic:'教程',publish_time:'2026-10-01T00:00:00Z',source_batch_id:'b'}],metrics:[{id:'m1',content_post_id:'p1',snapshot_time:'2026-10-02T00:00:00Z',snapshot_type:'cumulative',metric_profile:'test',source_batch_id:'b',views:'500',likes:'0',impressions:null,reach:null,comments_count:null,shares:null,saves:null}],comments:[],revision:'fixture',captured_at:'2026-11-04T00:00:00Z',timezone:'Asia/Shanghai'}};
 const client=createClient('https://fixture.invalid','public-key',{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:'Bearer user'},fetch:async(input,opts)=>{const path=new URL(String(input)).pathname;state.calls.push(path);const json=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});if(path.endsWith('/projects'))return json({id:project,name:'Private project',workspace_id:'w',default_timezone:'Asia/Shanghai'});if(path.endsWith('/workspace_members'))return json({role:state.role});if(path.endsWith('/analysis_runs'))return json(state.saved?[{id:run,filters,ai_status:state.saved.ai_state,model_version:null}]:[]);if(path.endsWith('/analysis_results'))return json({result:state.saved.analysis});if(path.endsWith('/get_analysis_source'))return json(state.source);if(path.endsWith('/reserve_ai_call')){const body=JSON.parse(opts.body);if(state.denied)return json({decision:'limited',code:state.denied,retry_after:5});if(state.gate){if(state.gate.input_hash!==body.input_hash)return new Response(JSON.stringify({message:'AI_REQUEST_CHANGED',code:'P0001'}),{status:400,headers:{'Content-Type':'application/json'}});return json(state.gate.state==='running'?{decision:'in_progress',retry_after:5}:{decision:'cached',state:state.gate.state,actions:state.gate.actions});}if(!body.allow_acquire)return json({decision:'disabled'});state.gate={...body,state:'running',actions:[]};return json({decision:'acquired'});}
if(path.endsWith('/finish_ai_call')){if(state.checkpointFailures-- >0)return new Response(JSON.stringify({message:'Unavailable',code:'XX000'}),{status:503,headers:{'Content-Type':'application/json'}});const body=JSON.parse(opts.body);assert.equal(body.token,state.gate.token);state.gate.state=body.final_state;state.gate.actions=body.outcome;return json({state:body.final_state,actions:body.outcome});}
if(path.endsWith('/save_analysis_bundle')){if(state.saveFailures-- >0)return new Response(JSON.stringify({message:'Unavailable',code:'XX000'}),{status:503,headers:{'Content-Type':'application/json'}});state.saved=JSON.parse(opts.body);return json(run);}throw Error('Unexpected request '+path);}}});
 return{state,client};}
test('server recomputes from private project rows and saves source snapshot with a report',async()=>{const{state,client}=fixture();const result=await runProjectAnalysis(client,{project_id:project,run_id:run,filters},actor,{apiKey:'',model:''});assert.equal(result.analysis.metrics.views.sum,'500');assert.equal(state.saved.source_data.revision,'fixture');assert.match(state.saved.report_body,/# 内容表现/);assert.equal(result.ai_status,'not_requested');});
test('repeated request returns its existing analysis without regenerating or saving',async()=>{const{state,client}=fixture();const input={project_id:project,run_id:run,filters};await runProjectAnalysis(client,input,actor,{apiKey:'',model:''});const result=await runProjectAnalysis(client,input,actor,{apiKey:'',model:''});assert.equal(result.already_applied,true);assert.equal(state.calls.filter(p=>p.endsWith('/save_analysis_bundle')).length,1);});
test('viewers cannot create an analysis job',async()=>{const{client,state}=fixture();state.role='viewer';await assert.rejects(runProjectAnalysis(client,{project_id:project,run_id:run,filters},actor,{apiKey:'',model:''}),/编辑者/);assert.equal(state.saved,null);});
test('external AI requires both explicit consent and configured server credentials',async()=>{const{client,state}=fixture();await assert.rejects(runProjectAnalysis(client,{project_id:project,run_id:run,filters,use_ai:true,consent:false},actor,{apiKey:'key',model:'model',enabled:true}),/确认本次/);await assert.rejects(runProjectAnalysis(client,{project_id:project,run_id:run,filters,use_ai:true,consent:true},actor,{apiKey:'',model:''}),/尚未配置/);assert.equal(state.saved,null);});
test('AI network uncertainty preserves grounded observations without claiming provider failure or success',async()=>{const{client,state}=fixture();const result=await runProjectAnalysis(client,{project_id:project,run_id:run,filters,use_ai:true,consent:true},actor,{apiKey:'key',model:'model',enabled:true},async()=>{throw Error('Provider error')});assert.equal(result.ai_status,'uncertain');assert.equal(state.saved.ai_state,'uncertain');assert.equal(result.analysis.metrics.views.sum,'500');assert.ok(result.analysis.warnings.some(w=>w.includes('调用结果未确认')));});

const aiInput={project_id:project,run_id:run,filters,use_ai:true,consent:true};
const configured={apiKey:'fixture-key',model:'fixture-model',enabled:true};
const providerSuccess=()=>new Response(JSON.stringify({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({actions:[{id:'top-content',action:'人工核对表达，再用后续内容验证。'}]})}]}]}),{headers:{'x-request-id':'req_fixture'}});
test('database save failure resumes cached AI actions with one provider attempt',async()=>{
 const {state,client}=fixture();state.saveFailures=1;let calls=0;const provider=async()=>{calls++;return providerSuccess();};
 await assert.rejects(runProjectAnalysis(client,aiInput,actor,configured,provider),/未完整保存/);assert.equal(state.gate.state,'generated');assert.equal(calls,1);
 const restored=await runProjectAnalysis(client,aiInput,actor,configured,provider);assert.equal(restored.ai_status,'generated');assert.equal(calls,1);assert.equal(state.saved.analysis.insights[0].action,'人工核对表达，再用后续内容验证。');
});
test('overlapping requests for one run are gated before the second provider attempt',async()=>{
 const {state,client}=fixture();let started;const began=new Promise(resolve=>{started=resolve});let finish;const release=new Promise(resolve=>{finish=resolve});let calls=0;
 const first=runProjectAnalysis(client,aiInput,actor,configured,async()=>{calls++;started();await release;return providerSuccess();});await began;
 await assert.rejects(runProjectAnalysis(client,aiInput,actor,configured,async()=>{calls++;return providerSuccess();}),e=>e.code==='AI_IN_PROGRESS');finish();await first;assert.equal(calls,1);assert.equal(state.gate.state,'generated');
});
test('quota and disabled switch stop before any provider request or analysis write',async()=>{
 for(const code of ['AI_USER_DAILY_LIMIT','AI_GLOBAL_DAILY_LIMIT','AI_CONCURRENCY_LIMIT']){const {state,client}=fixture();state.denied=code;let calls=0;await assert.rejects(runProjectAnalysis(client,aiInput,actor,configured,async()=>{calls++;return providerSuccess();}),e=>e.code===code&&e.status===429);assert.equal(calls,0);assert.equal(state.saved,null);}
 const {state,client}=fixture();await assert.rejects(runProjectAnalysis(client,aiInput,actor,{...configured,enabled:false},async()=>assert.fail('must not call')),e=>e.code==='AI_NOT_CONFIGURED');assert.equal(state.gate,null);
});
test('an unconfirmed checkpoint does not automatically reissue an external request',async()=>{
 const {state,client}=fixture();state.checkpointFailures=1;let calls=0;const provider=async()=>{calls++;return providerSuccess();};
 await assert.rejects(runProjectAnalysis(client,aiInput,actor,configured,provider),e=>e.code==='AI_CHECKPOINT_UNCONFIRMED');assert.equal(state.saved,null);
 await assert.rejects(runProjectAnalysis(client,aiInput,actor,configured,provider),e=>e.code==='AI_IN_PROGRESS');assert.equal(calls,1);
});
test('HTTP failure receipt is reused after an analysis-save outage and statistics remain deterministic',async()=>{
 const {state,client}=fixture();state.saveFailures=1;let calls=0;const provider=async()=>{calls++;return new Response('{}',{status:429});};
 await assert.rejects(runProjectAnalysis(client,aiInput,actor,configured,provider));const restored=await runProjectAnalysis(client,aiInput,actor,configured,provider);assert.equal(calls,1);assert.equal(restored.ai_status,'failed');assert.equal(restored.analysis.metrics.views.sum,'500');
});
test('cached success can be restored while new provider calls are disabled',async()=>{
 const {state,client}=fixture();state.saveFailures=1;await assert.rejects(runProjectAnalysis(client,aiInput,actor,configured,async()=>providerSuccess()));
 const result=await runProjectAnalysis(client,aiInput,actor,{...configured,enabled:false,apiKey:''},async()=>assert.fail('no new call'));assert.equal(result.ai_status,'generated');
});
test('changed source data cannot silently reuse a paid request receipt',async()=>{
 const {state,client}=fixture();state.saveFailures=1;let calls=0;const provider=async()=>{calls++;return providerSuccess();};await assert.rejects(runProjectAnalysis(client,aiInput,actor,configured,provider));state.source.posts[0].title='Changed source';
 await assert.rejects(runProjectAnalysis(client,aiInput,actor,configured,provider),e=>e.code==='AI_REQUEST_CHANGED');assert.equal(calls,1);
});
test('no-evidence analysis does not consume quota or claim AI generation',async()=>{
 const {state,client}=fixture();state.source.posts=[];state.source.metrics=[];
 const result=await runProjectAnalysis(client,aiInput,actor,configured,async()=>assert.fail('no call'));assert.equal(result.ai_status,'not_requested');assert.equal(state.gate,null);assert.ok(!state.calls.some(p=>p.endsWith('/reserve_ai_call')));
});

test('non-boolean AI intent is rejected before reading or writing project data',async()=>{
 const {state,client}=fixture();await assert.rejects(runProjectAnalysis(client,{...aiInput,use_ai:'false'},actor,configured),/布尔值/);assert.equal(state.calls.length,0);
});
