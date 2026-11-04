import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, aggregate, classifyComment, validateFilters } from '../src/lib/analytics.ts';
import { demoData, complexCsvFiles } from '../src/lib/demo-data.ts';
import { analysisMarkdown, reportHtml, rankingCsv } from '../src/lib/analysis-report.ts';
import { enrichActions } from '../src/lib/ai-insights.ts';
const filters = { platform:'youtube', profile:'test_v1', start:'2026-10-01', end:'2026-10-03', metric:'views', topic:'', timezone:'Asia/Shanghai' };
const post = { id:'p1', content_key:'p1', platform:'youtube', title:'Synthetic', content_type:'video', topic:'测试', publish_time:'2026-10-01T02:00:00Z',source_batch_id:'b1' };
const metric = { id:'m1', content_post_id:'p1', snapshot_time:'2026-10-02T02:00:00Z', snapshot_type:'cumulative',metric_profile:'test_v1',source_batch_id:'b1',views:'10',likes:'0',comments_count:null,shares:null,saves:null,impressions:null,reach:null };
const source = (metrics=[metric],posts=[post],comments=[]) => ({posts,metrics,comments,revision:'test',captured_at:'2026-11-04T00:00:00Z',timezone:'Asia/Shanghai'});
test('latest cumulative snapshots are selected once, excluding future and other definitions',()=>{
 const a=analyze(source([metric,{...metric,id:'m2',snapshot_time:'2026-10-03T02:00:00Z',views:'30'},{...metric,id:'m3',snapshot_time:'2026-10-04T02:00:00Z',views:'90'},{...metric,id:'m4',metric_profile:'other',views:'999'}]),filters);
 assert.equal(a.metrics.views.sum,'30');assert.equal(a.selectedSnapshotCount,1);assert.equal(a.daily.at(-1).value,'30');assert.equal(a.daily[0].value,null);
});
test('latest NULL is not backfilled with an older value or changed to zero',()=>{
 const a=analyze(source([metric,{...metric,id:'m2',snapshot_time:'2026-10-03T02:00:00Z',views:null}]),filters);
 assert.equal(a.metrics.views.sum,null);assert.equal(a.metrics.views.valid,0);assert.equal(a.metrics.likes.sum,'0');
});
test('BIGINT sums and averages retain precision and missing observations leave the denominator',()=>{
 const a=aggregate(['9223372036854775807','1',null]);assert.equal(a.sum,'9223372036854775808');assert.equal(a.mean,'4611686018427387904.00');assert.equal(a.median,'4611686018427387904.00');assert.equal(a.valid,2);assert.equal(a.missing,1);
 assert.equal(aggregate([null]).sum,null);assert.equal(aggregate([]).missingRate,null);
});
test('all-platform view never mixes incompatible platform metrics',()=>{
 const a=analyze(source([metric],[post,{...post,id:'p2',platform:'weibo'}]),{...filters,platform:''});assert.equal(a.postCount,2);assert.equal(a.metrics.views.sum,null);assert.equal(a.selectedSnapshotCount,0);
});
test('dates use the project time zone, not the browser local zone',()=>{
 const a=analyze(source([], [{...post,publish_time:'2026-09-30T16:30:00Z'}]),{...filters,start:'2026-10-01',end:'2026-10-01'});assert.equal(a.postCount,1);assert.equal(a.daily[0].posts,1);
 assert.throws(()=>validateFilters({...filters,end:'2028-01-01'},'Asia/Shanghai'),/日期/);
});
test('pre-publication observations and period snapshots cannot enter cumulative totals',()=>{
 const a=analyze(source([{...metric,snapshot_time:'2026-09-01T00:00:00Z'},{...metric,id:'m2',snapshot_type:'period'}]),filters);assert.equal(a.metrics.views.sum,null);assert.equal(a.missingSnapshots,1);
});
test('unknown, negated and mixed comments remain unknown, separate from valid sentiment denominator',()=>{
 const comments=['感谢，教程很实用','价格太贵','一般','不喜欢','喜欢但是太贵','没有明显情绪的记录'].map((text,i)=>({id:`c${i}`,content_post_id:'p1',comment_text:text,comment_time:null,sample_type:'top',source_batch_id:'b1'}));
 const a=analyze(source([metric],[post],comments),filters);assert.equal(a.comments.total,6);assert.equal(a.comments.analyzed,3);assert.equal(a.comments.unknown,3);assert.equal(a.comments.negativeShare,1/3);assert.ok(a.warnings.some(w=>w.includes('不能代表')));
});
test('comment date filters retain unknown dates with a warning and exclude explicitly future comments',()=>{
 const c={id:'c',content_post_id:'p1',comment_text:'有用',comment_time:'2026-11-01T00:00:00Z',sample_type:'all',source_batch_id:'b'};const a=analyze(source([metric],[post],[c,{...c,id:'c2',comment_time:null}]),filters);assert.equal(a.comments.total,1);assert.ok(a.warnings.some(w=>w.includes('缺少时间')));
});
test('multi-label topics may exceed one hundred percent and retain hit evidence',()=>{
 const c=classifyComment({id:'c',content_post_id:'p',comment_text:'教程步骤很清晰，希望增加功能',comment_time:null,sample_type:'all',source_batch_id:'b'});assert.ok(c.topics.length>1);assert.ok(c.evidence.includes('清晰'));
});
test('complex demo is reproducible and its CSVs contain multiple platforms and complete snapshots',()=>{
 const a=demoData();assert.equal(a.posts.length,360);assert.equal(a.metrics.length,1080);assert.equal(a.comments.length,2400);assert.deepEqual(a,demoData());assert.equal(new Set(a.posts.map(p=>p.platform)).size,3);assert.ok(complexCsvFiles().Metrics.includes('synthetic_youtube_v1'));
});
test('reports label synthetic data and escape embedded HTML and CSV formula prefixes',()=>{
 const a=analyze(source([metric],[{...post,title:'<script>alert(1)</script>'}]),filters);assert.match(analysisMarkdown(a,'演示',true),/合成数据/);assert.ok(!reportHtml(a,'<img onerror=alert(1)>',true).includes('<script>'));assert.match(rankingCsv({...a,ranking:[{...a.ranking[0],title:'=HYPERLINK("x")'}]}),/'=HYPERLINK/);
});
test('optional AI receives aggregate facts only and cannot change evidence, observations or numbers',async()=>{
 const a=analyze(source([metric],[{...post,title:'Private secret title'}]),filters);let prompt='';
 const enriched=await enrichActions(a,{apiKey:'test-key',model:'test-model'},async(url,opts)=>{prompt=opts.body;return new Response(JSON.stringify({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({actions:a.insights.map(i=>({id:i.id,action:'人工复核后提炼表达，并在后续内容中验证。'}))})}]}]}));});
 assert.ok(!prompt.includes('Private secret title'));assert.deepEqual(enriched.insights.map(i=>i.evidence),a.insights.map(i=>i.evidence));assert.equal(enriched.metrics.views.sum,a.metrics.views.sum);
 await assert.rejects(enrichActions(a,{apiKey:'test-key',model:'test-model'},async()=>new Response(JSON.stringify({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({actions:a.insights.map(i=>({id:i.id,action:'提升 50%'}))})}]}]}))),/AI_INVALID/);
});
