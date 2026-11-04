'use client';
import { AI_DEFAULT_LIMITS,type AiCallUsage } from '@/lib/ai-control-status';
import { Icon } from './icon';
export default function AiUsagePanel({preview,configured,available,usage,checking,onRefresh}:{preview:boolean;configured:boolean;available:boolean;usage:AiCallUsage|null;checking:boolean;onRefresh:()=>void}){
 const user=usage?.user_daily_limit??AI_DEFAULT_LIMITS.user,global=usage?.global_daily_limit??AI_DEFAULT_LIMITS.global,concurrent=usage?.concurrency_limit??AI_DEFAULT_LIMITS.concurrent;
 return <section className="ai-usage-panel" aria-label="AI 调用限制与恢复"><div className="ai-usage-heading"><div><span className="eyebrow section-eyebrow">CALL WITH LIMITS</span><h2>每一次调用，都先确认。</h2></div><span className="analysis-tag">{preview?'合成演示 · 不调用模型':configured?'服务已启用 · 按需确认':'外部 AI 未启用'}</span></div>
  <p className="ai-usage-intro">统计、评论规则初筛和报告不依赖付费模型。启用外部 AI 前，先核对发送范围、调用次数和当前状态。</p>
  <div className="ai-limit-grid"><article><Icon name="bubble" size={18}/><b>{user}<small> 次 / 人 / 天</small></b><span>{preview?'默认策略，不展示真实用量':usage?`今日已预约 ${usage.used_today} 次，剩余 ${usage.remaining_today} 次`:'用量尚未读取，不显示为零'}</span></article><article><Icon name="layers" size={18}/><b>{global}<small> 次 / 应用 / 天</small></b><span>跨用户、跨项目共用应用上限</span></article><article><Icon name="lock" size={18}/><b>{concurrent}<small> 个进行中的预约</small></b><span>先取得数据库预约，再发起外部调用</span></article></div>
  <div className="ai-recovery-steps"><p><b>同一请求，复用结果</b><span>已完成的行动建议先保存为检查点；报告写入失败后，用同一请求恢复，不重新调用模型。</span></p><p><b>结果不明，停止重发</b><span>网络超时或中断后不自动重发；保留请求状态，规则建议照常可用。失败和未确认的预约不退回次数。</span></p><p><b>汇总发送，限制输出</b><span>只发送汇总统计；请求体最多 16 KiB、输出最多 {AI_DEFAULT_LIMITS.outputTokens} tokens，等待最多 {AI_DEFAULT_LIMITS.timeoutSeconds} 秒。</span></p></div>
  <div className="ai-usage-foot"><p>{preview?'演示不会查询真实账户用量，不发起外部模型请求。':!available?'调用控制暂不可用；此时不允许开始新的模型调用。':usage?`按 UTC 计日，下次重置：${new Date(usage.resets_at).toLocaleString('zh-CN')}。`:'正在读取用量…'}</p><button className="secondary-button" disabled={preview||checking} onClick={onRefresh}>{checking?'读取中…':'刷新调用状态'}</button></div><p className="ai-budget-note">次数与输出限制不等于金额预算。模型价格和其他调用仍由服务商侧管理；上线付费模型前需另行设置预算并完成实测。</p>
 </section>;
}
