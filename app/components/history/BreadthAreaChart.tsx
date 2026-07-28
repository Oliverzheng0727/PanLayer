"use client";

import { useId } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { IntradayBreadthPoint } from "../../../lib/data/repository";

export function BreadthAreaChart({
  points,
  height,
  compact = false,
  label,
}: {
  points: IntradayBreadthPoint[];
  height: number | string;
  compact?: boolean;
  label: string;
}) {
  const chartId = useId().replaceAll(":", "");
  const riseGradient = `breadth-rise-${chartId}`;
  const fallGradient = `breadth-fall-${chartId}`;

  return (
    <div style={{ height }} role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={points}
          margin={compact
            ? { top: 8, right: 8, bottom: 0, left: -18 }
            : { top: 10, right: 8, bottom: 0, left: 0 }}
        >
          <defs>
            <linearGradient id={riseGradient} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#ef5b58" stopOpacity={compact ? 0.22 : 0.34} />
              <stop offset="95%" stopColor="#ef5b58" stopOpacity={0} />
            </linearGradient>
            <linearGradient id={fallGradient} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3bc987" stopOpacity={compact ? 0.14 : 0.2} />
              <stop offset="95%" stopColor="#3bc987" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(255,255,255,.05)" vertical={false} />
          <XAxis
            dataKey="time"
            axisLine={false}
            tickLine={false}
            minTickGap={compact ? 28 : 12}
            tick={{ fill: "rgba(255,255,255,.35)", fontSize: compact ? 9 : 11 }}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fill: "rgba(255,255,255,.28)", fontSize: compact ? 9 : 11 }}
            width={compact ? 34 : 42}
          />
          <Tooltip
            contentStyle={{
              background: "#151617",
              border: "1px solid rgba(255,255,255,.1)",
              borderRadius: 14,
              fontSize: compact ? 10 : 12,
            }}
            labelStyle={{ color: "rgba(255,255,255,.72)" }}
          />
          <Area
            type="monotone"
            dataKey="rising"
            name="上涨"
            stroke="#ef5b58"
            strokeWidth={compact ? 1.6 : 2}
            fill={`url(#${riseGradient})`}
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey="falling"
            name="下跌"
            stroke="#3bc987"
            strokeWidth={compact ? 1.6 : 2}
            fill={`url(#${fallGradient})`}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
