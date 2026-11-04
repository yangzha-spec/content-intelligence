export type AiCallUsage={user_daily_limit:number;global_daily_limit:number;concurrency_limit:number;used_today:number;remaining_today:number;resets_at:string;day_timezone:'UTC'};
export const AI_DEFAULT_LIMITS={user:5,global:20,concurrent:1,outputTokens:1200,timeoutSeconds:45};
export const AI_STATE_NAMES:Record<string,string>={not_requested:'统计与规则建议',generated:'AI 辅助行动建议',failed:'AI 未完成 · 保留规则建议',uncertain:'调用结果未确认 · 保留规则建议'};
