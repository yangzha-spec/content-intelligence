# 导入与分析服务

`import-batch/index.ts` 是经过用户 JWT 鉴权的 Supabase Edge Function，保持 `verify_jwt=true`。
依赖由该函数目录的 `deno.json` 固定版本。部署时必须同时包含以下相对依赖：

```text
supabase/functions/import-batch/index.ts
supabase/functions/import-batch/deno.json
src/types/database.ts
src/lib/import-model.ts
src/lib/import-parser.ts
src/lib/import-validation.ts
src/lib/import-contract.ts
src/lib/import-service.ts
```

使用 Supabase 部署工具，将入口与 import map 分别指定为前两个文件。更新共享解析或校验代码时，必须一起重新部署函数。
环境使用平台自带的 `SUPABASE_URL`、`SUPABASE_ANON_KEY`；每次调用显式携带用户 JWT，不使用 service_role。
允许的浏览器来源为已发布站点与 localhost/127.0.0.1 的 3000 端口，新增正式域名时显式更新允许列表。

接口只接受 `POST {"batch_id":"UUID","action":"validate|commit"}`。`validate` 不写业务记录；`commit` 重新复核后调用单事务 RPC。
详情和验收边界见 [第三部分说明](../../docs/part-3-acceptance.md)。

## 分析服务

`analyze-project` 保持 `verify_jwt=true`，使用调用用户 JWT 读取项目，服务器重新计算，不接受浏览器提供的统计结果或源记录。
部署入口与 import map 为前两个文件，并同时包含以下依赖：

```text
supabase/functions/analyze-project/index.ts
supabase/functions/analyze-project/deno.json
src/types/database.ts
src/lib/analytics.ts
src/lib/analysis-report.ts
src/lib/analysis-service.ts
src/lib/ai-insights.ts
src/lib/ai-controls.ts
src/lib/ai-control-status.ts
src/lib/import-contract.ts
src/lib/import-model.ts
src/lib/import-validation.ts
```

`POST {"action":"status"}` 返回可选 AI 是否启用、控制可用状态和当前用户的 UTC 今日次数；运行接口使用 `action: "run"`、`project_id`、`run_id`、`filters`、`use_ai`、`consent`。
运行标识用于失败重试和去重；真实源数据、输入快照、规则结果和报告通过 SECURITY INVOKER RPC 原子保存。
除平台 URL/anon key 外无需高权限密钥。可选 AI 只在服务端同时设置 `OPENAI_API_KEY`、`OPENAI_MODEL` 和 `AI_ENABLED=true`；缺失配置时关闭，用户明确确认本次发送与费用后才调用。
发送的只是统计摘要和主题计数，未配置时核心流程照常使用规则建议。当前未进行真实付费模型调用；次数/并发预约/检查点控制已实现，真实计费、效果和跨实例 HTTP 并发仍待实际接入验收。
调用控制依赖 `20261104064510_ai_call_controls.sql`。应用层每个请求只进行一次外部 HTTP 尝试，429/进行中返回可读错误与 Retry-After；缓存恢复不再次调用模型。
详情见 [第七部分](../../docs/part-7-acceptance.md)。
详情见 [第四部分说明](../../docs/part-4-acceptance.md)。
