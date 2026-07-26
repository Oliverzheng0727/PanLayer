"use client";

import { RefreshCw } from "lucide-react";
import { useState } from "react";

export function Tier2RerunButton() {
  const [state, setState] = useState<"idle" | "running" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  const rerun = async () => {
    if (state === "running") return;
    setState("running");
    setMessage("正在重跑…");
    try {
      const response = await fetch("/api/v1/admin/jobs/tier2-news-prefetch/run?force=true", {
        method: "POST",
        credentials: "include",
      });
      const payload = await response.json().catch(() => ({})) as { ok?: boolean; message?: string; error?: string };
      if (!response.ok || payload.ok === false) throw new Error(payload.error ?? payload.message ?? "重跑请求未完成");
      setState("success");
      setMessage(payload.message ?? "已完成，正在刷新…");
      window.setTimeout(() => window.location.reload(), 700);
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "重跑失败，请稍后重试。");
    }
  };

  return (
    <div className="brief-regenerate">
      <button
        type="button"
        onClick={rerun}
        disabled={state === "running"}
        className="brief-regenerate-button"
        aria-label="手动重跑二级资讯 Firecrawl"
      >
        <RefreshCw size={12} className={state === "running" ? "animate-spin" : ""} />
        {state === "running" ? "重跑中" : "手动重跑"}
      </button>
      {message && <span role={state === "error" ? "alert" : "status"}>{message}</span>}
    </div>
  );
}
