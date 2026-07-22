import type { Metadata } from "next";
import { Hero } from "./components/Hero";

export const metadata: Metadata = {
  title: "盘层 PanLayer｜看见市场表象之下",
  description: "把涨跌家数、连板梯队、资金与产业催化沉淀为可回看的每日市场切片。",
};

export default function Home() {
  return <Hero />;
}
