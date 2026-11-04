import { validateFilters,type Filters } from './analytics.ts';
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
export type PendingAnalysis={runId:string;useAi:boolean;filters:Filters;createdAt:string};
type SessionStore=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
const key=(project:string,actor:string)=>`ci-pending-analysis:${actor}:${project}`;
export function rememberAnalysis(project:string,actor:string,pending:PendingAnalysis,store:SessionStore){
 if(!uuid(project)||!uuid(actor)||!uuid(pending.runId)||typeof pending.useAi!=='boolean'||!Number.isFinite(Date.parse(pending.createdAt)))throw new Error('恢复请求参数无效。');
 const filters=validateFilters(pending.filters,pending.filters.timezone);
 store.setItem(key(project,actor),JSON.stringify({schema:1,...pending,filters}));
}
export function recoverAnalysis(project:string,actor:string,timezone:string,store:SessionStore,now=Date.now()):PendingAnalysis|null{
 try{const text=store.getItem(key(project,actor));if(!text||text.length>6000)return null;const p=JSON.parse(text);const age=now-Date.parse(p.createdAt);
 if(p.schema!==1||!uuid(p.runId)||typeof p.useAi!=='boolean'||typeof p.createdAt!=='string'||!Number.isFinite(age)||age<0||age>7*86400000)return null;
 return {runId:p.runId,useAi:p.useAi,filters:validateFilters(p.filters,timezone),createdAt:p.createdAt};
 }catch{return null;}
}
export function forgetAnalysis(project:string,actor:string,store:SessionStore){store.removeItem(key(project,actor));}
