import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const image = new URL("/og.png", origin).toString();

  return {
    title: "盘层 PanLayer｜A股每日复盘",
    description: "以可复算的数据层记录市场温度、连板梯队、热点板块与盘前催化。",
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: {
      title: "盘层 PanLayer",
      description: "看见市场表象之下。",
      type: "website",
      images: [{ url: image, width: 1200, height: 630, alt: "盘层 PanLayer" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "盘层 PanLayer",
      description: "看见市场表象之下。",
      images: [image],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
