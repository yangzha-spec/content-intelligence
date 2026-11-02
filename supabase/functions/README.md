# 导入服务

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
