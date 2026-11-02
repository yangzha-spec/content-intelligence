# Content Intelligence

面向新媒体运营与品牌分析的内容表现、评论洞察与 AI 运营建议平台。

## 当前进度

项目处于数据库与仓库初始化阶段，尚无可启动的网页应用。
Supabase 项目已连接，P0 的 8 张业务表与权限策略已在云端创建并验证。

- 已保存原始 V1.0 数据规范，作为需求参考。
- 已在云端创建 P0 的 8 张业务表及访问权限策略。
- 已规划后续 6 张分析与报告表，包含原规范清单遗漏的 `analysis_results`。
- 数据库测试使用本地 PostgreSQL 引擎 PGlite，不连接真实用户数据。
- 已提供云端建表前后使用的只读检查脚本，见 `supabase/checks/`。
- 云端角色隔离测试通过；使用合成数据并在事务结束时全部回滚。
- 已从云端生成 TypeScript 数据库类型，见 `src/types/database.ts`。

## 文档

- [原始数据规范](docs/Content_Intelligence_数据字典与数据处理规范_V1.0.md)
- [数据库设计与决策](docs/database-design.md)
- [Supabase 创建与接入](docs/supabase-setup.md)
- [开发阶段与验收](docs/implementation-plan.md)
- [变更记录](CHANGELOG.md)

## 本地验证

需要 Node.js 22 或更高版本。

```sh
npm ci
npm test
```

测试会在内存中创建 PostgreSQL 数据库，模拟 Supabase Auth 的用户、角色和 `auth.uid()`，
执行真实迁移 SQL，并验证外键、去重、NULL、工作空间隔离与角色权限。
这不能代替云端 Supabase Auth、Storage 和 API 的联调验收。

## 数据库文件

```text
supabase/migrations/20261102104358_core_schema.sql
supabase/migrations/20261102104754_harden_rls_and_fk_indexes.sql
```

这些文件已经在当前项目执行，**不要在当前项目重新运行**；重放仅用于新建空数据库。
后续结构变更新增迁移文件，不修改已经在共享数据库执行的迁移。
详细执行步骤见 [Supabase 接入指南](docs/supabase-setup.md)。

## 数据与密钥

将 `.env.example` 复制为本地 `.env.local` 后填写配置。
当前工作目录已配置项目 URL 与 publishable key；该本地文件不提交。
真实密钥、原始 CSV/XLSX、评论文件、导出报告及数据库备份不进入版本库。
原始数据将存放于私有 Storage；目前尚未创建 Bucket 或实现上传接口。

## 下一阶段

数据库准备完成；下一阶段实现：
创建项目 → 上传 CSV/XLSX → 字段映射与校验 → 导入预览 → 确认入库 → 基础统计。
