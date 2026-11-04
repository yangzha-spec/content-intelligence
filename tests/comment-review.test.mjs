import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyze } from '../src/lib/analytics.ts';
import { demoData } from '../src/lib/demo-data.ts';
import { createReviewContext, evaluationMarkdown, fixedReviewSample, mergeReviews, parseReviewPacket, reviewCsv, reviewEvaluation, reviewPacket, validateAnnotations } from '../src/lib/comment-review.ts';
import { exampleReviews } from '../src/lib/review-examples.ts';
const row=(id,label,topics=[])=>({id,content_post_id:'post',text:`Synthetic ${id}`,sample_type:'top',status:label==='unknown'?'unknown':'success',label,topics,evidence:[],method:'lexicon_zh_en_v1'});
const rows=[row('p1','positive',['内容质量']),row('p2','unknown'),row('n1','positive',['价格与成本']),row('n2','negative',['产品体验']),row('neutral','neutral'),row('uncertain','unknown',['教程需求']),row('unreviewed','negative')];
const annotation=(id,label,topics=null)=>({commentId:id,label,topics,note:'',reviewer:'Reviewer A',reviewedAt:'2026-11-04T01:00:00.000Z',origin:'manual'});
const annotations=[annotation('p1','positive',['内容质量','教程需求']),annotation('p2','positive',[]),annotation('n1','negative',[]),annotation('n2','negative'),annotation('neutral','neutral'),annotation('uncertain','uncertain',['教程需求'])];
const filters={platform:'youtube',profile:'test',start:'2026-10-01',end:'2026-10-31',metric:'views',topic:'',timezone:'Asia/Shanghai'};
const analysis=(input=rows)=>({comments:{rows:input},filters,sourceRevision:'synthetic-review-test'});
const approx=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`);

test('review scope is order-independent and binds project, exact text, filters, methods, predictions and source revision',async()=>{
 const a=await createReviewContext(analysis(),'project-a',true);
 assert.equal(a.scopeHash.length,64);assert.equal((await createReviewContext(analysis([...rows].reverse()),'project-a',true)).scopeHash,a.scopeHash);
 for(const [input,project,synthetic] of [[analysis(),'project-b',true],[{...analysis(),sourceRevision:'changed'},'project-a',true],[{...analysis(),filters:{...filters,topic:'changed'}},'project-a',true],[analysis(rows.map((r,i)=>i? r:{...r,text:r.text+'!'})),'project-a',true],[analysis(rows.map((r,i)=>i? r:{...r,method:'other'})),'project-a',true],[analysis(rows.map((r,i)=>i? r:{...r,label:'negative'})),'project-a',true],[analysis(),'project-a',false]])assert.notEqual((await createReviewContext(input,project,synthetic)).scopeHash,a.scopeHash);
});
test('review context rejects duplicate comment identities',async()=>{await assert.rejects(createReviewContext(analysis([rows[0],rows[0]]),'p',true),/编号重复/);});
test('empty review scores remain unavailable rather than showing perfect accuracy',()=>{const e=reviewEvaluation(rows,[]);assert.equal(e.agreement,null);assert.equal(e.macroF1,null);assert.equal(e.topics.f1,null);assert.equal(e.unreviewed,7);});
test('abstentions, human uncertainty and unreviewed rows have distinct denominators',()=>{
 const e=reviewEvaluation(rows,annotations);assert.equal(e.reviewed,6);assert.equal(e.eligible,5);assert.equal(e.uncertain,1);assert.equal(e.unreviewed,1);assert.equal(e.abstained,1);assert.equal(e.covered,4);assert.equal(e.correct,3);approx(e.agreement,.6);approx(e.coverage,.8);approx(e.selectiveAgreement,.75);
 assert.deepEqual(e.confusion.map(r=>r.counts),[[1,0,0,1],[1,1,0,0],[0,0,1,0]]);assert.deepEqual(e.disagreements,['p2','n1']);
});
test('class metrics count rule abstentions as misses and macro-average only supported human classes',()=>{
 const e=reviewEvaluation(rows,annotations);approx(e.classes[0].f1,.5);approx(e.classes[1].f1,2/3);approx(e.classes[2].f1,1);approx(e.macroF1,(.5+2/3+1)/3);assert.equal(e.macroClasses,3);
 const only=reviewEvaluation(rows,[annotation('p1','positive')]);assert.equal(only.macroClasses,1);assert.equal(only.classes[1].f1,null);assert.equal(only.classes[1].recall,null);assert.equal(only.macroF1,1);
});
test('multi-label topics distinguish no topic from not reviewed and accept independent uncertain-sentiment review',()=>{
 const e=reviewEvaluation(rows,annotations);assert.equal(e.topics.reviewed,4);assert.equal(e.topics.tp,2);assert.equal(e.topics.fp,1);assert.equal(e.topics.fn,1);approx(e.topics.exactMatch,.5);approx(e.topics.f1,2/3);
 const empty=reviewEvaluation([row('x','neutral')],[annotation('x','neutral',[])]);assert.equal(empty.topics.exactMatch,1);assert.equal(empty.topics.f1,null);
});
test('JSON checkpoint round-trips without copying raw comment text',async()=>{
 const context=await createReviewContext(analysis(),'p',true);const packet=reviewPacket(context,rows,annotations);const text=JSON.stringify(packet);
 assert.ok(!text.includes(rows[0].text));const restored=parseReviewPacket(text,context,rows);assert.equal(restored.length,6);assert.equal(restored.find(a=>a.commentId==='p1').label,'positive');assert.equal(restored.find(a=>a.commentId==='p2').topics.length,0);assert.equal(restored.find(a=>a.commentId==='n2').topics,null);
 const changed=await createReviewContext(analysis(),'another',true);assert.throws(()=>parseReviewPacket(text,changed,rows),/不一致/);
});
test('malformed, duplicate, off-scope and invalid annotation records are rejected atomically',async()=>{
 const context=await createReviewContext(analysis(),'p',true);
 for(const invalid of [[annotations[0],annotations[0]],[{...annotations[0],commentId:'other'}],[{...annotations[0],label:'unknown'}],[{...annotations[0],reviewer:' '}],[{...annotations[0],reviewedAt:'yesterday'}],[{...annotations[0],reviewedAt:'2026-02-31T01:00:00.000Z'}],[{...annotations[0],topics:['未知主题']}],[{...annotations[0],topics:['内容质量','内容质量']}],[{...annotations[0],note:'x'.repeat(241)}]])assert.throws(()=>validateAnnotations(invalid,context,rows));
 assert.throws(()=>parseReviewPacket('not json',context,rows),/JSON/);assert.throws(()=>parseReviewPacket('null',context,rows));
 const real=await createReviewContext(analysis(),'p',false);assert.throws(()=>validateAnnotations([{...annotations[0],origin:'example'}],real,rows));
});
test('file merging is idempotent and rejects conflicting labels without overwriting either input',()=>{
 const original=[annotations[0]];assert.equal(mergeReviews(original,original).length,1);assert.equal(mergeReviews(original,[annotations[1]]).length,2);
 assert.throws(()=>mergeReviews(original,[{...annotations[0],label:'negative'}]),/冲突/);assert.equal(original[0].label,'positive');
});
test('fixed review queue selection is stable, bounded and independent of input order',()=>{
 const input=Array.from({length:123},(_,i)=>row(`id-${String(i).padStart(3,'0')}`,'unknown'));const selected=fixedReviewSample(input);assert.equal(selected.length,60);assert.equal(new Set(selected).size,60);assert.deepEqual(selected,fixedReviewSample([...input].reverse()));assert.equal(fixedReviewSample(rows).length,7);assert.deepEqual(fixedReviewSample([],60),[]);assert.deepEqual(fixedReviewSample(rows,0),[]);
});
test('CSV exports neutralize formula prefixes in raw text and reviewer notes',()=>{
 const csv=reviewCsv([{...rows[0],text:'=HYPERLINK("evil")'}],[{...annotations[0],note:'@malicious',reviewer:'+name'}]);assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes("'=HYPERLINK"));assert.ok(csv.includes("'@malicious"));assert.ok(csv.includes("'+name"));
});
test('teaching labels are explicit semantic examples and never copied from classifier predictions',async()=>{
 const a=analyze(demoData(),{...filters,profile:'synthetic_youtube_v1'});const examples=exampleReviews(a.comments.rows);assert.equal(examples.length,4);assert.ok(examples.every(a=>a.origin==='example'));assert.ok(examples.some(example=>a.comments.rows.find(r=>r.id===example.commentId).label!==example.label));
 const context=await createReviewContext(a,'synthetic-project',true);const report=evaluationMarkdown(context,a.comments.rows,examples);assert.ok(report.includes('不代表真实模型效果'));assert.ok(report.includes('SHA-256'));assert.ok(report.includes('不是作者签名'));assert.ok(!report.includes(a.comments.rows[0].text));
});
