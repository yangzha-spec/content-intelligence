# Content Intelligence｜数据字典与数据处理规范 V1.0

> **文档用途：**作为 Content Intelligence（AI
> 内容增长与市场洞察平台）第一版的数据设计、数据导入、指标计算、文本分析和开发验收依据，可交给
> Codex 作为开发上下文。\
> **版本：**V1.0\
> **状态：**产品与技术设计稿；数据集字段、许可证和平台指标口径仍须在正式接入前逐项复核。\
> **产品定位：**面向新媒体运营、品牌营销和市场分析人员的内容数据分析与用户洞察平台。\
> **核心闭环：**内容数据导入 → 数据质量检查 → 内容表现分析 →
> 用户评论分析 → AI 辅助洞察 → 运营建议 → 后续效果验证。

------------------------------------------------------------------------

## 目录

1.  [产品目标与设计原则](#1-产品目标与设计原则)
2.  [数据范围与数据来源](#2-数据范围与数据来源)
3.  [数据实体与关系](#3-数据实体与关系)
4.  [标准导入工作簿](#4-标准导入工作簿)
5.  [字段字典](#5-字段字典)
6.  [平台适配与指标标准化](#6-平台适配与指标标准化)
7.  [指标定义与计算规则](#7-指标定义与计算规则)
8.  [数据清洗与质量控制](#8-数据清洗与质量控制)
9.  [评论分析与模型评价](#9-评论分析与模型评价)
10. [AI 洞察与建议生成规范](#10-ai-洞察与建议生成规范)
11. [数据库与技术架构建议](#11-数据库与技术架构建议)
12. [数据处理 Pipeline 与 API](#12-数据处理-pipeline-与-api)
13. [隐私、授权与数据安全](#13-隐私授权与数据安全)
14. [MVP 范围与开发优先级](#14-mvp-范围与开发优先级)
15. [验收标准](#15-验收标准)
16. [待核实事项](#16-待核实事项)
17. [参考数据集与资料](#17-参考数据集与资料)

------------------------------------------------------------------------

# 1. 产品目标与设计原则

## 1.1 产品目标

Content Intelligence 不只是一个社交媒体 Dashboard，也不是简单的 AI
文案生成器。第一版应实现一条可追溯的数据分析链路：

1.  用户创建品牌或内容分析项目。
2.  用户上传内容、指标和评论数据。
3.  系统检查数据格式、字段完整性、重复记录和关联关系。
4.  系统计算内容表现指标并展示趋势、分布和内容排名。
5.  系统对评论进行情感、主题和方面级分析。
6.  系统根据已经计算的统计结果生成有证据的运营洞察。
7.  用户可以导出分析报告，并在后续导入新数据验证策略变化。

## 1.2 第一版目标用户

-   新媒体运营人员：希望了解内容表现、用户反馈和选题方向。
-   品牌/市场人员：希望开展内容竞品分析、消费者反馈分析和传播复盘。
-   数据分析人员：希望通过统一的数据结构分析内容、评论和运营表现。

## 1.3 设计原则

### 原则 A：先计算，后生成

指标、计数、分组、趋势和模型评价必须由 SQL/Python 等确定性程序计算。LLM
只能解释已经计算出的结果，不能凭空生成数字或替代统计计算。

### 原则 B：原始数据可追溯

保留原始文件、原始字段、导入批次、字段映射和清洗记录。清洗后的数据不能覆盖唯一的原始来源。

### 原则 C：缺失值不等于零

-   `0`：明确观测到数值为零。
-   `NULL`：未知、未提供、不适用或无法获取。
-   `-1` 等平台特殊标记：根据平台文档转换为
    `NULL`，并记录缺失原因，不能当作真实数值。

### 原则 D：跨平台比较必须有口径

不同平台的播放量、阅读量、曝光量、收藏、分享等指标不一定同义。统一字段名称不代表统计定义相同。跨平台比较前必须核对指标定义、分母、采集时间、内容类型和覆盖范围。

### 原则 E：结论必须带证据和限制

每条 AI
洞察都应能够追溯到数据范围、指标、样本量和分析任务。样本不足、数据缺失或无法进行因果识别时，必须明确提示。

### 原则 F：第一版不依赖平台爬虫

MVP 以 CSV/Excel 导入为主。真实平台 API
自动同步、自动发布和竞品自动抓取暂不纳入第一版。

------------------------------------------------------------------------

# 2. 数据范围与数据来源

## 2.1 第一版数据实体

第一版围绕三类核心业务数据构建：

1.  **Posts：内容基本信息**------一行代表一篇内容。
2.  **Metrics：内容表现快照**------一行代表一篇内容在某个采集时间点的指标。
3.  **Comments：用户评论**------一行代表一条评论，并关联到对应内容。

同时，系统需要记录项目、账号、导入批次、分析任务和分析结果等管理数据。

## 2.2 候选数据集

以下数据集是开发和模型验证候选，不代表已完成全部授权核查。正式下载、公开展示或商业使用前，必须核对数据集原始页面、数据卡、许可证、平台条款和个人信息风险。

  ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  数据集               已知用途与结构（依据前期检索记录）                                               适合验证                                      限制与注意事项
  -------------------- -------------------------------------------------------------------------------- --------------------------------------------- -----------------------------------------------------------------------------
  YouTube              前期检索记录显示包含视频统计文件和评论文件，可通过 Video ID                      第一条完整导入---关联---指标---评论分析流程   评论覆盖可能只是部分热门评论；英文数据；原始字段和许可证须重新核验
  Statistics（Advay    关联；视频数据包含标题、发布时间及部分表现指标，评论文件包含评论文本及相关标签                                                 
  Patil）                                                                                                                                             

  Weibo Opinion        前期检索记录显示包含微博正文及关联评论，中文文本和时间信息较丰富                 中文评论处理、主题和讨论时间分析              账号/帖子覆盖有限；不一定有完整曝光、阅读等表现指标；需重点核验研究用途限制
  Dynamic / Weibo                                                                                                                                     
  Evolution                                                                                                                                           

  ASAP（Aspect-based   前期检索记录显示为中文方面级情感分析数据，含方面类别和情感标注                   方面级情感分析模型评估                        原始评论数据的使用权限不能仅凭代码仓库许可证推断
  Sentiment Analysis）                                                                                                                                

  SMP2020-EWECT        中文微博情绪分类数据，前期检索记录包括多类情绪标签                               中文情绪分类实验                              情绪标签不等同于商业满意度或正负面极性；领域分布有局限

  ChineseNlpCorpus     汇总多种中文文本数据集                                                           中文文本处理基线实验                          每个子数据集需单独核验来源、字段、许可和适用场景

  Trending YouTube     前期检索记录显示包含热门视频及部分每日统计信息                                   内容趋势与表现变化演示                        不含完整评论正文；数据年份较早
  Video Statistics                                                                                                                                    
  ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

### 数据来源记录要求

每次导入必须记录：

-   `source_type`：`public_dataset` / `user_upload` / `synthetic` /
    `api`。
-   `source_name`：数据集或来源名称。
-   `source_url`：来源页面。
-   `license_name`：许可证名称；未知时填写 `unknown`。
-   `license_verified`：是否完成核验。
-   `usage_scope`：允许的使用范围或限制说明。
-   `data_owner_or_provider`：数据提供方；未知时留空。
-   `contains_personal_data`：是否可能包含个人信息。
-   `public_demo_allowed`：是否允许用于公开演示。
-   `notes`：人工核验记录。

**禁止默认将"GitHub
仓库开源"理解为"仓库中的原始评论数据可以自由商业使用或再分发"。**

## 2.3 数据分层

建议将数据分为四层：

  层级   名称        内容                                 是否可覆盖
  ------ ----------- ------------------------------------ --------------------
  L0     Raw         原始文件、原始字段、来源信息         不覆盖；新版本另存
  L1     Staging     字段映射后的临时数据、类型转换结果   可重新生成
  L2     Clean       去重、校验、标准化后的业务数据       可按新处理版本重建
  L3     Analytics   指标、模型输出、洞察、报告           可按分析任务重建

------------------------------------------------------------------------

# 3. 数据实体与关系

## 3.1 核心关系

``` text
User
 └── Workspace
      └── Project
           ├── SocialAccount
           ├── ContentPost
           │    ├── PostMetricSnapshot
           │    └── Comment
           │          ├── CommentAnalysis
           │          └── CommentAspect
           ├── ImportBatch
           ├── AnalysisRun
           │    ├── AnalysisResult
           │    └── Insight
           └── Report
```

## 3.2 主要实体说明

  ---------------------------------------------------------------------------------------
  实体                    作用                         核心关系
  ----------------------- ---------------------------- ----------------------------------
  `workspaces`            用户或团队的工作空间         一个 Workspace 有多个 Project

  `workspace_members`     工作空间成员与权限           关联用户和 Workspace

  `projects`              品牌、账号组或一次分析项目   一个 Project
                                                       有多个内容、评论和导入批次

  `social_accounts`       平台账号信息                 一个账号可发布多篇内容

  `content_posts`         内容基本信息                 一篇内容有多个指标快照和评论

  `post_metrics`          内容指标时间快照             多条记录关联一篇内容

  `comments`              用户评论原文                 评论关联一篇内容

  `comment_analyses`      评论整体情感/主题分析        一条评论可有多个版本的分析结果

  `comment_aspects`       方面级情感结果               一条评论可对应多个方面

  `import_batches`        文件导入任务与来源记录       记录导入数量、质量和字段映射

  `analysis_runs`         一次可复现的分析任务         记录数据版本、代码版本和模型版本

  `analysis_results`      结构化统计结果               关联一次分析任务

  `insights`              有证据支持的运营洞察         关联分析任务和证据

  `reports`               导出的分析报告               关联项目和分析任务
  ---------------------------------------------------------------------------------------

## 3.3 ID 设计

数据库内部主键统一使用 UUID。

导入模板中的 `content_key` 和 `comment_key`
是用户文件内的业务键，不直接作为数据库 UUID。

-   `content_key`：在同一导入工作簿/项目内唯一，用于关联
    Posts、Metrics、Comments。
-   `comment_key`：评论在导入文件中的唯一键；如来源没有稳定评论
    ID，可以为空，由系统计算去重指纹，但必须标记去重方式和可信度。
-   `external_content_id`：平台原始内容 ID，可为空。
-   `external_comment_id`：平台原始评论 ID，可为空。

------------------------------------------------------------------------

# 4. 标准导入工作簿

建议提供一个标准 Excel
工作簿：`Content_Intelligence_Import_Template.xlsx`。

第一版包含三个必备 Sheet：`Posts`、`Metrics`、`Comments`。可选增加
`Accounts` 和 `Data_Dictionary`。

## 4.1 Sheet: Posts

**一行代表一篇内容。**

  ----------------------------------------------------------------------------------------------------
  字段                    类型                       必填 说明                 示例
  ----------------------- ------------- ----------------- -------------------- -----------------------
  `content_key`           string                       是 工作簿内唯一内容键   `post_001`

  `platform`              enum/string                  是 平台标识             `youtube`

  `account_key`           string                       否 对应账号键           `account_01`

  `external_content_id`   string                       否 平台原始内容 ID      `abc123`

  `title`                 string                       是 内容标题             `How to...`

  `content_type`          enum/string                  是 内容形式             `video`

  `publish_time`          datetime                     是 内容发布时间         `2026-10-01 10:00:00`

  `timezone`              string                       否 发布时间时区         `Asia/Shanghai`

  `content_text`          text                         否 正文、简介或描述     `...`

  `topic`                 string                       否 主主题               `科普`

  `tags`                  string/JSON                  否 标签列表             `["环保","科普"]`

  `content_url`           string                       否 内容链接             `https://...`

  `language`              string                       否 内容语言             `zh`
  ----------------------------------------------------------------------------------------------------

约束：

-   `content_key` 在一个导入批次内必须唯一。
-   `platform` 必须是系统支持的平台标识，或由用户选择"其他"。
-   `publish_time` 必须可解析；不能解析时该行进入错误记录。
-   `content_type`
    不应强制使用单一平台的内容分类；保留原始值并通过映射表标准化。
-   `tags` 支持 JSON 数组或约定分隔符；导入时统一转为数组。
-   不要求用户提供平台账号昵称、个人主页等不必要个人信息。

## 4.2 Sheet: Metrics

**一行代表一篇内容在一个时间点的一组指标快照。**

  -------------------------------------------------------------------------------------------------------
  字段               类型                        必填 说明                        示例
  ------------------ -------------- ----------------- --------------------------- -----------------------
  `content_key`      string                        是 关联 Posts                  `post_001`

  `snapshot_time`    datetime                      是 指标采集时间                `2026-10-02 10:00:00`

  `snapshot_type`    enum                          否 `cumulative` / `period`     `cumulative`

  `views`            integer/null                  否 平台定义的阅读/播放类指标   `12000`

  `impressions`      integer/null                  否 曝光量                      `18000`

  `reach`            integer/null                  否 触达人数                    `9000`

  `likes`            integer/null                  否 点赞量                      `600`

  `comments_count`   integer/null                  否 评论数量指标                `120`

  `shares`           integer/null                  否 分享量                      `80`

  `saves`            integer/null                  否 收藏量                      `250`

  `raw_metrics`      JSON/string                   否 平台原始指标补充            `{"favorites":250}`
  -------------------------------------------------------------------------------------------------------

约束：

-   `content_key + snapshot_time + snapshot_type`
    应唯一；如一个平台存在多种采集口径，需增加 `metric_profile`
    或导入来源区分。
-   指标字段允许为空；空值不能自动转成 0。
-   指标值不能为负数。平台特殊编码必须先映射为缺失值并记录原因。
-   `views`
    可能代表阅读量或播放量，必须保存平台指标定义，不能未经确认就跨平台比较。
-   `snapshot_type=period`
    时，必须在导入说明中明确统计周期；第一版可优先支持累计快照。

## 4.3 Sheet: Comments

**一行代表一条评论。**

  字段                    类型             必填 说明              示例
  ----------------------- -------------- ------ ----------------- -----------------------
  `comment_key`           string             否 文件内评论键      `comment_001`
  `content_key`           string             是 关联 Posts        `post_001`
  `external_comment_id`   string             否 平台原始评论 ID   `cmt_123`
  `comment_text`          text               是 评论文本          `内容很实用`
  `comment_time`          datetime           否 评论时间          `2026-10-01 12:30:00`
  `comment_likes`         integer/null       否 评论获赞数        `12`
  `reply_count`           integer/null       否 回复数            `2`
  `parent_comment_id`     string             否 父评论 ID         `cmt_100`
  `language`              string             否 评论语言          `zh`
  `sample_type`           enum               否 评论覆盖类型      `top`

`sample_type` 建议取值：

-   `all`：全量评论。
-   `latest`：最新评论抽样。
-   `top`：热门评论抽样。
-   `random`：随机抽样。
-   `manual`：人工选取。
-   `unknown`：未知。

约束：

-   `content_key` 必须能在 Posts 中找到。
-   评论文本不得为空白字符串。
-   如果无稳定 `comment_key` 和 `external_comment_id`，系统可以计算
    `dedupe_hash`，但必须标记为系统推断的去重键。
-   不要仅凭"文本相同"就删除所有重复评论；不同用户可能发表相同文本。优先使用平台评论
    ID；没有平台 ID 时结合内容
    ID、规范化文本和时间等字段计算指纹，并将自动去重标记为低/中可信度。
-   如果数据只包含部分评论，必须记录抽样方式和覆盖范围。

## 4.4 可选 Sheet: Accounts

用于账号级数据，不作为第一版核心依赖。

建议字段：`account_key`、`platform`、`account_name`、`external_account_id`、`account_url`、`account_type`、`language`。

账号粉丝数等随时间变化的指标应单独设计 `account_metrics`
快照表，不要混入内容指标表。

------------------------------------------------------------------------

# 5. 字段字典

## 5.1 通用字段约定

  类型            约定
  --------------- --------------------------------------------------
  `UUID`          数据库内部主键
  `TEXT`          字符串；长度限制由业务需要决定
  `TIMESTAMPTZ`   带时区时间；数据库统一存 UTC，界面按项目时区展示
  `BIGINT`        计数型指标
  `NUMERIC`       比率、分数等需要精确保存的数值
  `BOOLEAN`       是/否
  `JSONB`         平台原始字段、标签数组、模型结构化输出
  `NULL`          未知/缺失/不适用，不代表零

## 5.2 `projects`

  字段                 类型            必填 说明
  -------------------- ------------- ------ --------------------------------
  `id`                 UUID              是 主键
  `workspace_id`       UUID              是 所属工作空间
  `name`               TEXT              是 项目名称
  `brand_name`         TEXT              否 品牌名称
  `description`        TEXT              否 项目说明
  `default_timezone`   TEXT              是 默认时区，建议 `Asia/Shanghai`
  `created_at`         TIMESTAMPTZ       是 创建时间
  `updated_at`         TIMESTAMPTZ       是 更新时间

## 5.3 `social_accounts`

  字段                    类型            必填 说明
  ----------------------- ------------- ------ ------------------
  `id`                    UUID              是 主键
  `project_id`            UUID              是 所属项目
  `platform`              TEXT              是 平台标识
  `account_key`           TEXT              否 导入文件账号键
  `external_account_id`   TEXT              否 平台账号 ID
  `account_name`          TEXT              否 账号名称
  `account_url`           TEXT              否 账号链接
  `account_type`          TEXT              否 品牌/个人/机构等
  `created_at`            TIMESTAMPTZ       是 创建时间

## 5.4 `content_posts`

  字段                    类型            必填 说明
  ----------------------- ------------- ------ ------------------
  `id`                    UUID              是 内部主键
  `project_id`            UUID              是 所属项目
  `social_account_id`     UUID              否 所属账号
  `platform`              TEXT              是 平台标识
  `content_key`           TEXT              是 项目内业务键
  `external_content_id`   TEXT              否 平台内容 ID
  `title`                 TEXT              是 标题
  `content_type`          TEXT              是 标准化内容形式
  `raw_content_type`      TEXT              否 平台原始内容类型
  `publish_time`          TIMESTAMPTZ       是 发布时间
  `content_text`          TEXT              否 正文/描述
  `topic`                 TEXT              否 主主题
  `tags`                  JSONB             否 标签数组
  `content_url`           TEXT              否 内容链接
  `language`              TEXT              否 语言
  `source_batch_id`       UUID              否 来源导入批次
  `created_at`            TIMESTAMPTZ       是 创建时间

建议唯一约束：`(project_id, platform, content_key)`。

## 5.5 `post_metrics`

  字段                类型            必填 说明
  ------------------- ------------- ------ -----------------------
  `id`                UUID              是 主键
  `content_post_id`   UUID              是 关联内容
  `snapshot_time`     TIMESTAMPTZ       是 采集时间
  `snapshot_type`     TEXT              是 cumulative / period
  `views`             BIGINT            否 平台阅读/播放指标
  `impressions`       BIGINT            否 曝光量
  `reach`             BIGINT            否 触达人数
  `likes`             BIGINT            否 点赞量
  `comments_count`    BIGINT            否 评论量
  `shares`            BIGINT            否 分享量
  `saves`             BIGINT            否 收藏量
  `raw_metrics`       JSONB             否 原始平台指标
  `metric_profile`    TEXT              是 指标口径版本/平台配置
  `source_batch_id`   UUID              否 来源批次
  `created_at`        TIMESTAMPTZ       是 创建时间

建议唯一约束：`(content_post_id, snapshot_time, snapshot_type, metric_profile)`。

## 5.6 `comments`

  字段                           类型            必填 说明
  ------------------------------ ------------- ------ --------------
  `id`                           UUID              是 内部主键
  `project_id`                   UUID              是 所属项目
  `content_post_id`              UUID              是 关联内容
  `external_comment_id`          TEXT              否 平台评论 ID
  `dedupe_hash`                  TEXT              是 系统去重指纹
  `comment_text`                 TEXT              是 评论正文
  `comment_time`                 TIMESTAMPTZ       否 评论时间
  `comment_likes`                BIGINT            否 评论获赞量
  `reply_count`                  BIGINT            否 回复数
  `parent_comment_external_id`   TEXT              否 父评论 ID
  `language`                     TEXT              否 语言
  `sample_type`                  TEXT              是 评论样本类型
  `source_batch_id`              UUID              否 来源批次
  `created_at`                   TIMESTAMPTZ       是 创建时间

## 5.7 `comment_analyses`

  -----------------------------------------------------------------------------------
  字段                类型                              必填 说明
  ------------------- ---------------- --------------------- ------------------------
  `id`                UUID                                是 主键

  `comment_id`        UUID                                是 关联评论

  `analysis_run_id`   UUID                                是 分析任务

  `sentiment_label`   TEXT                                否 positive / neutral /
                                                             negative / unknown

  `sentiment_score`   NUMERIC                             否 模型分数；须记录其定义

  `topic_labels`      JSONB                               否 一个或多个主题

  `model_name`        TEXT                                是 模型名称

  `model_version`     TEXT                                是 模型版本

  `confidence`        NUMERIC                             否 置信度，范围 0--1

  `status`            TEXT                                是 success / failed /
                                                             skipped

  `created_at`        TIMESTAMPTZ                         是 创建时间
  -----------------------------------------------------------------------------------

注意：不同模型的 score
含义可能不同，不得把未经校准的分数直接当成概率比较。

## 5.8 `comment_aspects`

  字段                类型        必填 说明
  ------------------- --------- ------ -------------------------------
  `id`                UUID          是 主键
  `comment_id`        UUID          是 关联评论
  `analysis_run_id`   UUID          是 分析任务
  `aspect_name`       TEXT          是 方面名称，如价格、质量、客服
  `sentiment_label`   TEXT          是 positive / neutral / negative
  `confidence`        NUMERIC       否 置信度
  `evidence_text`     TEXT          否 对应原文片段
  `model_name`        TEXT          是 模型名称
  `model_version`     TEXT          是 模型版本

ASAP 等数据集中的 `not mentioned`
表示没有提及某方面，不是一个情感极性。未提及的方面不进入该方面情感率的分母。

## 5.9 `import_batches`

建议字段：

-   `id` UUID 主键
-   `project_id` UUID
-   `file_name` TEXT
-   `file_hash` TEXT
-   `source_type` TEXT
-   `source_name` TEXT
-   `source_url` TEXT
-   `license_name` TEXT
-   `license_verified` BOOLEAN
-   `usage_scope` TEXT
-   `contains_personal_data` BOOLEAN
-   `public_demo_allowed` BOOLEAN
-   `platform` TEXT
-   `field_mapping` JSONB
-   `row_counts` JSONB
-   `quality_summary` JSONB
-   `status` TEXT
-   `created_at` TIMESTAMPTZ

## 5.10 `analysis_runs`、`insights` 与 `reports`

`analysis_runs` 至少记录：

-   项目 ID；
-   输入数据范围/导入批次；
-   数据版本；
-   指标口径版本；
-   分析代码版本；
-   模型名称与版本；
-   参数；
-   开始时间、结束时间；
-   状态和错误信息。

`insights` 至少记录：

-   洞察标题；
-   发现描述；
-   证据指标；
-   样本量；
-   时间范围；
-   推荐动作；
-   置信度/证据等级；
-   限制说明；
-   生成模型和版本。

`reports`
至少记录报告标题、项目、分析任务、文件位置、生成时间和报告版本。

------------------------------------------------------------------------

# 6. 平台适配与指标标准化

## 6.1 设计目标

平台适配器负责将平台原始字段转换为内部标准字段，不负责改变指标含义。

建议每个平台有独立 Adapter：

``` text
adapters/
  base_adapter.py
  youtube_adapter.py
  weibo_adapter.py
  xiaohongshu_adapter.py
  douyin_adapter.py
  wechat_adapter.py
```

第一版不要求所有平台都具备真实 API 接入。Adapter 可以先负责 CSV/Excel
字段映射。

## 6.2 标准字段与原始字段并存

示例：

  ----------------------------------------------------------------------------------------
  内部标准字段            原始平台字段示例        注意事项
  ----------------------- ----------------------- ----------------------------------------
  `views`                 views / view_count /    必须保存原始指标名，确认是阅读还是播放
                          play_count              

  `impressions`           impressions             仅当平台确实提供曝光量时映射

  `reach`                 reach / unique_viewers  需核对去重口径

  `likes`                 likes / like_count      核对是否包含作者点赞等特殊口径

  `comments_count`        comment_count           区分评论总数与已导入评论行数

  `shares`                shares / share_count    核对统计范围

  `saves`                 saves / favorites /     不能默认所有平台的收藏定义相同
                          collects                
  ----------------------------------------------------------------------------------------

## 6.3 Adapter 输出格式

每条标准化记录应保留：

``` json
{
  "platform": "youtube",
  "external_content_id": "example_video_id",
  "metric_name": "view_count",
  "normalized_field": "views",
  "value": 12000,
  "unit": "count",
  "definition": "平台提供的累计播放/观看指标",
  "source_field": "view_count",
  "snapshot_time": "2026-10-02T10:00:00Z",
  "mapping_version": "youtube_v1"
}
```

上述 JSON 仅为内部标准化结构示例，不代表某个数据集的真实字段名。

## 6.4 跨平台比较限制

以下情况下不得直接进行排名或平均值比较：

-   分母不同（views 与 reach 混用）。
-   指标定义不同（播放量与曝光量混用）。
-   时间窗口不同。
-   一方为累计数据，另一方为周期数据。
-   一方是全量评论，另一方是热门评论抽样。
-   内容类型差异显著且未分层。
-   指标缺失率差异显著。

Dashboard 应显示平台、指标口径、时间范围和样本量。

------------------------------------------------------------------------

# 7. 指标定义与计算规则

## 7.1 指标计算通用规则

1.  所有指标必须标注公式、分母、时间范围和数据覆盖情况。
2.  任何计算都不得默认将 NULL 转成 0。
3.  分母为 0 或 NULL 时，结果为 NULL，并显示"不可计算"。
4.  不同平台的指标只有在口径兼容时才能横向比较。
5.  默认以内容为分析单元；如按账号、平台、主题聚合，必须明确聚合层级。
6.  平均数与中位数应同时考虑，避免少量爆款造成均值偏移。
7.  任何增长率都必须使用同一指标定义和可比较的快照。

## 7.2 内容数量与基础表现

  --------------------------------------------------------------------------------
  指标                    公式                    注意事项
  ----------------------- ----------------------- --------------------------------
  发布内容量              符合筛选条件的内容数    明确去重规则

  总阅读/播放量           有效内容 views 求和     仅在口径一致时聚合

  平均阅读/播放量         总阅读/播放量 ÷         同时展示中位数
                          有效内容数              

  平均点赞量              有效点赞量总和 ÷        缺失值处理需透明
                          有效内容数              

  平均评论量              有效评论指标总和 ÷      区分平台评论总数和导入评论行数
                          有效内容数              

  中位数阅读/播放量       有效内容 views 的中位数 对极端值更稳健
  --------------------------------------------------------------------------------

## 7.3 互动指标

定义一个可配置的互动指标集合：

`engagement_components = [likes, comments_count, shares, saves]`

严格模式下，只有所有被配置为必需的互动分量都可用，才计算完整互动总量：

`engagement_count = likes + comments_count + shares + saves`

如果平台不提供其中某一项，应为该平台配置自己的指标公式，并显示公式名称。不得把未知字段当作零。

互动率示例：

\[
ER\_{views}=`\frac{Likes+Comments+Shares+Saves}{Views}`{=tex}`\times100`{=tex}%
\]

\[
ER\_{reach}=`\frac{Likes+Comments+Shares+Saves}{Reach}`{=tex}`\times100`{=tex}%
\]

两者必须作为不同指标展示，不可混称。公式中的分子必须与平台支持的互动组件相匹配。

建议指标配置表记录：

-   `metric_profile`
-   `engagement_formula`
-   `denominator_field`
-   `required_components`
-   `definition_version`
-   `cross_platform_comparable`

## 7.4 收藏率、分享率和评论率

\[ SaveRate=`\frac{Saves}{Views}`{=tex}`\times100`{=tex}% \]

\[ ShareRate=`\frac{Shares}{Views}`{=tex}`\times100`{=tex}% \]

\[ CommentRate=`\frac{Comments}{Views}`{=tex}`\times100`{=tex}% \]

以上公式仅在分子、分母均存在且口径匹配时计算。若平台不提供某项指标，则显示不可用，不得填
0%。

## 7.5 增长指标

对于累计快照：

\[ Delta=Metric\_{t_2}-Metric\_{t_1} \]

\[
GrowthRate=`\frac{Metric_{t_2}-Metric_{t_1}}{Metric_{t_1}}`{=tex}`\times100`{=tex}%
\]

约束：

-   `Metric_t1` 为 0 时增长率不可定义，返回 NULL。
-   两个快照必须来自同一指标口径。
-   若出现累计指标下降，标记异常，不自动修正。
-   不能将两个不同时间窗口的周期指标误当作累计快照。

## 7.6 内容表现分位数与爆款识别

建议以同一项目、平台、内容类型和可比时间窗口作为比较组。

-   P50：中位数表现。
-   P75：第 75 百分位。
-   P90：第 90 百分位。

爆款识别建议由用户配置，例如
`views >= 同组 P90`。必须显示比较组样本量；样本量不足时不进行可靠排名。

## 7.7 评论情感指标

正面评论占比：

\[
PositiveShare=`\frac{N_{positive}}{N_{analyzed}}`{=tex}`\times100`{=tex}%
\]

负面评论占比：

\[
NegativeShare=`\frac{N_{negative}}{N_{analyzed}}`{=tex}`\times100`{=tex}%
\]

其中 `N_analyzed`
只包括成功完成情感分析且标签有效的评论。未分析、分析失败、未知标签不进入分母。

如果评论是热门评论或最新评论抽样，结果只能描述该样本，不能直接代表全部受众。

## 7.8 主题占比

\[
TopicShare=`\frac{N_{comments\ assigned\ to\ topic}}{N_{classified\ comments}}`{=tex}`\times100`{=tex}%
\]

如果一条评论可以被分配多个主题，各主题占比之和可能超过
100%。界面必须标注"多标签主题占比"。

## 7.9 方面级负面率

\[
AspectNegativeRate=`\frac{N_{negative\ mentions\ of\ aspect}}{N_{all\ valid\ mentions\ of\ aspect}}`{=tex}`\times100`{=tex}%
\]

只统计明确提及该方面且有有效情感标签的评论。未提及该方面的评论不进入分母。

## 7.10 发布时间分析

可以按小时、星期、时间段统计内容表现，但结果属于描述性关联分析。

必须提示潜在混杂因素：

-   内容主题；
-   内容形式；
-   账号粉丝规模；
-   付费推广；
-   节假日；
-   发布时间与指标采集间隔；
-   平台推荐机制。

不能仅凭观察到某时间段平均互动率较高，就断言该时间段发布导致互动率提高。

## 7.11 账号粉丝增长

粉丝数属于账号级时间序列，不应混入单篇内容指标表。后续如开发账号分析，应新增
`account_metrics`：

-   `social_account_id`
-   `snapshot_time`
-   `followers_count`
-   `following_count`（如平台提供）
-   `raw_metrics`
-   `metric_profile`

------------------------------------------------------------------------

# 8. 数据清洗与质量控制

## 8.1 导入流程

``` text
上传文件
  ↓
文件类型与大小检查
  ↓
读取 Sheet / CSV
  ↓
识别字段与字段映射
  ↓
预览映射结果
  ↓
类型转换与格式标准化
  ↓
必填字段校验
  ↓
重复记录检查
  ↓
外键/内容关联检查
  ↓
数值范围与时间逻辑检查
  ↓
生成数据质量报告
  ↓
用户确认导入
  ↓
写入数据库
```

## 8.2 数据质量检查项

  检查项         规则                          处理方式
  -------------- ----------------------------- ----------------------------
  必填字段       缺少关键字段                  阻止对应行导入并说明原因
  数据类型       日期、数值无法解析            标记错误；不静默转换
  内容键唯一性   同一批次 `content_key` 重复   阻止或要求用户确认
  评论关联       `content_key` 不存在          评论进入异常记录
  指标非负       计数型指标小于 0              标记异常；识别平台特殊编码
  时间逻辑       评论时间早于发布时间          标记异常，不一定直接删除
  重复评论       相同平台评论 ID               按明确规则去重
  空文本         评论为空或纯空格              不进入文本分析
  指标快照       同一内容、时间、口径重复      标记重复快照
  授权信息       来源许可未知                  限制公开演示/共享

## 8.3 去重规则

优先级：

1.  有平台 `external_comment_id`：按平台、内容和外部评论 ID 去重。
2.  无外部 ID：计算 `dedupe_hash`，至少考虑
    `content_post_id + normalized_text + comment_time`。
3.  无时间字段：只使用内容 ID
    和文本的去重会误删不同用户的相同评论，应降低自动去重强度，并允许用户查看/撤销。

不要把完全相同的评论文本一律认定为重复。

## 8.4 数据异常处理

-   原始文件保留，不直接修改。
-   每条异常记录保存行号、字段名、原始值、错误类型和处理建议。
-   可修复错误允许用户下载错误报告后重新上传。
-   无法修复的行进入 rejected rows，不应静默丢弃。
-   导入摘要显示总行数、成功数、失败数、跳过数和重复数。

## 8.5 数据质量报告

建议至少展示：

-   总记录数；
-   成功导入数；
-   失败数；
-   重复数；
-   必填字段缺失数；
-   日期解析失败数；
-   指标异常数；
-   内容关联失败数；
-   评论样本类型；
-   已知总评论量与实际导入评论量（若来源提供）；
-   有效字段覆盖率。

"有效记录率"的公式必须在界面定义，例如：

`有效记录率 = 成功通过核心校验的记录数 / 总输入记录数`

不能只展示一个没有解释的百分比。

------------------------------------------------------------------------

# 9. 评论分析与模型评价

## 9.1 第一版分析任务

第一版建议分成：

1.  文本清洗与语言识别。
2.  整体情感分类：positive / neutral / negative / unknown。
3.  关键词与短语提取。
4.  主题归纳或聚类。
5.  方面级情感分析（在数据和模型支持时启用）。
6.  结果抽样复核与错误分析。

## 9.2 模型路线

建议先建立可比较的基线：

  任务         基线                           进阶方案
  ------------ ------------------------------ ----------------------------
  情感分类     TF-IDF + Logistic Regression   中文 BERT / 其他经验证模型
  关键词提取   TF-IDF / 词频                  KeyBERT 等
  主题发现     关键词规则 / 聚类              BERTopic 或嵌入聚类
  方面级情感   规则或人工标注基线             ABSA 模型 / LLM 辅助标注
  评论总结     统计汇总                       LLM 基于证据生成摘要

具体模型选择应根据语言、数据规模、部署成本和测试结果决定。不能仅因为模型名称更新就默认效果更好。

## 9.3 训练、验证与测试

-   训练集、验证集、测试集必须分离。
-   同一内容下的相似评论尽量不要随机分散到训练集和测试集，以避免数据泄漏。
-   如研究跨时间泛化，应采用时间切分。
-   如研究跨账号泛化，应采用账号分组切分。
-   任何数据增强和预处理参数只能在训练/验证流程内确定，不得利用测试集调参。

## 9.4 评价指标

  指标                含义                               适用
  ------------------- ---------------------------------- ----------------------
  Accuracy            总体正确率                         类别较均衡时辅助使用
  Precision           预测为某类的样本中实际正确的比例   误报成本较高时
  Recall              实际某类样本中被识别出的比例       漏报成本较高时
  F1                  Precision 与 Recall 的调和平均     类别不均衡时
  Macro-F1            各类别 F1 的简单平均               多类别不均衡任务
  Confusion Matrix    各类别预测错误情况                 错误分析
  Per-class metrics   各类别独立指标                     检查少数类别

报告必须给出测试集规模、类别分布、标签来源、数据切分方式和模型版本。

## 9.5 方面级情感分析

一条评论可以包含多个方面：

> 产品设计很好，但是价格太高，客服也不太专业。

期望输出示例：

  Aspect     Sentiment   Evidence
  ---------- ----------- ----------------
  产品设计   positive    产品设计很好
  价格       negative    价格太高
  客服       negative    客服也不太专业

要求：

-   方面名称来自预定义体系或可审查的主题词表。
-   每个方面的情感标签独立判断。
-   保存原文证据片段。
-   对不确定结果标记 `unknown` 或低置信度。
-   不要将"未提及"当作中性。
-   评价时报告方面抽取和情感分类的结果；如果数据集支持，应分别评估方面识别、情感极性和联合抽取。

## 9.6 LLM 辅助标注

如果使用 LLM 辅助生成训练标签：

-   必须标记为机器辅助标签，不得伪装成人工金标准。
-   抽样进行人工复核。
-   记录模型名称、提示词版本、生成时间和复核状态。
-   对争议样本允许人工修改。
-   测试集优先使用可信人工标注，不使用同一模型生成标签再评价该模型。

------------------------------------------------------------------------

# 10. AI 洞察与建议生成规范

## 10.1 输入必须是结构化分析结果

LLM 不应直接承担全量原始数据统计。建议先由分析引擎生成结构化结果：

``` json
{
  "project_id": "example-project",
  "period": {
    "start": "2026-10-01",
    "end": "2026-10-31"
  },
  "sample_size": {
    "posts": 120,
    "comments_imported": 3500,
    "comments_analyzed": 3200
  },
  "findings": [
    {
      "metric": "median_engagement_rate",
      "group": "科普内容",
      "value": 0.052,
      "comparison_value": 0.034,
      "definition_version": "platform_profile_v1"
    }
  ],
  "limitations": [
    "评论为热门评论抽样",
    "部分内容缺少曝光量"
  ]
}
```

以上仅为结构示例，数值为虚构示例。

## 10.2 AI 输出格式

建议要求 LLM 返回结构化 JSON：

``` json
{
  "title": "科普内容的互动表现相对较高",
  "finding": "在当前筛选样本中，科普内容的中位互动率高于对照内容。",
  "evidence": [
    {
      "metric": "median_engagement_rate",
      "sample_size": 32,
      "value": 0.052,
      "comparison_value": 0.034
    }
  ],
  "recommendation": "可设计下一轮同主题内容测试，观察结果是否稳定。",
  "confidence": "medium",
  "limitations": [
    "当前结果为描述性比较",
    "尚未控制发布时间和账号差异"
  ]
}
```

## 10.3 防止 AI 编造

-   证据中的数值必须来自分析结果。
-   AI 不得自行补齐缺失指标。
-   AI 不得将相关关系描述为因果关系。
-   AI 不得把样本评论情绪代表全体受众。
-   AI 不得把热门评论抽样结果描述为全部评论结果。
-   建议必须能指向数据证据。
-   如果样本量不足，AI 应回答"证据不足，暂不建议下结论"。
-   每条洞察保存所使用的 `analysis_run_id`。

------------------------------------------------------------------------

# 11. 数据库与技术架构建议

## 11.1 推荐技术栈

  层级       技术                          职责
  ---------- ----------------------------- ------------------------
  前端       Next.js + TypeScript          页面、表单、交互、看板
  UI         Tailwind CSS                  样式与响应式布局
  图表       ECharts 或 Recharts           数据可视化
  数据库     Supabase PostgreSQL           业务数据与分析结果
  认证       Supabase Auth                 用户登录
  文件存储   Supabase Storage              原始文件和导出报告
  分析服务   Python + Pandas + NumPy       数据清洗与统计
  API        FastAPI（建议）               Python 分析服务接口
  NLP        Scikit-learn / Transformers   文本分析与模型评估
  AI         LLM API                       洞察解释与报告生成
  部署       Vercel + Python 服务托管      前端与分析服务部署

## 11.2 数据库约束

-   内部主键使用 UUID。
-   关键业务表必须有 `project_id`。
-   内容、指标、评论必须有明确外键。
-   指标快照使用独立记录，不覆盖历史快照。
-   原始平台指标保留在 `JSONB` 字段或原始层。
-   对项目、内容、快照时间、评论关联字段建立必要索引。
-   用户只能访问其所属工作空间的数据。
-   Supabase Row Level Security（RLS）必须启用并经过测试。
-   不允许仅靠前端隐藏按钮来实现权限控制。

## 11.3 数据库表清单

MVP 建议至少实现：

-   `workspaces`
-   `workspace_members`
-   `projects`
-   `social_accounts`
-   `content_posts`
-   `post_metrics`
-   `comments`
-   `import_batches`
-   `analysis_runs`
-   `comment_analyses`
-   `comment_aspects`
-   `insights`
-   `reports`

可延后：

-   `account_metrics`
-   `competitors`
-   `content_calendar`
-   `publishing_queue`
-   `experiments`
-   `metric_profiles`（如第一版先用配置文件，也可后续迁移为数据库表）

## 11.4 文件存储

原始上传文件应放在私有 Storage Bucket：

-   不允许公开访问用户上传的原始评论文件。
-   文件名使用系统生成 ID，原始文件名仅作为元数据。
-   保存文件哈希用于识别重复上传。
-   对文件大小、扩展名和 MIME 类型进行限制。
-   导入完成后根据保留策略管理原始文件。
-   导出报告按项目权限控制下载。

------------------------------------------------------------------------

# 12. 数据处理 Pipeline 与 API

## 12.1 Pipeline

``` text
Frontend Upload
    ↓
Create Import Batch
    ↓
Store Raw File
    ↓
Parse CSV / XLSX
    ↓
Field Mapping
    ↓
Validation
    ↓
Staging Data
    ↓
Platform Adapter
    ↓
Clean & Normalize
    ↓
PostgreSQL
    ↓
Analytics Service
    ├── KPI Calculation
    ├── Content Analysis
    ├── Comment NLP
    └── Quality Summary
    ↓
Structured Analysis Results
    ↓
LLM Insight Generation
    ↓
Dashboard / Report
```

## 12.2 建议 API

以下为接口设计建议，不代表已实现。

  Method   Endpoint                             作用
  -------- ------------------------------------ ------------------
  POST     `/api/projects`                      创建项目
  GET      `/api/projects`                      项目列表
  POST     `/api/imports`                       创建导入任务
  POST     `/api/imports/{id}/upload`           上传文件
  POST     `/api/imports/{id}/validate`         执行数据校验
  GET      `/api/imports/{id}/quality`          获取质量报告
  POST     `/api/imports/{id}/commit`           确认写入正式数据
  GET      `/api/projects/{id}/overview`        获取总览指标
  POST     `/api/projects/{id}/analysis-runs`   创建分析任务
  GET      `/api/analysis-runs/{id}`            查询分析任务状态
  GET      `/api/analysis-runs/{id}/insights`   获取洞察
  POST     `/api/reports`                       生成报告

## 12.3 长任务处理

-   文件解析和小数据量分析可以同步执行。
-   大文件导入、批量 NLP 和报告生成应使用异步任务。
-   每个任务有 `pending`、`running`、`success`、`failed` 状态。
-   失败任务保存错误信息和可重试状态。
-   重试不能造成重复写入；导入任务应具备幂等性。
-   第一版不必引入复杂消息队列，可先使用简单后台任务方案；当任务量增长后再升级。

------------------------------------------------------------------------

# 13. 隐私、授权与数据安全

## 13.1 数据最小化

第一版只收集分析必需字段。原则上不需要收集：

-   用户真实姓名；
-   手机号；
-   私人邮箱；
-   个人主页；
-   头像；
-   精确地理位置；
-   与分析无关的个人身份信息。

## 13.2 评论文本风险

评论文本可能包含姓名、联系方式、个人经历或其他敏感信息。

应考虑：

-   默认私有存储；
-   上传前提示用户确认授权；
-   可选的个人信息脱敏；
-   不在公开 Demo 中展示原始个人评论；
-   提供删除项目和关联数据的能力；
-   设置数据保留期限；
-   不把用户上传数据默认用于模型训练。

## 13.3 数据集许可证

每个公开数据集必须逐项记录：

-   数据集原始发布页；
-   数据文件来源；
-   代码许可证；
-   数据许可证；
-   平台条款；
-   商业使用限制；
-   再分发限制；
-   是否允许公开演示；
-   个人信息风险。

若任何一项不明确，标记 `pending_review`，不得默认允许公开分发。

------------------------------------------------------------------------

# 14. MVP 范围与开发优先级

## 14.1 P0：数据导入与项目管理

必须完成：

-   用户创建项目；
-   CSV/XLSX 上传；
-   Posts、Metrics、Comments 三类数据识别；
-   字段映射；
-   数据预览；
-   数据校验；
-   导入质量报告；
-   数据写入数据库；
-   导入历史记录。

## 14.2 P1：内容表现分析

必须完成：

-   内容数量；
-   阅读/播放量；
-   点赞、评论、收藏、分享；
-   平均数、中位数；
-   内容排名；
-   时间趋势；
-   内容类型/主题分组；
-   指标口径说明。

## 14.3 P2：评论洞察

必须完成：

-   评论数量统计；
-   文本清洗；
-   基础情感分类；
-   关键词提取；
-   主题归纳；
-   模型版本记录；
-   分析结果抽样复核。

方面级情感分析可以作为 P2
的进阶功能；如果模型效果尚未验证，不应在界面宣传为可靠能力。

## 14.4 P3：AI 运营洞察

必须完成：

-   基于统计结果生成总结；
-   显示证据和样本量；
-   生成运营建议；
-   显示限制条件；
-   禁止生成无依据的数值结论。

## 14.5 P4：报告与部署

-   周报/月报；
-   PDF/Excel 导出；
-   历史分析记录；
-   响应式布局；
-   Demo 数据；
-   部署与 README；
-   演示账号和演示流程。

## 14.6 暂不开发

-   自动爬取小红书/抖音等平台；
-   自动发布内容；
-   完整竞品账号实时追踪；
-   多智能体系统；
-   复杂推荐算法；
-   实时流式数据处理；
-   企业级多租户计费。

------------------------------------------------------------------------

# 15. 验收标准

第一版不能以"页面能打开"作为完成标准。建议按以下验收。

## 15.1 数据导入验收

-   [ ] 能上传标准模板 CSV/XLSX。
-   [ ] 能识别 Posts、Metrics、Comments。
-   [ ] 能显示字段映射预览。
-   [ ] 能识别缺失必填字段。
-   [ ] 能识别重复内容键和异常评论关联。
-   [ ] 能区分 NULL 与 0。
-   [ ] 能显示成功、失败、重复和异常数量。
-   [ ] 原始文件和导入批次可追溯。
-   [ ] 重复提交同一批次不会重复写入。

## 15.2 内容分析验收

-   [ ] 能按项目和时间范围筛选。
-   [ ] 能计算内容发布量。
-   [ ] 能展示阅读/播放、点赞、评论等指标。
-   [ ] 能展示平均数和中位数。
-   [ ] 能按内容类型或主题分组。
-   [ ] 能展示内容表现排名。
-   [ ] 能展示指标公式和样本量。
-   [ ] 缺失指标不会被错误当作零。
-   [ ] 不兼容的平台指标不会被直接合并比较。

## 15.3 评论分析验收

-   [ ] 能读取并关联评论。
-   [ ] 能展示情感分类结果。
-   [ ] 能展示关键词和主题。
-   [ ] 能显示模型名称、版本和分析时间。
-   [ ] 能区分未分析、分析失败和未知标签。
-   [ ] 能抽样查看模型预测。
-   [ ] 有可信标注集时能输出 Precision、Recall、F1 和混淆矩阵。
-   [ ] 方面级情感分析能保存方面名称、极性和证据文本。

## 15.4 AI 洞察验收

-   [ ] 每条洞察有对应统计证据。
-   [ ] 样本量和时间范围可见。
-   [ ] AI 不得自行编造指标数值。
-   [ ] 数据不足时能返回证据不足。
-   [ ] 相关性不能被描述为因果关系。
-   [ ] 抽样评论不能被描述为全体用户意见。
-   [ ] 洞察可追溯到具体分析任务。

## 15.5 产品与安全验收

-   [ ] 用户不能访问其他工作空间的数据。
-   [ ] RLS 权限策略经过测试。
-   [ ] 原始文件默认私有。
-   [ ] 能删除项目及其关联数据。
-   [ ] 上传文件类型和大小有限制。
-   [ ] 页面支持桌面和移动端。
-   [ ] Demo 数据有明确标识。
-   [ ] README 说明安装、环境变量、数据库迁移和运行方法。

------------------------------------------------------------------------

# 16. 待核实事项

以下事项不得由 Codex
或开发者自行猜测，应在正式开发或数据接入时逐项确认。

## 16.1 数据集字段与许可证

-   [ ] 下载 YouTube Statistics
    原始文件，逐列核实字段名、字段类型和数据规模。
-   [ ] 核实 `comments.csv` 与视频文件的关联键及评论覆盖方式。
-   [ ] 核实 YouTube Statistics 原始数据文件的许可证及再分发限制。
-   [ ] 下载 Weibo Evolution 原始样本，核实 JSONL 结构、字段和时间格式。
-   [ ] 核实 Weibo 数据的研究用途限制、公开展示限制和个人信息风险。
-   [ ] 核实 ASAP 各文件的字段、标签编码和数据使用条件。
-   [ ] 核实 SMP2020-EWECT 的官方数据获取和使用要求。
-   [ ] 不得将不同数据集的字段结构当作已经完全确认。

## 16.2 平台指标定义

-   [ ] 小红书阅读、曝光、播放、收藏和分享的官方定义。
-   [ ] 抖音播放、曝光、互动和完播指标的定义。
-   [ ] 微信公众号阅读、分享、在看等指标的定义。
-   [ ] 不同平台是否提供历史指标快照。
-   [ ] 是否存在指标回补、延迟或删除导致的累计指标下降。

## 16.3 产品实现

-   [ ] MVP 首先支持哪些平台模板。
-   [ ] 评论分析先采用传统机器学习、预训练模型还是 LLM。
-   [ ] 是否需要单独部署 Python 分析服务。
-   [ ] PDF/Excel 报告导出的具体方案。
-   [ ] 用户数据保留期限和删除策略。
-   [ ] LLM 服务商、数据传输范围和费用控制。

------------------------------------------------------------------------

# 17. 参考数据集与资料

以下链接是前期研究中筛选的候选资源。链接存在不代表许可证、字段和当前可访问状态已经完成最终核验。

## 17.1 产品参考仓库

-   Content
    Dashboard：<https://github.com/tenfoldmarc/content-dashboard>
-   Daily Social Report：<https://github.com/dizzyx/daily-social-report>
-   Sentiment
    Analysis：<https://github.com/Seethaka-R/Sentiment-Analysis>
-   Social
    Stats：<https://github.com/cbsshekhawat18-lab/social-stats-social-media-manager>

## 17.2 候选数据集

-   YouTube
    Statistics（Kaggle）：<https://www.kaggle.com/datasets/advaypatil/youtube-statistics>
-   YouTube Statistics（Hugging Face
    镜像）：<https://huggingface.co/datasets/haoxianc/advaypatil_youtube-statistics>
-   Weibo Opinion
    Dynamic：<https://huggingface.co/datasets/hreyulog/weibo-opinion-dynamic-single-dim>
-   Weibo Sentiment Dynamics
    代码：<https://github.com/hreyulog/weibo-sentiment-dynamics>
-   YouTube Comment
    Exposure：<https://huggingface.co/datasets/brianhliou/youtube-comment-exposure>
-   ASAP：<https://github.com/Meituan-Dianping/asap>
-   SMP2020-EWECT：<https://smp2020ewect.github.io/>
-   ChineseNlpCorpus：<https://github.com/SophonPlus/ChineseNlpCorpus>
-   Trending YouTube Video
    Statistics：<https://www.kaggle.com/datasets/datasnaek/youtube-new>

## 17.3 开发参考

-   Next.js：<https://nextjs.org/docs>
-   Supabase：<https://supabase.com/docs>
-   PostgreSQL：<https://www.postgresql.org/docs/>
-   Pandas：<https://pandas.pydata.org/docs/>
-   Scikit-learn：<https://scikit-learn.org/stable/>
-   FastAPI：<https://fastapi.tiangolo.com/>

------------------------------------------------------------------------

## 附录 A：给 Codex 的开发约束

开发时遵循以下要求：

1.  先阅读本文件，再检查现有仓库结构，不要直接重建或覆盖已有项目。
2.  先完成数据库模型、数据导入和指标计算，再开发复杂 UI。
3.  不要假设第三方数据集字段与本文示例完全一致；先读取真实文件并生成字段报告。
4.  不要编造数据、许可证、平台 API 或模型效果。
5.  不要把 NULL 转成 0。
6.  不要把不同平台的指标在没有定义依据时直接比较。
7.  所有分析任务必须可追溯到导入批次、数据版本和模型版本。
8.  AI 洞察只能引用分析引擎提供的统计结果。
9.  原始数据默认私有；用户数据不得默认用于训练。
10. 先交付可运行的最小闭环，不要一次性开发所有设想功能。
11. 对尚未确认的字段、规则和授权，在代码和界面中明确标记，不要自行补全。
12. 每个阶段完成后运行测试，并更新 README 与变更记录。

## 附录 B：版本记录

  -------------------------------------------------------------------------------------------------------------
  版本                    日期                    说明
  ----------------------- ----------------------- -------------------------------------------------------------
  V1.0                    2026-11-02              建立产品数据字典、导入模板规范、指标口径、数据质量、NLP、AI
                                                  洞察及 MVP 验收框架

  -------------------------------------------------------------------------------------------------------------

**文档结束。**
