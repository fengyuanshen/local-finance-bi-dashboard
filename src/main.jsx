import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as XLSX from "xlsx";
import {
  BarChart3,
  Database,
  Download,
  FileSpreadsheet,
  Filter,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Trash2,
  Upload,
} from "lucide-react";
import "./styles.css";

const DB_NAME = "local-finance-bi";
const DB_VERSION = 1;
const STORE = "state";
const STATE_KEY = "dashboard";

const CATEGORIES = [
  "餐饮",
  "交通",
  "购物",
  "数码",
  "娱乐",
  "医疗",
  "住房",
  "教育",
  "旅行",
  "订阅",
  "金融",
  "转账",
  "其他",
];

const BUILTIN_RULES = [
  { category: "餐饮", keywords: ["餐", "饭", "咖啡", "星巴克", "瑞幸", "美团", "饿了么", "肯德基", "麦当劳"] },
  { category: "交通", keywords: ["滴滴", "地铁", "公交", "高德", "加油", "停车", "铁路", "12306", "机票"] },
  { category: "购物", keywords: ["淘宝", "天猫", "京东", "拼多多", "抖音", "小红书", "超市", "便利"] },
  { category: "数码", keywords: ["Apple", "苹果", "华为", "小米", "数码", "电子"] },
  { category: "娱乐", keywords: ["电影", "影院", "游戏", "Steam", "网易云", "腾讯视频", "爱奇艺"] },
  { category: "医疗", keywords: ["医院", "药", "门诊", "体检", "医保"] },
  { category: "住房", keywords: ["房租", "物业", "水费", "电费", "燃气", "宽带"] },
  { category: "教育", keywords: ["课程", "培训", "学费", "考试", "书店"] },
  { category: "旅行", keywords: ["酒店", "携程", "飞猪", "民宿", "航旅"] },
  { category: "订阅", keywords: ["订阅", "会员", "Netflix", "Spotify", "iCloud", "OpenAI"] },
  { category: "金融", keywords: ["保险", "基金", "理财", "证券", "利息"] },
];

const TRANSFER_KEYWORDS = [
  "信用卡还款",
  "还款",
  "自动还款",
  "账户互转",
  "转账",
  "理财",
  "基金申购",
  "基金赎回",
  "证券",
  "余额宝",
  "零钱通",
];

const CREDIT_HEADERS = ["交易日期", "记账日期", "交易摘要", "卡号末四位", "卡片类型", "交易币种", "交易金额"];
const DEBIT_HEADERS = ["交易日期", "交易类型", "存入金额", "取出金额", "余额"];

const initialState = {
  transactions: [],
  rules: [],
  importHistory: [],
};

const defaultTopFilters = {
  months: [],
  monthToAdd: "",
  minAmount: "",
  maxAmount: "",
  source: "全部",
  category: "全部",
  account: "全部",
  cardType: "全部",
  keyword: "",
  sort: "amount",
};

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadState() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(STATE_KEY);
    req.onsuccess = () => resolve(req.result || initialState);
    req.onerror = () => reject(req.error);
  });
}

