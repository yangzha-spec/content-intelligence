import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { annotationStamp,cloudDraftStore,demoDraftStore } from '../src/lib/review-drafts.ts';
import { reviewPacket } from '../src/lib/comment-review.ts';
const rows=[{id:'comment-a',text:'Synthetic text must not be stored',content_post_id:'post',sample_type:'top',status:'success',label:'neutral',topics:[],evidence:[],method:'lexicon_zh_en_v1'}];
const context={projectId:'10000000-0000-4000-8000-000000000001',scopeHash:'a'.repeat(64),sourceRevision:'fixture',filters:{platform:'youtube',profile:'fixture',metric:'views',topic:'',start:'2026-10-01',end:'2026-10-31',timezone:'UTC'},methods:['lexicon_zh_en_v1'],synthetic:true,rowCount:1};
const annotations=[{commentId:'comment-a',label:'neutral',topics:[],note:'Self-written note',reviewer:'Reviewer A',reviewedAt:'2026-11-04T08:00:00.000Z',origin:'manual'}];
const packet=()=>reviewPacket(context,rows,annotations);
function storage(){const data=new Map();return {data,getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value)};}
function client(fetch){return createClient('https://test.supabase.co','public-test-key',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch}});}
const record=p=>({packet:p,revision:1,updated_at:'2026-11-04T08:00:00.000Z'});

test('demo drafts survive a new store instance without adding raw comments',async()=>{
 const disk=storage();const first=demoDraftStore(context,rows,disk);assert.equal(await first.load(),null);
 const saved=await first.save(packet(),0);assert.equal(saved.revision,1);const restored=await demoDraftStore(context,rows,disk).load();assert.deepEqual(restored,saved);
 assert.ok(![...disk.data.values()][0].includes(rows[0].text));assert.equal(restored.packet.annotations[0].note,'Self-written note');
 assert.equal(await demoDraftStore({...context,projectId:'different'},rows,disk).load(),null);
 assert.equal(await demoDraftStore({...context,scopeHash:'b'.repeat(64)},rows,disk).load(),null);
 assert.throws(()=>demoDraftStore({...context,synthetic:false},rows,disk),/真实项目/);
});
test('demo draft saves confirm identical retries and reject known stale versions',async()=>{
 const backend=demoDraftStore(context,rows,storage());const p=packet();await backend.save(p,0);assert.equal((await backend.save(p,0)).revision,1);
 const next=structuredClone(p);next.annotations[0].label='positive';assert.equal((await backend.save(next,1)).revision,2);
 await assert.rejects(backend.save(p,1),/已有更新/);assert.equal((await backend.load()).packet.annotations[0].label,'positive');
});
test('blocked storage, quota and malformed drafts fail without reporting success',async()=>{
 const disk=storage();const backend=demoDraftStore(context,rows,disk);await backend.save(packet(),0);const before=[...disk.data.values()][0];disk.setItem=()=>{throw Error('quota');};
 const failing=demoDraftStore(context,rows,disk);const next=packet();next.annotations[0].label='negative';await assert.rejects(failing.save(next,1),/quota/);assert.equal([...disk.data.values()][0],before);
 disk.data.set([...disk.data.keys()][0],'bad-json');await assert.rejects(failing.load());
});
test('cloud draft loader queries the current project/scope and validates every returned annotation',async()=>{
 const real={...context,synthetic:false};const p=reviewPacket(real,rows,annotations);let request;
 const backend=cloudDraftStore(real,rows,client(async(url)=>{request=new URL(url);return Response.json([record(p)]);}));
 assert.equal((await backend.load()).revision,1);assert.equal(request.searchParams.get('project_id'),`eq.${context.projectId}`);assert.equal(request.searchParams.get('scope_hash'),`eq.${context.scopeHash}`);
 const bad=structuredClone(p);bad.context.synthetic=true;await assert.rejects(cloudDraftStore(real,rows,client(async()=>Response.json([record(bad)]))).load(),/不一致/);
 assert.throws(()=>cloudDraftStore(context,rows,client(async()=>Response.json([]))),/演示标注/);
});
test('cloud saves pass optimistic versions and keep a lost response retryable',async()=>{
 const real={...context,synthetic:false};const p=reviewPacket(real,rows,annotations);let calls=0;
 const backend=cloudDraftStore(real,rows,client(async(url,options)=>{assert.ok(String(url).endsWith('/rpc/save_comment_review_draft'));const body=JSON.parse(options.body);assert.equal(body.expected_revision,0);assert.equal(body.target_project,real.projectId);assert.deepEqual(body.draft_packet,p);calls++;if(calls===1)return Response.json({message:'network lost after commit'},{status:503});return Response.json(record(p));}));
 await assert.rejects(backend.save(p,0),/尚未确认/);assert.equal((await backend.save(p,0)).revision,1);assert.equal(calls,2);
 const conflict=cloudDraftStore(real,rows,client(async()=>Response.json({code:'P0001',message:'REVIEW_DRAFT_CONFLICT'},{status:400})));
 await assert.rejects(conflict.save(p,0),/未覆盖/);
});
test('drafts reject mismatched scope before save, invalid versions and invalid annotations on load',async()=>{
 const disk=storage();const backend=demoDraftStore(context,rows,disk);const bad=structuredClone(packet());bad.context.projectId='other';await assert.rejects(backend.save(bad,0),/不一致/);assert.equal(disk.data.size,0);
 const saved=await backend.save(packet(),0);const key=[...disk.data.keys()][0];disk.data.set(key,JSON.stringify({...saved,revision:0}));await assert.rejects(backend.load(),/无效/);
 saved.packet.annotations[0].topics=['invalid'];disk.data.set(key,JSON.stringify(saved));await assert.rejects(backend.load(),/无效/);
 assert.equal(annotationStamp(annotations),annotationStamp([...annotations].reverse()));
});
