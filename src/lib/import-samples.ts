import { FIELDS, type DatasetKind } from './import-model.ts';
import { csvText } from './import-validation.ts';

export function templateCsv(kind: DatasetKind) { return csvText([FIELDS[kind].map(field => field.key)]); }
export function sampleCsvFiles(withErrors = false) {
  return {
    Posts: csvText([
      ['content_key', 'platform', 'title', 'content_type', 'publish_time', 'timezone', 'topic', 'tags'],
      ['sample_001', 'youtube', '内容记录的三种方式（合成）', 'video', '2026-10-01 10:00:00', 'Asia/Shanghai', '记录方法', '记录,复盘'],
      [withErrors ? 'sample_001' : 'sample_002', 'youtube', withErrors ? '' : '把读者反馈整理起来（合成）', 'video', '2026-10-02 10:00:00', 'Asia/Shanghai', '用户反馈', '反馈,复盘'],
    ]),
    Metrics: csvText([
      ['content_key', 'snapshot_time', 'snapshot_type', 'metric_profile', 'views', 'likes', 'comments_count', 'shares', 'saves'],
      ['sample_001', '2026-10-03 10:00:00', 'cumulative', 'synthetic_v1', withErrors ? '-1' : '1200', '60', '8', '3', '12'],
      ['sample_002', '2026-10-03 10:00:00', 'cumulative', 'synthetic_v1', '', '0', '', '', ''],
    ]),
    Comments: csvText([
      ['content_key', 'external_comment_id', 'comment_text', 'comment_time', 'comment_likes', 'sample_type'],
      ['sample_001', 'sample_comment_001', '这是一条用于验证导入的合成评论。', '2026-10-02 12:00:00', '2', 'top'],
      [withErrors ? 'missing_post' : 'sample_002', 'sample_comment_002', '这条合成评论不对应真实用户。', '2026-10-03 12:00:00', '0', 'top'],
    ]),
  };
}
