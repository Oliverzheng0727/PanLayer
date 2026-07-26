import { ArrowUpRight, Clock3 } from "lucide-react";
import { resolveBlockSources, type BriefBlock, type BriefSection, type BriefSource, type MorningBrief } from "../../../lib/ai/morning-brief";

type BriefWithSources = Pick<MorningBrief, "sources">;

export function briefBlockId(section: BriefSection, index: number) {
  return `${section.key}-block-${index}`;
}

function SourceChips({ brief, block }: { brief: BriefWithSources; block: BriefBlock }) {
  const sources = resolveBlockSources(brief, block);
  if (sources.length === 0) return <span className="brief-source-missing">来源暂缺</span>;

  return (
    <div className="brief-source-chips" aria-label="内容来源">
      {sources.map((source) => <SourceChip key={source.id} source={source} />)}
    </div>
  );
}

function SourceChip({ source }: { source: BriefSource }) {
  return (
    <a className="brief-source-chip" href={source.url} target="_blank" rel="noreferrer" aria-label={`打开来源：${source.title}`}>
      <span><ArrowUpRight size={11} />{source.title}</span>
      <small><Clock3 size={10} />{source.publishedAt ?? "发布时间未公开"} · 接收时间（北京时间）{formatBeijingTime(source.retrievedAt)}</small>
    </a>
  );
}

function TableProvenance({ block }: { block: Extract<BriefBlock, { type: "table" }> }) {
  if (block.provenance.kind === "search") return null;
  return <p className="brief-table-provenance">{block.provenance.label} · 市场时间 {block.provenance.marketTime} · {block.provenance.providers.join(" / ")} · <time dateTime={block.provenance.receivedAt}>接收时间（北京时间）{formatBeijingTime(block.provenance.receivedAt)}</time></p>;
}

function NewsItemBlock({ brief, block }: { brief: BriefWithSources; block: Extract<BriefBlock, { type: "news-item" }> }) {
  return (
    <article className="brief-news-item">
      <div className="brief-news-item-head">
        <span className={`brief-news-verification is-${block.verification}`}>{block.verification === "verified" ? "已核验" : block.verification === "partial" ? "部分核验" : "未核验"}</span>
        {block.publishedAt && <time dateTime={block.publishedAt}>发布时间 {formatBeijingTime(block.publishedAt)}</time>}
      </div>
      <h3>{block.event}</h3>
      <dl>
        <div><dt>原文摘录</dt><dd>“{block.excerpt}”</dd></div>
        <div><dt>核心影响</dt><dd>{block.impact}</dd></div>
        <div><dt>对应板块</dt><dd>{block.sectors.length ? block.sectors.join("、") : "暂缺"}</dd></div>
        <div><dt>客观龙头映射</dt><dd>{block.leaderMap.length ? block.leaderMap.join("、") : "未形成可验证映射"}</dd></div>
      </dl>
      <SourceChips brief={brief} block={block} />
    </article>
  );
}

function formatBeijingTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未提供";
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(date);
}

const calloutClass = {
  insight: "brief-callout-insight",
  risk: "brief-callout-risk",
  missing: "brief-callout-missing",
} as const;

export function BriefBlockRenderer({ brief, section }: { brief: BriefWithSources; section: BriefSection }) {
  return (
    <div className="brief-blocks">
      {section.blocks.map((block, index) => {
        const id = briefBlockId(section, index);
        if (block.type === "heading") return <h2 key={id} id={id} className="brief-block-heading">{block.text}</h2>;
        if (block.type === "paragraph") return <section key={id} className="brief-block brief-block-paragraph"><p>{block.text}</p><SourceChips brief={brief} block={block} /></section>;
        if (block.type === "bullets") return (
          <section key={id} className="brief-block brief-block-bullets">
            <ul>{block.items.map((item, itemIndex) => <li key={`${id}-${itemIndex}`}><p>{item.text}</p><SourceChips brief={brief} block={{ type: "paragraph", text: item.text, sourceIds: item.sourceIds }} /></li>)}</ul>
          </section>
        );
        if (block.type === "table") return (
          <section key={id} className="brief-block brief-block-table">
            <div className="brief-block-table-wrap">
              <table>
                <thead><tr>{block.columns.map((column, columnIndex) => <th key={`${id}-${columnIndex}`}>{column}</th>)}</tr></thead>
                <tbody>{block.rows.map((row, rowIndex) => <tr key={`${id}-row-${rowIndex}`}>{row.map((cell, cellIndex) => <td key={`${id}-${rowIndex}-${cellIndex}`}>{cell}</td>)}</tr>)}</tbody>
              </table>
            </div>
            <TableProvenance block={block} />
            {block.provenance.kind === "search" && <SourceChips brief={brief} block={block} />}
          </section>
        );
        if (block.type === "news-item") return <NewsItemBlock key={id} brief={brief} block={block} />;
        return <aside key={id} className={`brief-block brief-callout ${calloutClass[block.tone]}`} aria-label={block.tone === "risk" ? "风险提示" : block.tone === "missing" ? "内容暂缺" : "重点提示"}><p>{block.text}</p>{block.tone !== "missing" && <SourceChips brief={brief} block={block} />}{block.tone === "missing" && <span className="brief-source-missing">来源暂缺，未提供链接。</span>}</aside>;
      })}
    </div>
  );
}
