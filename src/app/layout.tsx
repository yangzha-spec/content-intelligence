import type { Metadata } from 'next';
import './globals.css';
import './import.css';
import './analysis.css';
import './review.css';

export const metadata: Metadata = {
  title: 'Content Intelligence · 内容洞察工作台',
  description: '把内容表现与用户反馈，变成下一步的行动。',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
