/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { beijingDateParts, isChinaTradingWeekday } from "../lib/jobs/schedule";
import { runPanLayerJob, scheduledJobFromDate } from "../lib/jobs/runner";
import { readDailyJobCheckpoints, scheduledJobKey } from "../lib/jobs/checkpoints";
import { planCatchUpJobs } from "../lib/jobs/reconcile";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  DASHSCOPE_API_KEY?: string;
  OPENAI_API_KEY?: string;
  FIRECRAWL_API_KEY?: string;
  FIRECRAWL_API_URL?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
  async scheduled(controller: { scheduledTime: number }, env: Env, ctx: ExecutionContext) {
    const now = new Date(controller.scheduledTime);
    if (!isChinaTradingWeekday(now)) return;
    const { date } = beijingDateParts(now);
    const exactJob = scheduledJobFromDate(now);
    const checkpoints = await readDailyJobCheckpoints(env.DB, date).catch(() => []);
    const catchUpJobs = planCatchUpJobs({ tradeDate: date, now, checkpoints });
    const jobs = [...(exactJob ? [exactJob] : []), ...catchUpJobs]
      .filter((job, index, all) => all.findIndex((candidate) => scheduledJobKey(candidate) === scheduledJobKey(job)) === index)
      .slice(0, 2);
    if (jobs.length > 0) {
      ctx.waitUntil(Promise.allSettled(jobs.map((job) => runPanLayerJob(job, now, env))));
    }
  },
};

export default worker;
