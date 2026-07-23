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
      <small><Clock3 size={10} />{source.publishedAt ?? "发布时间未提供"}</small>
    </a>
  );
}

function TableProvenance({ block }: { block: Extract<BriefBlock, { type: "table" }> }) {
  if (block.provenance.kind === "search") return null;
  return <p className="brief-table-provenance">{block.provenance.label} · 市场时间 {block.provenance.marketTime} · {block.provenance.providers.join(" / ")}</p>;
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
        return <aside key={id} className={`brief-block brief-callout ${calloutClass[block.tone]}`} aria-label={block.tone === "risk" ? "风险提示" : block.tone === "missing" ? "内容暂缺" : "重点提示"}><p>{block.text}</p>{block.tone !== "missing" && <SourceChips brief={brief} block={block} />}{block.tone === "missing" && <span className="brief-source-missing">来源暂缺，未提供链接。</span>}</aside>;
      })}
    </div>
  );
}
