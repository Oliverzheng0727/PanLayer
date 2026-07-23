"use client";

import { RefreshCw } from "lucide-react";
import { useState } from "react";
import type { BriefSectionKey } from "../../../lib/ai/morning-brief";

export function BriefRegenerateButton({ mode, section, label }: { mode?: "failed"; section?: BriefSectionKey; label?: string }) {
  const [state, setState] = useState<"idle" | "running" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  const regenerate = async () => {
    if (state === "running") return;
    setState("running");
    setMessage("正在重新生成早参…");
    try {
      const fullUrl = "/api/v1/admin/jobs/morning-brief/run?force=true";
      const url = mode === "failed" ? "/api/v1/admin/jobs/morning-brief/run?mode=failed" : section ? `/api/v1/admin/jobs/morning-brief/run?force=true&section=${encodeURIComponent(section)}` : fullUrl;
      const response = await fetch(url, { method: "POST" });
      const payload = await response.json().catch(() => ({})) as { ok?: boolean; message?: string; error?: string };
      if (!response.ok || payload.ok === false) throw new Error(payload.error ?? payload.message ?? "生成请求未完成");
      setState("success");
      setMessage(payload.message?.includes("skipped") ? "没有需要重试的模块。" : "已开始生成，正在刷新…");
      window.setTimeout(() => window.location.reload(), 450);
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "生成失败，请稍后重试。");
    }
  };

  return <div className="brief-regenerate"><button type="button" onClick={regenerate} disabled={state === "running"} className="brief-regenerate-button"><RefreshCw size={13} className={state === "running" ? "animate-spin" : ""} />{state === "running" ? "生成中" : label ?? "重新生成"}</button>{message && <span role={state === "error" ? "alert" : "status"}>{message}</span>}</div>;
}
