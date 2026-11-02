# Supabase 创建与接入

项目已连接，P0 的 8 张业务表已创建。数据库结构、角色隔离、公开密钥连接和匿名拒绝访问检查均已通过。

- 管理页面：<https://supabase.com/dashboard/project/zzepibrwxkcyekufoezn>
- API URL：<https://zzepibrwxkcyekufoezn.supabase.co>
- 项目 ID：`zzepibrwxkcyekufoezn`。上述地址不是数据库访问凭据。

## 1. 项目已创建

1. 登录 [Supabase Dashboard](https://supabase.com/dashboard)，选择组织并创建项目。
2. 项目名填写 `content-intelligence`。
3. 设置数据库密码并自行妥善保存；不要发到聊天或提交到 GitHub。
4. 选择合适地区，等待项目状态就绪。

创建完成后可提供项目页面链接或项目 URL，用于确认目标；无需发送数据库密码或高权限密钥。

## 2. 已执行的迁移

当前项目已执行下列两个迁移，**不要在当前项目重新运行**：

| 云端版本 | 名称 | 内容 |
|---|---|---|
| `20261102104358` | `core_schema` | 8 张业务表、外键、去重、RLS 与成员角色 |
| `20261102104754` | `harden_rls_and_fk_indexes` | 收紧自动 RLS 函数执行权限、补充 7 个关联索引 |

本地文件名已与云端迁移版本对齐。后续增量变更新增文件，不修改已执行的文件。

### 在另一个新建空项目重放时

仅在**新建空项目**执行。已有表的数据库须先检查结构并另写增量迁移。

先通过插件的只读 SQL 或 SQL Editor 运行 `supabase/checks/01_preflight.sql`，
确认 `public` 与 `private` 没有已有业务对象，且 Auth 基础对象和角色存在。
如发现已有对象，停止初始化并检查，不能直接重跑或覆盖。

确认是空项目后，在 Supabase SQL Editor 打开新查询，将以下文件的完整内容粘贴进去，运行一次：

```text
supabase/migrations/20261102104358_core_schema.sql
supabase/migrations/20261102104754_harden_rls_and_fk_indexes.sql
```

文件自带事务；失败时不要删表重试，应先查看错误并修正原因。
成功后运行 `supabase/checks/02_schema_verification.sql`，核对 8 张业务表、RLS、授权、策略和外键。
该只读脚本不查询用户原始数据，也不能替代真实登录用户的 API 权限测试。
通过插件执行已在云端登记迁移历史；切换 CLI 时先核对 migration list，不能把这些迁移当作未执行再次提交。
本阶段没有配置本地完整 Supabase 栈，也没有要求执行 `supabase db reset`。

## 3. 配置本地环境

复制仓库 `.env.example` 为 `.env.local`，在本地填写：

当前工作目录已经填写项目 URL 与 publishable key，不含高权限 secret key。换电脑时再按此步骤配置。

```dotenv
NEXT_PUBLIC_SUPABASE_URL=项目URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=项目的publishable_key
SUPABASE_SECRET_KEY=仅在服务端确有需要时填写
```

前端可使用 publishable key，并配合用户登录与 RLS；secret key 只允许服务端使用。
网页应用已发布；公开配置用于前端构建，导入服务位于 Supabase Edge Functions。

## 4. 验证结果与后续验收

2026-11-02 已完成：

- 本地 25 项数据库测试全部通过。
- 云端 8 张业务表均启用 RLS，均有 4 条操作策略，匿名角色没有表读取权限。
- `supabase/checks/03_rls_smoke.sql` 在事务中模拟用户验证非成员隔离、viewer/editor 权限与 NULL/0，
  合成用户及业务行全部回滚；核对后数据库中没有留下测试记录。
- 使用本地 publishable key，Auth settings API 返回 200，匿名读取内容表被 Data API 拒绝。
- 阶段 0 的安全检查无告警，性能检查仅有新库索引尚未使用的信息提示。第三部分复查未发现数据库/Storage 策略告警；Auth 另有未启用泄露密码检测的提示，当前未修改该设置。
- 已生成 `src/types/database.ts`。如数据库结构后续变化，应重新生成。

可通过 `npm run check:connection` 复查公开密钥连接与匿名拒绝访问。
该命令不会创建用户或写入数据，也不会打印密钥。

仍待应用阶段完成：真实用户登录后的 Data API、Storage 上传权限、文件导入与删除流程。
当前未额外授予 `service_role` 业务表权限；后续如确需高权限后台作业，再单独明确范围与授权。

SQL Editor 通常以高权限角色执行，能查到数据不代表普通用户权限已验证。
通过登录用户调用 Data API，至少验证：

- A 用户创建工作空间后，可读到自己的空间和 owner 成员记录。
- B 用户未加入 A 空间时，读不到 A 的项目、内容、指标或评论，也不能写入。
- A 将 B 加为 viewer 后，B 可以读取，写入失败。
- 将 B 调整为 editor 后，B 可写项目数据，但不能添加成员或删除项目。
- 原始文件上传功能上线前，完成下述 Storage 配置与隔离测试。

## 5. 原始文件存储：第三部分已实现

第三个迁移已创建 **private** 的 `raw-imports` Bucket，并限制上传大小和文件类型。
对象名使用系统生成 ID，可按 `<project_id>/<batch_id>/<index>.<ext>` 组织。
通过 Storage RLS 根据路径中的项目 ID 校验工作空间权限；无法归属的路径默认拒绝。
报告使用单独的私有 Bucket，按项目权限下载。

Storage 策略要求对象路径匹配批次清单，并验证项目成员/编辑权限；原文件不允许客户端覆盖或删除。
`import-batch` Edge Function 和 `commit_import_batch` 事务接口已部署，未增加 service_role 权限。
真实账号上传、确认与下载仍待验收，先使用合成样本，见 [第三部分说明](part-3-acceptance.md)。
文件保留期限及删除项目时清理原文件的流程尚未实现。

## 官方说明

- [数据库迁移](https://supabase.com/docs/guides/local-development/database-migrations)
- [行级权限 RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [API Keys](https://supabase.com/docs/guides/getting-started/api-keys)
