import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database.ts';
import { parseReviewPacket, reviewPacket, type ReviewAnnotation, type ReviewContext, type ReviewPacket } from './comment-review.ts';
import type { CommentResult } from './analytics.ts';

export type ReviewDraft = { packet:ReviewPacket; revision:number; updatedAt:string };
export type DraftStore = { load:()=>Promise<ReviewDraft|null>; save:(packet:ReviewPacket,expectedRevision:number)=>Promise<ReviewDraft> };
type StorageLike = Pick<Storage,'getItem'|'setItem'>;
export const DRAFT_CONFLICT='草稿已有更新，未覆盖。请先下载当前 JSON 备份，再读取最新草稿并核对差异。';
export function annotationStamp(annotations:ReviewAnnotation[]):string {
 return JSON.stringify([...annotations].sort((a,b)=>a.commentId.localeCompare(b.commentId)).map(a=>({...a,topics:a.topics===null?null:[...a.topics].sort()})));
}
function checked(value:unknown,context:ReviewContext,rows:CommentResult[]):ReviewDraft {
 const d=value as ReviewDraft;
 if(!d||!Number.isSafeInteger(d.revision)||d.revision<1||typeof d.updatedAt!=='string'||!Number.isFinite(Date.parse(d.updatedAt)))throw new Error('草稿记录无效，未载入。请保留 JSON 备份。');
 const annotations=parseReviewPacket(JSON.stringify(d.packet),context,rows);
 return {packet:{...d.packet,annotations},revision:d.revision,updatedAt:d.updatedAt};
}
function same(a:ReviewPacket,b:ReviewPacket):boolean {return annotationStamp(a.annotations)===annotationStamp(b.annotations);}
/** Synthetic preview only. Browser storage is not the real project's source of truth. */
export function demoDraftStore(context:ReviewContext,rows:CommentResult[],storage:StorageLike):DraftStore {
 if(!context.synthetic)throw new Error('真实项目不能保存到演示草稿。');
 const key=`ci-review-demo-v1:${context.projectId}:${context.scopeHash}`;
 const read=()=>{const text=storage.getItem(key);if(!text)return null;if(text.length>16*1024*1024)throw new Error('演示草稿过大，未载入。');return checked(JSON.parse(text),context,rows);};
 return {load:async()=>read(),save:async(packet,expectedRevision)=>{
  const normalized=reviewPacket(context,rows,parseReviewPacket(JSON.stringify(packet),context,rows));
  const old=read();if(old&&same(old.packet,normalized))return old;
  if((old?.revision||0)!==expectedRevision)throw new Error(DRAFT_CONFLICT);
  const result={packet:normalized,revision:expectedRevision+1,updatedAt:new Date().toISOString()};
  storage.setItem(key,JSON.stringify(result));return checked(result,context,rows);
 }};
}
export function cloudDraftStore(context:ReviewContext,rows:CommentResult[],client:SupabaseClient<Database>):DraftStore {
 if(context.synthetic)throw new Error('演示标注不能写入真实草稿。');
 const result=(data:unknown)=>{const d=data as {packet:ReviewPacket;revision:number;updated_at:string};return checked({...d,updatedAt:d?.updated_at},context,rows);};
 return {load:async()=>{
  const response=await client.from('comment_review_drafts').select('packet,revision,updated_at').eq('project_id',context.projectId).eq('scope_hash',context.scopeHash).maybeSingle();
  if(response.error)throw new Error('草稿无法读取，请检查登录和项目权限后重试；当前标注未改变。');
  return response.data?result(response.data):null;
 },save:async(packet,expectedRevision)=>{
  parseReviewPacket(JSON.stringify(packet),context,rows);
  const response=await client.rpc('save_comment_review_draft',{target_project:context.projectId,target_scope:context.scopeHash,expected_revision:expectedRevision,draft_packet:packet as unknown as Database['public']['Tables']['comment_review_drafts']['Row']['packet']});
  if(response.error){if(response.error.message.includes('REVIEW_DRAFT_CONFLICT'))throw new Error(DRAFT_CONFLICT);throw new Error('草稿保存尚未确认。请保留页面和 JSON 备份，再点击保存确认；相同标注不会重复增加版本。');}
  return result(response.data);
 }};
}
