import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Loop',
  description: '群聊协作 Loop 平台',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
