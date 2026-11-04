import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../../src/types/database.ts';
import { aiConfigured } from '../../../src/lib/ai-insights.ts';
import { AiControlError } from '../../../src/lib/ai-controls.ts';
import { runProjectAnalysis } from '../../../src/lib/analysis-service.ts';
const origins=new Set(['https://content-intelligence-yangzha.travisfrey5197.chatgpt.site','http://127.0.0.1:3000','http://localhost:3000']);
const uuid=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get('Origin');const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin','Access-Control-Allow-Origin':origin&&origins.has(origin)?origin:'','Access-Control-Allow-Headers':'authorization,apikey,x-client-info,content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Expose-Headers':'Retry-After'};
 const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
 if(origin&&!origins.has(origin))return json({error:'此网站未获准调用分析服务。'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return json({error:'仅支持 POST。'},405);
 const authorization=req.headers.get('Authorization');if(!authorization?.startsWith('Bearer '))return json({error:'请先登录。'},401);
 const client=createClient<Database>(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
 const auth=await client.auth.getUser(authorization.slice(7));if(auth.error||!auth.data.user)return json({error:'登录已过期，请重新登录。'},401);
 const config={apiKey:Deno.env.get('OPENAI_API_KEY')||'',model:Deno.env.get('OPENAI_MODEL')||'',enabled:Deno.env.get('AI_ENABLED')==='true'};
 try{const text=await req.text();if(text.length>16000)return json({error:'请求过大。'},413);const input=JSON.parse(text);
  if(input.action==='status'){const usage=await client.rpc('get_ai_call_status');return json({configured:aiConfigured(config)&&!usage.error,controls_available:!usage.error,usage:usage.error?null:usage.data,max_output_tokens:1200,timeout_seconds:45});}
  if(input.action!=='run'||!uuid(input.project_id)||!uuid(input.run_id))return json({error:'项目、请求编号或操作无效。'},400);
  return json(await runProjectAnalysis(client,input,auth.data.user.id,config));
 }catch(error){if(error instanceof AiControlError)return new Response(JSON.stringify({error:error.message,code:error.code,retry_after:error.retryAfter}),{status:error.status,headers:{...headers,...(error.retryAfter?{'Retry-After':String(error.retryAfter)}:{})}});return json({error:error instanceof Error?error.message:'分析服务暂不可用。'},400);}
});
