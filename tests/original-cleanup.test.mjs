import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { cleanupOriginals } from '../src/lib/original-cleanup.ts';
const project='10000000-0000-4000-8000-000000000001',batch='20000000-0000-4000-8000-000000000001';
function fixture(){
 const state={requests:[],roleDenied:false,removeFail:false,finishFail:false,deleted:false,invalidPath:false};
 const client=createClient('https://fixture.invalid','publishable-fixture',{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:'Bearer fixture-owner'},fetch:async(input,options)=>{
  const path=new URL(String(input)).pathname;const method=options?.method||'GET';const body=options?.body?JSON.parse(options.body):null;
  state.requests.push({path,method,body,authorization:new Headers(options?.headers).get('Authorization')});
  const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
  if(path.endsWith('/auth/v1/user'))return json({id:'30000000-0000-4000-8000-000000000001',aud:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-11-04T00:00:00Z'});
  if(path.endsWith('/rpc/begin_original_cleanup'))return state.roleDenied?json({code:'42501',message:'ORIGINALS_FORBIDDEN'},403):json({batch_id:batch,project_id:project,state:state.deleted?'deleted':'deleting',files:[{name:'Posts.csv',path:state.invalidPath?'another-project/0.csv':`${project}/${batch}/0.csv`,size:100,sha256:'a'.repeat(64),mime:'text/csv'}]});
  if(path==='/storage/v1/object/raw-imports'&&method==='DELETE')return state.removeFail?json({statusCode:'503',error:'Unavailable',message:'Interrupted'},503):json([{name:`${project}/${batch}/0.csv`}]);
  if(path.endsWith('/rpc/finish_original_cleanup'))return state.finishFail?json({code:'P0001',message:'ORIGINALS_STILL_PRESENT'},400):json({state:'deleted',batch_id:batch});
  throw new Error(`Unexpected ${method} ${path}`);
 }}});
 return {state,client};
}

test('original cleanup needs an exact explicit confirmation before making any request',async()=>{
 const {state,client}=fixture();await assert.rejects(cleanupOriginals(batch,'yes',client),/请输入/);assert.equal(state.requests.length,0);
});
test('cleanup uses authenticated Storage remove for server-authorized paths then verifies completion',async()=>{
 const {state,client}=fixture();assert.equal((await cleanupOriginals(batch,'清理原文件',client)).state,'deleted');
 assert.ok(state.requests.every(request=>request.authorization==='Bearer fixture-owner'));
 assert.deepEqual(state.requests.map(r=>r.path),['/auth/v1/user','/rest/v1/rpc/begin_original_cleanup','/storage/v1/object/raw-imports','/rest/v1/rpc/finish_original_cleanup']);
 assert.deepEqual(state.requests[2].body,{prefixes:[`${project}/${batch}/0.csv`]});
});
test('role rejection or mismatched file paths prevent any Storage deletion',async()=>{
 for(const key of ['roleDenied','invalidPath']){const {state,client}=fixture();state[key]=true;await assert.rejects(cleanupOriginals(batch,'清理原文件',client));assert.ok(state.requests.every(r=>r.method!=='DELETE'));}
});
test('interrupted deletion does not finalize; retry reuses the batch and completes',async()=>{
 const {state,client}=fixture();state.removeFail=true;await assert.rejects(cleanupOriginals(batch,'清理原文件',client),/保持/);assert.ok(!state.requests.some(r=>r.path.endsWith('finish_original_cleanup')));
 state.removeFail=false;assert.equal((await cleanupOriginals(batch,'清理原文件',client)).state,'deleted');
});
test('a partial removal cannot claim completion and an already-completed retry skips Storage',async()=>{
 const {state,client}=fixture();state.finishFail=true;await assert.rejects(cleanupOriginals(batch,'清理原文件',client),/尚未确认/);
 const other=fixture();other.state.deleted=true;assert.equal((await cleanupOriginals(batch,'清理原文件',other.client)).alreadyComplete,true);assert.ok(other.state.requests.every(r=>r.method!=='DELETE'));
});
