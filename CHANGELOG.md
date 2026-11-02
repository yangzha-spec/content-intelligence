# 变更记录

## 0.1.0 — 2026-11-02

- 保存 Content Intelligence V1.0 原始数据规范。
- 准备 P0 的 8 张业务表、UUID 主键、组合外键、可空计数和快照约束。
- 配置 owner/editor/viewer 与工作空间 RLS。
- 明确项目内唯一内容键、评论推断指纹复核和导入事务边界。
- 提供本地 PostgreSQL 迁移与权限验证，以及 Supabase 创建和接入说明。
- 已连接 Supabase 项目 `zzepibrwxkcyekufoezn`，执行 2 个迁移，创建 8 张业务表。
- 修复平台自动 RLS 辅助函数的 API 执行权限，补充 7 个组合外键索引。
- 云端数据库角色隔离与 NULL/0 检查通过，合成用户和业务数据全部回滚。
- 本地自动测试增至 25 项；本地配置 publishable key，生成云端 TypeScript 类型。
- Storage、网页应用、真实用户登录与导入服务尚未接入。
