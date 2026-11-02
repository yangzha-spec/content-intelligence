# Content Intelligence

面向新媒体运营与品牌分析的内容表现、评论洞察与 AI 运营建议平台。

## 当前进度

已实现三部分：登录与项目管理、文件校验与预览、原文件私有保存与确认入库。
真实账号完整流程仍保留在验收清单中；演示项目可用合成示例独立体验预览，不会写库。
当前应用采用 Next.js + TypeScript 静态导出，浏览器通过 Supabase 用户会话访问数据库，由 RLS 限制项目权限。
Supabase 项目已连接，P0 的 8 张业务表与权限策略已在云端创建并验证。

- 已实现注册、密码登录、退出与密码重置入口。
- 已实现个人工作空间初始化、空间切换、项目创建、列表搜索排序与详情。
- 支持明确标注、不会写库的只读界面预览。
- 已实现 CSV / XLSX 本地读取、数据表类型指定、中英文字段映射、校验、预览和问题清单下载。
- 提供 Posts / Metrics / Comments 的空白 CSV 模板，以及通过/含错误两组合成示例。
- 已实现来源声明、原文件私有上传、服务器重新校验、整批入库、重复提交保护与导入历史。
- 登录真实项目后可确认入库；指标分析和 AI 洞察尚未开放。

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
- [第一部分验收说明](docs/part-1-acceptance.md)
- [第二部分验收说明](docs/part-2-acceptance.md)
- [第三部分验收说明](docs/part-3-acceptance.md)
- [变更记录](CHANGELOG.md)

## 本地启动与验证

需要 Node.js 22.18 或更高版本，当前开发环境为 Node.js 24。

```sh
npm ci
npm run dev
```

先将 `.env.example` 复制为 `.env.local` 并填写项目 URL 与 publishable key。
打开终端显示的地址（默认 `http://127.0.0.1:3000`），可以登录、注册或点击「浏览界面预览」。
注册需要完成邮箱确认；测试前按 [第一部分验收说明](docs/part-1-acceptance.md) 设置 Supabase 邮件回跳地址。

```sh
npm run typecheck
npm test
npm run build
npm run check:connection
```

测试会在内存中创建 PostgreSQL 数据库，模拟 Supabase Auth 的用户、角色和 `auth.uid()`，
执行真实迁移 SQL，并验证外键、去重、NULL、工作空间隔离与角色权限。
这不能代替真实用户登录与 Storage 上传的联调验收。`npm run build` 输出静态页面到 `out/`。
发布时 Supabase 的两个公开配置在构建阶段内联到客户端；高权限密钥不参与构建或客户端请求。

## 数据库文件

```text
supabase/migrations/20261102104358_core_schema.sql
supabase/migrations/20261102104754_harden_rls_and_fk_indexes.sql
supabase/migrations/20261102130205_import_commit_and_private_files.sql
```

这些文件已经在当前项目执行，**不要在当前项目重新运行**；重放仅用于新建空数据库。
后续结构变更新增迁移文件，不修改已经在共享数据库执行的迁移。
详细执行步骤见 [Supabase 接入指南](docs/supabase-setup.md)。

## 数据与密钥

将 `.env.example` 复制为本地 `.env.local` 后填写配置。
当前工作目录已配置项目 URL 与 publishable key；该本地文件不提交。
真实密钥、原始 CSV/XLSX、评论文件、导出报告及数据库备份不进入版本库。
原始数据存放于 private 的 raw-imports Bucket，项目成员可读取。服务器使用用户会话复核和入库，不使用高权限密钥。
原文件上传后会保留，包括失败批次；保留期限与管理员清理尚未实现。

## 下一阶段

进入项目详情，点击「上传并预览」进入四步导入流程。
下一步先用真实账号与内置合成样本完成上传、复核、入库、刷新和下载验收；确认闭环后再做内容表现分析。
服务器复核与浏览器预览都不等于已入库，只有批次显示「已入库」才表示本批事务完成。
