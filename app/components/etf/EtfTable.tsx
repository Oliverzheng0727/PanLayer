"use client";

import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import type { EtfSnapshot } from "../../../lib/data/provider";
import type { EtfSortField } from "../../../lib/etf/catalog";

const amount = (value: number | null) => value === null ? "暂缺" : value >= 1e8 ? `${(value / 1e8).toFixed(1)}亿` : `${(value / 1e4).toFixed(0)}万`;

const columns: Array<{ field?: EtfSortField; label: string }> = [
  { label: "ETF" }, { field: "price", label: "最新价" }, { field: "pctChange", label: "涨跌幅" },
  { field: "amount", label: "成交额" }, { field: "averageAmount20", label: "近20日均成交" },
  { field: "scale", label: "规模" }, { field: "turnoverRate", label: "换手" },
];

export function EtfTable({ items, selected, sort, order, onSelect, onSort }: {
  items: EtfSnapshot[];
  selected: string;
  sort: EtfSortField;
  order: "asc" | "desc";
  onSelect: (etf: EtfSnapshot) => void;
  onSort: (field: EtfSortField) => void;
}) {
  return <div className="etf-table-scroll"><table className="etf-table"><thead><tr>{columns.map((column) => <th key={column.label}>{column.field ? <button type="button" className={sort === column.field ? "active" : ""} onClick={() => onSort(column.field!)}>{column.label}{sort !== column.field ? <ChevronsUpDown size={10} /> : order === "desc" ? <ArrowDown size={10} /> : <ArrowUp size={10} />}</button> : column.label}</th>)}</tr></thead><tbody>{items.map((item) => <tr key={item.symbol} className={selected === item.symbol ? "selected" : ""} onClick={() => onSelect(item)}><td><strong>{item.name}</strong><span>{item.symbol} · {item.exchange}</span></td><td>{item.price.toFixed(3)}</td><td className={item.pctChange >= 0 ? "rise" : "fall"}>{item.pctChange > 0 ? "+" : ""}{item.pctChange.toFixed(2)}%</td><td>{amount(item.amount)}</td><td>{amount(item.averageAmount20)}</td><td>{amount(item.scale)}</td><td>{item.turnoverRate === null ? "暂缺" : `${item.turnoverRate.toFixed(2)}%`}</td></tr>)}</tbody></table>{!items.length && <div className="etf-empty">当前分类没有匹配的 ETF</div>}</div>;
}
