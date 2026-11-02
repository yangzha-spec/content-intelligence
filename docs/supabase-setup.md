# Supabase 创建与接入

当前尚未创建或连接云端项目，以下为下一步操作。

## 1. 创建项目

1. 登录 [Supabase Dashboard](https://supabase.com/dashboard)，选择组织并创建项目。
2. 项目名填写 `content-intelligence`。
3. 设置数据库密码并自行妥善保存；不要发到聊天或提交到 GitHub。
4. 选择合适地区，等待项目状态就绪。

创建完成后可提供项目页面链接或项目 URL，用于确认目标；无需发送数据库密码或高权限密钥。

## 2. 执行初始迁移

仅在**新建空项目**执行。已有表的数据库须先检查结构并另写增量迁移。

在 Supabase SQL Editor 打开新查询，将以下文件的完整内容粘贴进去，运行一次：

```text
supabase/migrations/20261102000100_core_schema.sql
```

文件自带事务；失败时不要删表重试，应先查看错误并修正原因。
成功后 Table Editor 的 `public` 模式应有 8 张业务表。
后续如切换为 Supabase CLI 管理，需将这次已执行迁移登记为 applied，避免再次执行同一文件；
本阶段没有配置本地完整 Supabase 栈，也没有要求执行 `supabase db reset`。

## 3. 配置本地环境

复制仓库 `.env.example` 为 `.env.local`，在本地填写：

```dotenv
NEXT_PUBLIC_SUPABASE_URL=项目URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=项目的publishable_key
SUPABASE_SECRET_KEY=仅在服务端确有需要时填写
```

前端可使用 publishable key，并配合用户登录与 RLS；secret key 只允许服务端使用。
尚未创建网页应用，本阶段填写环境变量不会启动任何服务。

## 4. 云端验证

SQL Editor 通常以高权限角色执行，能查到数据不代表普通用户权限已验证。
通过登录用户调用 Data API，至少验证：

- A 用户创建工作空间后，可读到自己的空间和 owner 成员记录。
- B 用户未加入 A 空间时，读不到 A 的项目、内容、指标或评论，也不能写入。
- A 将 B 加为 viewer 后，B 可以读取，写入失败。
- 将 B 调整为 editor 后，B 可写项目数据，但不能添加成员或删除项目。
- 原始文件上传功能上线前，完成下述 Storage 配置与隔离测试。

## 5. 原始文件存储：待实现，上传功能的前置条件

后续增加迁移，创建 **private** 的 `raw-imports` Bucket，并限制上传大小和文件类型。
对象名使用系统生成 ID，可按 `<project_id>/<batch_id>/<file_uuid>.<ext>` 组织。
通过 Storage RLS 根据路径中的项目 ID 校验工作空间权限；无法归属的路径默认拒绝。
报告使用单独的私有 Bucket，按项目权限下载。

当前迁移只创建业务表，**不创建 Bucket，也不授予 Storage 访问权限**。
上传解析、事务提交和文件清理均未实现。完成这些步骤前，不上传真实评论数据。

## 官方说明

- [数据库迁移](https://supabase.com/docs/guides/local-development/database-migrations)
- [行级权限 RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [API Keys](https://supabase.com/docs/guides/getting-started/api-keys)
