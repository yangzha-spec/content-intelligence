# 第一部分：登录与项目管理

## 范围

包含注册、密码登录、退出、密码找回与恢复页、工作空间初始化和切换、项目创建、
项目搜索排序、项目详情和窄屏导航。项目通过登录用户的 Supabase 会话直接读取和写入，
沿用已验证的工作空间 RLS，没有新增高权限角色授权。

不包含 CSV/Excel 上传、指标、评论分析、AI 洞察、项目编辑删除或团队邀请。
界面预览中的两个项目是明确标注的合成示例，不写入数据库；预览中点击创建会返回登录。

## 环境与邮件回跳

应用是 Next.js 静态导出。项目 URL 与 publishable key 在构建时进入客户端，
真正的数据访问由用户会话和数据库 RLS 控制。不要将 secret key 或 service_role key 配置为公开环境变量。

在 [Supabase Auth URL Configuration](https://supabase.com/dashboard/project/zzepibrwxkcyekufoezn/auth/url-configuration) 中核对：

- 生产 Site URL：`https://content-intelligence-yangzha.travisfrey5197.chatgpt.site`
- Redirect URLs 按实际使用添加：`http://localhost:3000/`、`http://127.0.0.1:3000/`、
  `https://content-intelligence-yangzha.travisfrey5197.chatgpt.site/`。
- 保留邮箱确认，不为测试关闭验证。默认邮件发送有速率限制，测试时避免反复发送。

该 Auth 设置尚未由本次代码修改代为更改。注册与找回密码都使用当前页面源地址作为回跳目标。
如果回跳目标未加入允许列表，Supabase 可能使用默认 Site URL；邮箱确认完成后可返回原页面登录。

## 验收步骤

1. 打开应用，先点击「浏览界面预览」，检查列表、搜索、详情和手机导航。
2. 回到登录页，自行注册并通过邮箱确认；密码不需要提供给开发助手。
3. 用邮箱和密码登录，首次使用时创建「我的内容工作空间」。
4. 点击创建项目，填写名称、可选品牌与说明。空白名称不得提交。
5. 创建成功进入详情，刷新后项目仍能打开；返回列表可搜索与排序。
6. 退出后回到登录页，再次登录应能读到已创建项目。
7. 用另一个已有成员账号确认 viewer 只读、editor 可创建；非成员无法查看项目。
8. 如需要测试密码找回，由用户在邮箱点击恢复链接并自行设置新密码。

## 已验证与待验证

- 本地数据库与输入校验共 29 项自动测试已通过；类型检查与生产构建已通过。
- 已在浏览器检查界面预览、搜索空态、详情链接和详情刷新。
- 数据库的 owner/editor/viewer 和非成员隔离已在前一阶段通过云端角色测试。
- 真实账号登录、创建项目、重登保留和邮件恢复，需要邮箱确认后完成应用端验收。
- 当前阶段未改动 Auth 邮件配置；此项应在正式使用前核对。

## 来源

- [Supabase 邮件密码登录](https://supabase.com/docs/guides/auth/passwords)
- [Supabase 重定向地址](https://supabase.com/docs/guides/auth/redirect-urls)
- [Next.js 静态导出](https://nextjs.org/docs/app/guides/static-exports)
