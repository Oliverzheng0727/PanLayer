"use client";

import { RefreshCw } from "lucide-react";
import { useState } from "react";

export function BriefRegenerateButton() {
  const [state, setState] = useState<"idle" | "running" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  const regenerate = async () => {
    if (state === "running") return;
    setState("running");
    setMessage("正在重新生成早参…");
    try {
      const response = await fetch("/api/v1/admin/jobs/morning-brief/run?force=true", { method: "POST" });
      if (!response.ok) throw new Error("生成请求未完成");
      setState("success");
      setMessage("已开始生成，正在刷新…");
      window.setTimeout(() => window.location.reload(), 450);
    } catch {
      setState("error");
      setMessage("生成失败，请稍后重试。");
    }
  };

  return <div className="brief-regenerate"><button type="button" onClick={regenerate} disabled={state === "running"} className="brief-regenerate-button"><RefreshCw size={13} className={state === "running" ? "animate-spin" : ""} />{state === "running" ? "生成中" : "重新生成"}</button>{message && <span role={state === "error" ? "alert" : "status"}>{message}</span>}</div>;
}