async function saveState(state) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(state, STATE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function normalizeHeader(value) {
  return String(value || "")
    .replace(/\s+/g, "")
    .replace(/：/g, ":")
    .trim();
}

function parseMoney(value) {
  if (value === undefined || value === null || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const text = String(value).replace(/,/g, "").replace(/￥|¥|CNY|RMB/gi, "").trim();
  const match = text.match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function parseDate(value) {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "number") {
    const date = XLSX.SSF.parse_date_code(value);
    if (date) return `${date.y}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}`;
  }
  const text = String(value).trim();
  const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  const match = text.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (match) return `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}`;
  return text.slice(0, 10);
}

function monthOf(date) {
  return String(date || "").slice(0, 7);
}

function detectHeaderRow(rows) {
  let best = { index: 0, score: 0 };
  rows.slice(0, 25).forEach((row, index) => {
    const cells = row.map(normalizeHeader);
    const score =
      CREDIT_HEADERS.filter((h) => cells.includes(h)).length +
      DEBIT_HEADERS.filter((h) => cells.includes(h)).length;
    if (score > best.score) best = { index, score };
  });
  return best;
}

function rowsFromSheet(sheet) {
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
}

function tableFromRows(rows) {
  const header = detectHeaderRow(rows);
  const headers = rows[header.index].map((h) => normalizeHeader(h));
  const body = rows.slice(header.index + 1).filter((row) => row.some((cell) => String(cell || "").trim()));
  const objects = body.map((row) => {
    const item = {};
    headers.forEach((key, index) => {
      if (key) item[key] = row[index] ?? "";
    });
    return item;
  });
  return { headerIndex: header.index, headers, rows: objects };
}

function detectType(headers) {
  const set = new Set(headers);
  if (CREDIT_HEADERS.filter((h) => set.has(h)).length >= 5) return "credit";
  if (DEBIT_HEADERS.filter((h) => set.has(h)).length >= 4) return "debit";
  return "unknown";
}

function isTransferLike(text) {
  return TRANSFER_KEYWORDS.some((word) => text.toLowerCase().includes(word.toLowerCase()));
}

function categoryFor(text, userRules) {
  const custom = userRules.find((rule) => text.toLowerCase().includes(rule.keyword.toLowerCase()));
  if (custom) return custom.category;
  const builtin = BUILTIN_RULES.find((rule) =>
    rule.keywords.some((keyword) => text.toLowerCase().includes(keyword.toLowerCase())),
  );
  return builtin?.category || "其他";
}

function normalizeCredit(row, fileName, userRules) {
  const date = parseDate(row["交易日期"] || row["记账日期"]);
  const amount = parseMoney(row["交易金额"]);
  const text = `${row["交易摘要"] || ""} ${row["原始交易金额&币种"] || ""}`;
  const isRefund = amount < 0 || /退款|退货|返还|冲正/.test(text);
  const transfer = isTransferLike(text);
  const expense = amount > 0 && !transfer ? Math.abs(amount) : 0;
  const income = isRefund ? Math.abs(amount) : 0;
  return {
    id: crypto.randomUUID(),
    date,
    month: monthOf(date),
    source: fileName.includes("未出") ? "信用卡未出账" : "信用卡",
    account: row["卡号末四位"] ? `****${row["卡号末四位"]}` : "",
    cardType: row["卡片类型"] || "",
    type: transfer ? "转账" : isRefund ? "退款" : "消费",
    summary: row["交易摘要"] || "",
    counterparty: "",
    income,
    expense,
    currency: row["交易币种"] || "CNY",
    category: transfer ? "转账" : categoryFor(text, userRules),
    raw: row,
    importFile: fileName,
    importedAt: new Date().toISOString(),
  };
}

function normalizeDebit(row, fileName, userRules) {
  const date = parseDate(row["交易日期"]);
  const income = Math.abs(parseMoney(row["存入金额"]));
  const expenseRaw = Math.abs(parseMoney(row["取出金额"]));
  const text = `${row["交易类型"] || ""} ${row["对方全称"] || ""} ${row["附言"] || ""}`;
  const transfer = isTransferLike(text);
  return {
    id: crypto.randomUUID(),
    date,
    month: monthOf(date),
    source: "借记卡",
    account: row["账号"] || "",
    cardType: row["账户类型"] || "",
    type: transfer ? "转账" : income > 0 ? "收入" : "消费",
    summary: row["交易类型"] || row["附言"] || "",
    counterparty: row["对方全称"] || "",
    income: transfer ? 0 : income,
    expense: transfer ? 0 : expenseRaw,
    currency: row["币别号"] || "CNY",
    category: transfer ? "转账" : categoryFor(text, userRules),
    raw: row,
    importFile: fileName,
    importedAt: new Date().toISOString(),
  };
}

function normalizeRows(imported, userRules) {
  if (imported.type === "credit") {
    return imported.rows.map((row) => normalizeCredit(row, imported.fileName, userRules)).filter((tx) => tx.date && tx.month);
  }
  if (imported.type === "debit") {
    return imported.rows.map((row) => normalizeDebit(row, imported.fileName, userRules)).filter((tx) => tx.date && tx.month);
  }
  return [];
}

async function readImportFile(file) {
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { type: "array", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = rowsFromSheet(sheet);
  const table = tableFromRows(rows);
  return {
    fileName: file.name,
    sheetName: workbook.SheetNames[0],
    type: detectType(table.headers),
    ...table,
  };
}

function formatCurrency(value) {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 0 }).format(value || 0);
}

function formatAxisCurrency(value) {
  const abs = Math.abs(value || 0);
  if (abs >= 10000) return `${value < 0 ? "-" : ""}${(abs / 10000).toFixed(abs >= 100000 ? 0 : 1)}万`;
  if (abs >= 1000) return `${value < 0 ? "-" : ""}${(abs / 1000).toFixed(abs >= 10000 ? 0 : 1)}千`;
  return `${Math.round(value || 0)}`;
}

function csvEscape(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function downloadCsv(name, rows) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [headers.join(","), ...rows.map((row) => headers.map((h) => csvEscape(row[h])).join(","))].join("\n");
  downloadBlob(`${name}.csv`, `\uFEFF${csv}`, "text/csv;charset=utf-8");
}

function downloadBlob(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function summarize(transactions) {
  const map = new Map();
  transactions.forEach((tx) => {
    const item = map.get(tx.month) || {
      month: tx.month,
      income: 0,
      expense: 0,
      creditExpense: 0,
      debitExpense: 0,
      refund: 0,
      net: 0,
      count: 0,
    };
    item.income += tx.income || 0;
    item.expense += tx.expense || 0;
    if (tx.source.startsWith("信用卡")) item.creditExpense += tx.expense || 0;
    if (tx.source === "借记卡") item.debitExpense += tx.expense || 0;
    if (tx.type === "退款") item.refund += tx.income || 0;
    item.count += 1;
    item.net = item.income - item.expense;
    map.set(tx.month, item);
  });
  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
}

function textOfTransaction(tx) {
  return `${tx.summary || ""} ${tx.counterparty || ""} ${tx.account || ""} ${tx.category || ""} ${tx.source || ""}`.toLowerCase();
}

function transactionAmount(tx, kind) {
  if (kind === "income") return tx.income || 0;
  if (kind === "expense") return tx.expense || 0;
  return Math.max(tx.income || 0, tx.expense || 0);
}

function aggregateInsight(transactions, key, kind = "expense") {
  const total = transactions.reduce((sum, tx) => sum + transactionAmount(tx, kind), 0);
  const map = new Map();
  transactions.forEach((tx) => {
    const name = tx[key] || "未标记";
    const item = map.get(name) || { name, amount: 0, count: 0, share: 0 };
    item.amount += transactionAmount(tx, kind);
    item.count += 1;
    item.share = total ? item.amount / total : 0;
    map.set(name, item);
  });
  return [...map.values()].sort((a, b) => b.amount - a.amount);
}

function applyFilters(transactions, filters) {
  const minAmount = parseMoney(filters.minAmount);
  const maxAmount = parseMoney(filters.maxAmount);
  const keyword = String(filters.keyword || "").trim().toLowerCase();
  return transactions.filter((tx) => {
    if (filters.start && tx.month < filters.start) return false;
    if (filters.end && tx.month > filters.end) return false;
    if (filters.source !== "全部" && tx.source !== filters.source) return false;
    if (filters.account !== "全部" && tx.account !== filters.account) return false;
    if (filters.cardType !== "全部" && tx.cardType !== filters.cardType) return false;
    if (filters.type !== "全部" && tx.type !== filters.type) return false;
    if (filters.category !== "全部" && tx.category !== filters.category) return false;
    const amount = transactionAmount(tx, "any");
    if (filters.minAmount !== "" && amount < minAmount) return false;
    if (filters.maxAmount !== "" && amount > maxAmount) return false;
    if (keyword && !textOfTransaction(tx).includes(keyword)) return false;
    return true;
  });
}

function unique(items) {
  return ["全部", ...Array.from(new Set(items.filter(Boolean))).sort()];
}

function applyTopFilters(transactions, filters, kind) {
  const selected = new Set(filters.months);
  const minAmount = parseMoney(filters.minAmount);
  const maxAmount = parseMoney(filters.maxAmount);
  const keyword = String(filters.keyword || "").trim().toLowerCase();
  return transactions.filter((tx) => {
    const amount = transactionAmount(tx, kind);
    if (amount <= 0) return false;
    if (tx.type === "转账") return false;
    if (kind === "expense" && tx.type === "退款") return false;
    if (selected.size && !selected.has(tx.month)) return false;
    if (filters.source !== "全部" && tx.source !== filters.source) return false;
    if (filters.category !== "全部" && tx.category !== filters.category) return false;
    if (filters.account !== "全部" && tx.account !== filters.account) return false;
    if (filters.cardType !== "全部" && tx.cardType !== filters.cardType) return false;
    if (filters.minAmount !== "" && amount < minAmount) return false;
    if (filters.maxAmount !== "" && amount > maxAmount) return false;
    if (keyword && !textOfTransaction(tx).includes(keyword)) return false;
    return true;
  });
}

function buildTopGroups(transactions, kind, topN, sort) {
  const map = new Map();
  transactions.forEach((tx) => {
    const rows = map.get(tx.month) || [];
    rows.push(tx);
    map.set(tx.month, rows);
  });
  return [...map.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([month, rows]) => ({
      month,
      rows: rows
        .sort((a, b) => {
          if (sort === "date") return String(b.date).localeCompare(String(a.date));
          return transactionAmount(b, kind) - transactionAmount(a, kind);
        })
        .slice(0, Math.max(1, Number(topN) || 10)),
    }));
}

function MiniBarChart({ data }) {
  const [tooltip, setTooltip] = useState(null);
  const width = 720;
  const height = 220;
  const padding = { top: 18, right: 24, bottom: 32, left: 58 };
  const max = Math.max(1, ...data.flatMap((d) => [d.income, d.expense]));
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const step = data.length ? plotWidth / data.length : 1;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({ ratio, value: max * ratio }));
  function showTooltip(event, label) {
    const rect = event.currentTarget.ownerSVGElement.getBoundingClientRect();
    setTooltip({
      label,
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
  }
  return (
    <div className="chart-frame">
      <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="收入支出柱状图">
        {ticks.map(({ ratio, value }) => {
          const y = height - padding.bottom - ratio * plotHeight;
          return (
            <g key={ratio}>
              <line x1={padding.left} y1={y} x2={width - padding.right} y2={y} className={ratio === 0 ? "" : "grid-line"} />
              <text x={padding.left - 10} y={y + 4} textAnchor="end" className="axis-label">
                {formatAxisCurrency(value)}
              </text>
            </g>
          );
        })}
        <line x1={padding.left} y1={padding.top} x2={padding.left} y2={height - padding.bottom} className="axis-line" />
        {data.map((d, i) => {
          const x = padding.left + i * step + step * 0.18;
          const incomeH = (d.income / max) * plotHeight;
          const expenseH = (d.expense / max) * plotHeight;
          return (
            <g key={d.month}>
              <rect
                x={x}
                y={height - padding.bottom - incomeH}
                width={Math.max(8, step * 0.22)}
                height={incomeH}
                rx="5"
                className="bar-income"
                onMouseEnter={(event) => showTooltip(event, `${d.month} 收入：${formatCurrency(d.income)}`)}
                onMouseMove={(event) => showTooltip(event, `${d.month} 收入：${formatCurrency(d.income)}`)}
                onMouseLeave={() => setTooltip(null)}
              />
              <rect
                x={x + Math.max(12, step * 0.26)}
                y={height - padding.bottom - expenseH}
                width={Math.max(8, step * 0.22)}
                height={expenseH}
                rx="5"
                className="bar-expense"
                onMouseEnter={(event) => showTooltip(event, `${d.month} 支出：${formatCurrency(d.expense)}`)}
                onMouseMove={(event) => showTooltip(event, `${d.month} 支出：${formatCurrency(d.expense)}`)}
                onMouseLeave={() => setTooltip(null)}
              />
              <text x={padding.left + i * step + step / 2} y={height - 8} textAnchor="middle">
                {d.month.slice(5)}
              </text>
            </g>
          );
        })}
      </svg>
      {tooltip && (
        <div className="chart-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
          {tooltip.label}
        </div>
      )}
    </div>
  );
}

function LineChart({ data }) {
  const [tooltip, setTooltip] = useState(null);
  const width = 720;
  const height = 180;
  const padding = { top: 18, right: 24, bottom: 28, left: 58 };
  const values = data.map((d) => d.net);
  const min = Math.min(0, ...values);
  const max = Math.max(1, ...values);
  const span = max - min || 1;
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const step = data.length > 1 ? plotWidth / (data.length - 1) : 0;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({ ratio, value: min + span * ratio }));
  const points = data
    .map((d, i) => {
      const x = padding.left + i * step;
      const y = height - padding.bottom - ((d.net - min) / span) * plotHeight;
      return `${x},${y}`;
    })
    .join(" ");
  const zeroY = height - padding.bottom - ((0 - min) / span) * plotHeight;
  function showTooltip(event, label) {
    const rect = event.currentTarget.ownerSVGElement.getBoundingClientRect();
    setTooltip({
      label,
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
  }
  return (
    <div className="chart-frame">
      <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="净结余趋势图">
        {ticks.map(({ ratio, value }) => {
          const y = height - padding.bottom - ratio * plotHeight;
          return (
            <g key={ratio}>
              <line x1={padding.left} y1={y} x2={width - padding.right} y2={y} className="grid-line" />
              <text x={padding.left - 10} y={y + 4} textAnchor="end" className="axis-label">
                {formatAxisCurrency(value)}
              </text>
            </g>
          );
        })}
        <line x1={padding.left} y1={padding.top} x2={padding.left} y2={height - padding.bottom} className="axis-line" />
        <line x1={padding.left} y1={height - padding.bottom} x2={width - padding.right} y2={height - padding.bottom} className="axis-line" />
        <line x1={padding.left} y1={zeroY} x2={width - padding.right} y2={zeroY} className="zero-line" />
        <polyline points={points} className="net-line" />
        {data.map((d, i) => {
          const x = padding.left + i * step;
          const y = height - padding.bottom - ((d.net - min) / span) * plotHeight;
          return (
            <g key={d.month}>
              <circle
                cx={x}
                cy={y}
                r="4"
                className="net-dot"
                onMouseEnter={(event) => showTooltip(event, `${d.month} 净结余：${formatCurrency(d.net)}`)}
                onMouseMove={(event) => showTooltip(event, `${d.month} 净结余：${formatCurrency(d.net)}`)}
                onMouseLeave={() => setTooltip(null)}
              />
              <text x={x} y={height - 8} textAnchor="middle">
                {d.month.slice(5)}
              </text>
            </g>
          );
        })}
      </svg>
      {tooltip && (
        <div className="chart-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
          {tooltip.label}
        </div>
      )}
    </div>
  );
}

function App() {
  const [state, setState] = useState(initialState);
  const [loaded, setLoaded] = useState(false);
  const [imports, setImports] = useState([]);
  const [message, setMessage] = useState("");
  const [topN, setTopN] = useState(10);
  const [expenseTopFilters, setExpenseTopFilters] = useState(defaultTopFilters);
  const [incomeTopFilters, setIncomeTopFilters] = useState(defaultTopFilters);
  const [showImportPreview, setShowImportPreview] = useState(false);
  const [autoSaveRules, setAutoSaveRules] = useState(true);
  const [filters, setFilters] = useState({
    start: "",
    end: "",
    source: "全部",
    account: "全部",
    cardType: "全部",
    type: "全部",
    category: "全部",
    minAmount: "",
    maxAmount: "",
    keyword: "",
  });
  const restoreRef = useRef(null);

  useEffect(() => {
    loadState()
      .then((saved) => setState({ ...initialState, ...saved }))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (loaded) saveState(state);
  }, [state, loaded]);

  const filtered = useMemo(() => applyFilters(state.transactions, filters), [state.transactions, filters]);
  const monthly = useMemo(() => summarize(filtered), [filtered]);
  const totals = useMemo(
    () =>
      monthly.reduce(
        (acc, row) => ({
          income: acc.income + row.income,
          expense: acc.expense + row.expense,
          creditExpense: acc.creditExpense + row.creditExpense,
          debitExpense: acc.debitExpense + row.debitExpense,
          net: acc.net + row.net,
        }),
        { income: 0, expense: 0, creditExpense: 0, debitExpense: 0, net: 0 },
      ),
    [monthly],
  );

  const expenseTopRows = useMemo(() => applyTopFilters(filtered, expenseTopFilters, "expense"), [filtered, expenseTopFilters]);
  const incomeTopRows = useMemo(() => applyTopFilters(filtered, incomeTopFilters, "income"), [filtered, incomeTopFilters]);
  const expenseTopGroups = useMemo(
    () => buildTopGroups(expenseTopRows, "expense", topN, expenseTopFilters.sort),
    [expenseTopRows, topN, expenseTopFilters.sort],
  );
  const incomeTopGroups = useMemo(
    () => buildTopGroups(incomeTopRows, "income", topN, incomeTopFilters.sort),
    [incomeTopRows, topN, incomeTopFilters.sort],
  );
  const expenseComparisonRows = useMemo(() => summarize(expenseTopRows).sort((a, b) => b.month.localeCompare(a.month)), [expenseTopRows]);
  const incomeComparisonRows = useMemo(() => summarize(incomeTopRows).sort((a, b) => b.month.localeCompare(a.month)), [incomeTopRows]);
  const expenseCategoryInsight = useMemo(() => aggregateInsight(expenseTopRows, "category", "expense").slice(0, 8), [expenseTopRows]);
  const expenseSourceInsight = useMemo(() => aggregateInsight(expenseTopRows, "source", "expense"), [expenseTopRows]);
  const incomeCategoryInsight = useMemo(() => aggregateInsight(incomeTopRows, "category", "income").slice(0, 8), [incomeTopRows]);
  const incomeSourceInsight = useMemo(() => aggregateInsight(incomeTopRows, "source", "income"), [incomeTopRows]);
  const detailRows = useMemo(
    () =>
      [...filtered]
        .sort((a, b) => String(b.date).localeCompare(String(a.date)))
        .slice(0, 300),
    [filtered],
  );

  const options = useMemo(
    () => ({
      sources: unique(state.transactions.map((tx) => tx.source)),
      accounts: unique(state.transactions.map((tx) => tx.account)),
      cardTypes: unique(state.transactions.map((tx) => tx.cardType)),
      types: unique(state.transactions.map((tx) => tx.type)),
      categories: unique([...state.transactions.map((tx) => tx.category), ...CATEGORIES]),
      months: Array.from(new Set(state.transactions.map((tx) => tx.month).filter(Boolean))).sort(),
    }),
    [state.transactions],
  );

  async function handleFiles(files) {
    const parsed = [];
    for (const file of files) {
      parsed.push(await readImportFile(file));
    }
    setImports(parsed);
    setShowImportPreview(true);
    setMessage(`已读取 ${parsed.length} 个文件，请确认预览后导入。`);
  }

  function commitImport(item) {
    if (item.type === "unknown") {
      setMessage("当前文件未识别为信用卡或借记卡账单，请检查表头。");
      return;
    }
    const normalized = normalizeRows(item, state.rules);
    setState((prev) => ({
      ...prev,
      transactions: [...prev.transactions, ...normalized],
      importHistory: [
        {
          fileName: item.fileName,
          type: item.type,
          count: normalized.length,
          importedAt: new Date().toISOString(),
        },
        ...(prev.importHistory || []),
      ].slice(0, 12),
    }));
    setImports((prev) => prev.filter((pending) => pending.fileName !== item.fileName));
    setMessage(`已导入 ${item.fileName}：${normalized.length} 条交易。`);
  }

  function updateCategory(id, category) {
    let keyword = "";
    setState((prev) => {
      const tx = prev.transactions.find((item) => item.id === id);
      keyword = (tx?.counterparty || tx?.summary || "").trim().slice(0, 24);
      const nextRules =
        autoSaveRules && keyword
          ? [...prev.rules.filter((rule) => rule.keyword !== keyword), { keyword, category }]
          : prev.rules;
      return {
        ...prev,
        rules: nextRules,
        transactions: prev.transactions.map((item) => (item.id === id ? { ...item, category } : item)),
      };
    });
  }

  function clearData() {
    if (!window.confirm("确认清空所有本地交易与分类规则？")) return;
    setState(initialState);
    setImports([]);
    setMessage("本地数据已清空。");
  }

  function exportSummary() {
    downloadCsv(
      "月度收支汇总",
      monthly.map((row) => ({
        月份: row.month,
        总收入: row.income,
        总支出: row.expense,
        信用卡支出: row.creditExpense,
        借记卡支出: row.debitExpense,
        净结余: row.net,
        交易数: row.count,
      })),
    );
  }

  function exportTopN() {
    const rows = expenseTopGroups.flatMap((group) =>
      group.rows.map((tx, index) => ({
        月份: group.month,
        排名: index + 1,
        日期: tx.date,
        金额: tx.expense,
        摘要: tx.summary,
        对方名称: tx.counterparty,
        来源: tx.source,
        账户: tx.account,
        卡片类型: tx.cardType,
        分类: tx.category,
      })),
    );
    downloadCsv(`每月TOP${topN}消费`, rows);
  }

  function exportTopIncome() {
    const rows = incomeTopGroups.flatMap((group) =>
      group.rows.map((tx, index) => ({
        月份: group.month,
        排名: index + 1,
        日期: tx.date,
        金额: tx.income,
        摘要: tx.summary,
        对方名称: tx.counterparty,
        来源: tx.source,
        账户: tx.account,
        卡片类型: tx.cardType,
        分类: tx.category,
      })),
    );
    downloadCsv(`每月TOP${topN}收入`, rows);
  }

  function backup() {
    downloadBlob(`finance-bi-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(state, null, 2), "application/json");
  }

  async function restore(file) {
    const text = await file.text();
    const data = JSON.parse(text);
    setState({
      transactions: Array.isArray(data.transactions) ? data.transactions : [],
      rules: Array.isArray(data.rules) ? data.rules : [],
      importHistory: Array.isArray(data.importHistory) ? data.importHistory : [],
    });
    setMessage("备份已恢复。");
  }

  function updateTopFilters(kind, patch) {
    const updater = kind === "income" ? setIncomeTopFilters : setExpenseTopFilters;
    updater((prev) => ({ ...prev, ...patch }));
  }

  function toggleTopMonth(kind, month) {
    const state = kind === "income" ? incomeTopFilters : expenseTopFilters;
    const months = state.months.includes(month)
      ? state.months.filter((item) => item !== month)
      : [...state.months, month].sort((a, b) => b.localeCompare(a));
    updateTopFilters(kind, { months });
  }

  function selectTopPreset(kind, preset) {
    const months = options.months.slice().reverse();
    if (preset === "latest") updateTopFilters(kind, { months: months.slice(0, 1) });
    if (preset === "last3") updateTopFilters(kind, { months: months.slice(0, 3) });
    if (preset === "last6") updateTopFilters(kind, { months: months.slice(0, 6) });
    if (preset === "all") updateTopFilters(kind, { months });
  }

  function addTopMonth(kind) {
    const state = kind === "income" ? incomeTopFilters : expenseTopFilters;
    if (!state.monthToAdd) return;
    const months = state.months.includes(state.monthToAdd)
      ? state.months
      : [...state.months, state.monthToAdd].sort((a, b) => b.localeCompare(a));
    updateTopFilters(kind, { months });
  }

  function setMonthPreset(preset) {
    const months = options.months;
    if (preset === "all") setFilters((prev) => ({ ...prev, start: "", end: "" }));
    if (preset === "latest") {
      const latest = months[months.length - 1] || "";
      setFilters((prev) => ({ ...prev, start: latest, end: latest }));
    }
    if (preset === "last3") {
      const selected = months.slice(-3);
      setFilters((prev) => ({ ...prev, start: selected[0] || "", end: selected[selected.length - 1] || "" }));
    }
    if (preset === "last6") {
      const selected = months.slice(-6);
      setFilters((prev) => ({ ...prev, start: selected[0] || "", end: selected[selected.length - 1] || "" }));
    }
    if (preset === "year") {
      const year = new Date().getFullYear().toString();
      const selected = months.filter((month) => month.startsWith(year));
      setFilters((prev) => ({ ...prev, start: selected[0] || `${year}-01`, end: selected[selected.length - 1] || `${year}-12` }));
    }
  }

  return (
    <main className="app">
      <header className="topbar">
        <div>
          <p className="eyebrow">Local only</p>
          <h1>本地收支 BI 看板</h1>
        </div>
        <div className="status">
          <Database size={18} />
          <span>{state.transactions.length} 条交易</span>
        </div>
      </header>

      <section className="band import-band">
        <div className="section-title split">
          <div className="title-row">
            <FileSpreadsheet size={20} />
            <div>
              <p className="eyebrow">Import</p>
              <h2>导入中心</h2>
            </div>
          </div>
          {imports.length > 0 && (
            <button className="ghost-btn" onClick={() => setShowImportPreview((value) => !value)}>
              {showImportPreview ? "收起预览" : `查看待导入 ${imports.length}`}
            </button>
          )}
        </div>
        <div className="import-grid">
          <label className="dropzone">
            <Upload size={28} />
            <span>选择信用卡 / 借记卡 Excel 或 CSV 文件</span>
            <input
              type="file"
              accept=".xls,.xlsx,.csv"
              multiple
              onChange={(event) => handleFiles(Array.from(event.target.files || []))}
            />
          </label>
          <div className="import-help">
            <p>信用卡字段：交易日期、记账日期、交易摘要、卡号末四位、卡片类型、交易币种、交易金额。</p>
            <p>借记卡字段：交易日期、交易类型、存入金额、取出金额、余额、对方全称、附言。</p>
          </div>
        </div>
        {message && <div className="message">{message}</div>}
        {imports.length > 0 && showImportPreview && <div className="pending-strip">
          {imports.map((item) => (
            <button key={item.fileName} className="pending-file" onClick={() => commitImport(item)}>
              <span>{item.fileName}</span>
              <strong>{item.type === "credit" ? "信用卡" : item.type === "debit" ? "借记卡" : "未识别"}</strong>
            </button>
          ))}
        </div>}
        {imports.length > 0 && showImportPreview && <div className="preview-list">
          {imports.map((item) => (
            <article className="preview-card" key={item.fileName}>
              <div className="preview-head">
                <div>
                  <strong>{item.fileName}</strong>
                  <span>{item.type === "credit" ? "信用卡账单" : item.type === "debit" ? "借记卡账单" : "未识别"} · 表头第 {item.headerIndex + 1} 行</span>
                </div>
                <button className="primary-btn" onClick={() => commitImport(item)}>
                  <Save size={16} />
                  导入
                </button>
              </div>
              <div className="table-wrap compact">
                <table>
                  <thead>
                    <tr>{item.headers.slice(0, 8).map((header) => <th key={header}>{header}</th>)}</tr>
                  </thead>
                  <tbody>
                    {item.rows.slice(0, 5).map((row, index) => (
                      <tr key={index}>
                        {item.headers.slice(0, 8).map((header) => <td key={header}>{row[header]}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          ))}
        </div>}
        {(state.importHistory || []).length > 0 && (
          <div className="import-history">
            <span>最近导入</span>
            {(state.importHistory || []).slice(0, 6).map((item) => (
              <small key={`${item.fileName}-${item.importedAt}`}>
                {item.fileName} · {item.count} 条
              </small>
            ))}
          </div>
        )}
      </section>

      <section className="band filter-band">
        <div className="section-title">
          <Filter size={20} />
          <h2>筛选</h2>
        </div>
        <div className="preset-actions filter-presets">
          <button onClick={() => setMonthPreset("all")}>全部</button>
          <button onClick={() => setMonthPreset("year")}>今年</button>
          <button onClick={() => setMonthPreset("latest")}>最新月份</button>
          <button onClick={() => setMonthPreset("last3")}>近 3 月</button>
          <button onClick={() => setMonthPreset("last6")}>近 6 月</button>
        </div>
        <div className="filters">
          <label>
            起始月份
            <select value={filters.start} onChange={(e) => setFilters({ ...filters, start: e.target.value })}>
              <option value="">不限</option>
              {options.months.map((month) => (
                <option key={month} value={month}>{month}</option>
              ))}
            </select>
          </label>
          <label>
            结束月份
            <select value={filters.end} onChange={(e) => setFilters({ ...filters, end: e.target.value })}>
              <option value="">不限</option>
              {options.months.map((month) => (
                <option key={month} value={month}>{month}</option>
              ))}
            </select>
          </label>
          <Select label="来源" value={filters.source} options={options.sources} onChange={(source) => setFilters({ ...filters, source })} />
          <Select label="账户" value={filters.account} options={options.accounts} onChange={(account) => setFilters({ ...filters, account })} />
          <Select label="卡片类型" value={filters.cardType} options={options.cardTypes} onChange={(cardType) => setFilters({ ...filters, cardType })} />
          <Select label="交易类型" value={filters.type} options={options.types} onChange={(type) => setFilters({ ...filters, type })} />
          <Select label="分类" value={filters.category} options={options.categories} onChange={(category) => setFilters({ ...filters, category })} />
          <label>
            最小金额
            <input inputMode="decimal" value={filters.minAmount} onChange={(e) => setFilters({ ...filters, minAmount: e.target.value })} placeholder="不限" />
          </label>
          <label>
            最大金额
            <input inputMode="decimal" value={filters.maxAmount} onChange={(e) => setFilters({ ...filters, maxAmount: e.target.value })} placeholder="不限" />
          </label>
          <label className="wide-filter">
            关键词
            <input value={filters.keyword} onChange={(e) => setFilters({ ...filters, keyword: e.target.value })} placeholder="摘要 / 对方 / 账户 / 分类" />
          </label>
        </div>
      </section>

      <section className="metrics">
        <Metric title="总收入" value={formatCurrency(totals.income)} tone="income" />
        <Metric title="总支出" value={formatCurrency(totals.expense)} tone="expense" />
        <Metric title="信用卡支出" value={formatCurrency(totals.creditExpense)} />
        <Metric title="借记卡支出" value={formatCurrency(totals.debitExpense)} />
        <Metric title="净结余" value={formatCurrency(totals.net)} tone={totals.net >= 0 ? "income" : "expense"} />
      </section>

      <section className="charts">
        <article className="chart-card chart-card-bars">
          <div className="section-title">
            <BarChart3 size={20} />
            <h2>月度收入 / 支出</h2>
          </div>
          <MiniBarChart data={monthly} />
          <div className="legend">
            <span><i className="income-dot" />收入</span>
            <span><i className="expense-dot" />支出</span>
          </div>
        </article>
        <article className="chart-card chart-card-line">
          <div className="section-title">
            <SlidersHorizontal size={20} />
            <h2>净结余趋势</h2>
          </div>
          <LineChart data={monthly} />
        </article>
      </section>

      <section className="band monthly-matrix-band">
        <div className="section-title split">
          <div>
            <p className="eyebrow">按月横向审视收支</p>
            <h2>月度对比矩阵</h2>
          </div>
          <button onClick={exportSummary}>
            <Download size={16} />
            导出汇总
          </button>
        </div>
        <div className="table-wrap matrix-table">
          <table>
            <thead>
              <tr>
                <th>月份</th>
                <th>总收入</th>
                <th>总支出</th>
                <th>信用卡支出</th>
                <th>借记卡支出</th>
                <th>净结余</th>
                <th>交易数</th>
              </tr>
            </thead>
            <tbody>
              {[...monthly].reverse().map((row) => (
                <tr key={row.month}>
                  <td>{row.month}</td>
                  <td>{formatCurrency(row.income)}</td>
                  <td className="money">{formatCurrency(row.expense)}</td>
                  <td>{formatCurrency(row.creditExpense)}</td>
                  <td>{formatCurrency(row.debitExpense)}</td>
                  <td className={row.net >= 0 ? "positive" : "money"}>{formatCurrency(row.net)}</td>
                  <td>{row.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="band top-spend-band">
        <TopAnalysis
          title="每月 TOP N 消费"
          eyebrow="支出明细筛选、月份对比和结构分析"
          kind="expense"
          topN={topN}
          setTopN={setTopN}
          filters={expenseTopFilters}
          updateFilters={(patch) => updateTopFilters("expense", patch)}
          options={options}
          groups={expenseTopGroups}
          comparisonRows={expenseComparisonRows}
          categoryInsight={expenseCategoryInsight}
          sourceInsight={expenseSourceInsight}
          autoSaveRules={autoSaveRules}
          setAutoSaveRules={setAutoSaveRules}
          onSelectPreset={(preset) => selectTopPreset("expense", preset)}
          onToggleMonth={(month) => toggleTopMonth("expense", month)}
          onAddMonth={() => addTopMonth("expense")}
          onExport={exportTopN}
          updateCategory={updateCategory}
        />
      </section>

      <section className="band top-income-band">
        <TopAnalysis
          title="每月 TOP N 收入"
          eyebrow="收入明细筛选、月份对比和来源分析"
          kind="income"
          topN={topN}
          setTopN={setTopN}
          filters={incomeTopFilters}
          updateFilters={(patch) => updateTopFilters("income", patch)}
          options={options}
          groups={incomeTopGroups}
          comparisonRows={incomeComparisonRows}
          categoryInsight={incomeCategoryInsight}
          sourceInsight={incomeSourceInsight}
          autoSaveRules={autoSaveRules}
          setAutoSaveRules={setAutoSaveRules}
          onSelectPreset={(preset) => selectTopPreset("income", preset)}
          onToggleMonth={(month) => toggleTopMonth("income", month)}
          onAddMonth={() => addTopMonth("income")}
          onExport={exportTopIncome}
          updateCategory={updateCategory}
        />
      </section>

      <section className="band detail-band">
        <div className="section-title split">
          <div>
            <p className="eyebrow">响应全局筛选</p>
            <h2>交易明细</h2>
          </div>
          <span className="muted-note">显示最近 {detailRows.length} 条</span>
        </div>
        <TransactionTable rows={detailRows} kind="any" updateCategory={updateCategory} />
      </section>

      <section className="band data-band">
        <div className="section-title">
          <Download size={20} />
          <h2>数据管理</h2>
        </div>
        <div className="actions">
          <button onClick={exportSummary}><Download size={16} />导出月度汇总</button>
          <button onClick={exportTopN}><Download size={16} />导出 TOP N</button>
          <button onClick={backup}><Save size={16} />备份 JSON</button>
          <button onClick={() => restoreRef.current?.click()}><RotateCcw size={16} />恢复备份</button>
          <button className="danger" onClick={clearData}><Trash2 size={16} />清空本地数据</button>
          <input ref={restoreRef} hidden type="file" accept=".json" onChange={(event) => event.target.files?.[0] && restore(event.target.files[0])} />
        </div>
      </section>
    </main>
  );
}

function Select({ label, value, options, onChange }) {
  return (
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

function TopAnalysis({
  title,
  eyebrow,
  kind,
  topN,
  setTopN,
  filters,
  updateFilters,
  options,
  groups,
  comparisonRows,
  categoryInsight,
  sourceInsight,
  autoSaveRules,
  setAutoSaveRules,
  onSelectPreset,
  onToggleMonth,
  onAddMonth,
  onExport,
  updateCategory,
}) {
  const isIncome = kind === "income";
  return (
    <>
      <div className="section-title split">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
        </div>
        <div className="section-actions">
          <label className="topn">
            TOP
            <input min="1" max="100" type="number" value={topN} onChange={(e) => setTopN(e.target.value)} />
          </label>
          <button onClick={onExport}>
            <Download size={16} />
            导出
          </button>
          <label className="rule-toggle">
            <input type="checkbox" checked={autoSaveRules} onChange={(e) => setAutoSaveRules(e.target.checked)} />
            分类规则
          </label>
        </div>
      </div>
      <div className="month-controls">
        <div className="month-picker-row">
          <label>
            指定月份
            <select value={filters.monthToAdd} onChange={(e) => updateFilters({ monthToAdd: e.target.value })}>
              <option value="">选择月份</option>
              {options.months.slice().reverse().map((month) => (
                <option key={month} value={month}>{month}</option>
              ))}
            </select>
          </label>
          <button className="primary-btn" onClick={onAddMonth}>加入对比</button>
          <button onClick={() => updateFilters({ months: [] })}>清空月份</button>
        </div>
        <div className="preset-actions">
          <button onClick={() => onSelectPreset("latest")}>最新月份</button>
          <button onClick={() => onSelectPreset("last3")}>近 3 月</button>
          <button onClick={() => onSelectPreset("last6")}>近 6 月</button>
          <button onClick={() => onSelectPreset("all")}>全部月份</button>
        </div>
        <div className="month-chip-grid">
          {options.months.slice().reverse().map((month) => (
            <button
              className={`month-chip ${filters.months.includes(month) ? "active" : ""}`}
              key={month}
              onClick={() => onToggleMonth(month)}
            >
              {month}
            </button>
          ))}
        </div>
        <div className="local-filters">
          <Select label="来源" value={filters.source} options={options.sources} onChange={(source) => updateFilters({ source })} />
          <Select label="账户" value={filters.account} options={options.accounts} onChange={(account) => updateFilters({ account })} />
          <Select label="卡片类型" value={filters.cardType} options={options.cardTypes} onChange={(cardType) => updateFilters({ cardType })} />
          <Select label="分类" value={filters.category} options={options.categories} onChange={(category) => updateFilters({ category })} />
          <label>
            最小金额
            <input inputMode="decimal" value={filters.minAmount} onChange={(e) => updateFilters({ minAmount: e.target.value })} placeholder="不限" />
          </label>
          <label>
            最大金额
            <input inputMode="decimal" value={filters.maxAmount} onChange={(e) => updateFilters({ maxAmount: e.target.value })} placeholder="不限" />
          </label>
          <label>
            排序
            <select value={filters.sort} onChange={(e) => updateFilters({ sort: e.target.value })}>
              <option value="amount">金额降序</option>
              <option value="date">日期降序</option>
            </select>
          </label>
          <label className="wide-filter">
            关键词
            <input value={filters.keyword} onChange={(e) => updateFilters({ keyword: e.target.value })} placeholder="摘要 / 对方 / 账户 / 分类" />
          </label>
        </div>
      </div>
      <div className="comparison-grid">
        {comparisonRows.map((row) => (
          <article className="compare-card" key={row.month}>
            <span>{row.month}</span>
            <strong>{formatCurrency(isIncome ? row.income : row.expense)}</strong>
            <small>{isIncome ? `支出 ${formatCurrency(row.expense)}` : `收入 ${formatCurrency(row.income)}`} · 结余 {formatCurrency(row.net)}</small>
          </article>
        ))}
      </div>
      <section className="insight-grid">
        <InsightPanel title={isIncome ? "收入分类结构" : "分类支出结构"} rows={categoryInsight} />
        <InsightPanel title={isIncome ? "收入来源结构" : "来源支出结构"} rows={sourceInsight} />
      </section>
      <div className="top-list">
        {groups.map((group) => (
          <article className="month-card" key={group.month}>
            <h3>{group.month}</h3>
            <TransactionTable rows={group.rows} kind={kind} updateCategory={updateCategory} />
          </article>
        ))}
        {!groups.length && <div className="empty">当前筛选条件下没有可展示的{isIncome ? "收入" : "消费"}。</div>}
      </div>
    </>
  );
}

function TransactionTable({ rows, kind, updateCategory }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>日期</th>
            <th>金额</th>
            <th>类型</th>
            <th>摘要</th>
            <th>对方名称</th>
            <th>来源</th>
            <th>账户</th>
            <th>分类</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((tx) => {
            const amount = kind === "income" ? tx.income : kind === "expense" ? tx.expense : transactionAmount(tx, "any");
            const isIncome = kind === "income" || (kind === "any" && tx.income > tx.expense);
            return (
              <tr key={tx.id}>
                <td>{tx.date}</td>
                <td className={isIncome ? "positive" : "money"}>{formatCurrency(amount)}</td>
                <td>{tx.type}</td>
                <td>{tx.summary}</td>
                <td>{tx.counterparty}</td>
                <td>{tx.source}</td>
                <td>{tx.account}</td>
                <td>
                  <select value={tx.category} onChange={(event) => updateCategory(tx.id, event.target.value)} title="修改分类">
                    {CATEGORIES.map((category) => (
                      <option key={category}>{category}</option>
                    ))}
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function InsightPanel({ title, rows }) {
  const max = Math.max(1, ...rows.map((row) => row.amount));
  return (
    <article className="insight-panel">
      <h3>{title}</h3>
      <div className="insight-list">
        {rows.map((row) => (
          <div className="insight-row" key={row.name}>
            <div className="insight-row-head">
              <span>{row.name}</span>
              <strong>{formatCurrency(row.amount)}</strong>
            </div>
            <div className="insight-track">
              <i style={{ width: `${Math.max(4, (row.amount / max) * 100)}%` }} />
            </div>
            <small>{row.count} 笔 · {(row.share * 100).toFixed(1)}%</small>
          </div>
        ))}
        {!rows.length && <div className="empty compact-empty">选择月份后显示结构洞察。</div>}
      </div>
    </article>
  );
}

function Metric({ title, value, tone }) {
  return (
    <article className={`metric ${tone || ""}`}>
      <span>{title}</span>
      <strong>{value}</strong>
    </article>
  );
}

createRoot(document.getElementById("root")).render(<App />);
