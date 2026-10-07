import type { Metadata } from "next";
import "./globals.css";
import { AnonMode } from "@/components/shell/AnonMode";
import { ANON_BOOT_SCRIPT } from "@/lib/anon";

export const metadata: Metadata = {
  title: "Aidit｜修業規劃與畢業審查輔助系統",
  description: "讀取修課紀錄，逐類別比對畢業學分，產出可溯源的審查結果與下學期選課建議。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant" suppressHydrationWarning>
      <head>
        {/* 匿名展示模式：第一次繪製前就要知道，才不會先露出真名再換掉 */}
        <script dangerouslySetInnerHTML={{ __html: ANON_BOOT_SCRIPT }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Noto+Sans+TC:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {children}
        <AnonMode />
      </body>
    </html>
  );
}
