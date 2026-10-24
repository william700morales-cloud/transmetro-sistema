import { useEffect, useMemo, useState } from "react";

export function Panel({ title, right, children, className = "", flush = false }) {
  return (
    <section className={`rounded-xl border border-neutral-800 bg-neutral-900 ${className}`}>
      {(title || right) && (
        <header className="flex items-center justify-between gap-2 border-b border-neutral-800 px-4 py-2.5">
          <h2 className="text-sm font-semibold text-neutral-100">{title}</h2>
          {right}
        </header>
      )}
      <div className={flush ? "" : "p-4"}>{children}</div>
    </section>
  );
}

export function Btn({ variant = "ghost", className = "", ...props }) {
  const styles = {
    primary: "border border-brand-500 bg-brand-500 text-white hover:bg-brand-400 hover:border-brand-400",
    ok: "border border-green-600 text-green-400 hover:bg-green-950",
    warn: "border border-amber-500 text-amber-300 hover:bg-amber-950",
    danger: "border border-red-600 text-red-400 hover:bg-red-950",
    ghost: "border border-neutral-700 text-neutral-200 hover:bg-neutral-800",
  }[variant];
  return (
    <button
      {...props}
      className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400 disabled:cursor-not-allowed disabled:opacity-40 ${styles} ${className}`}
    />
  );
}

export function Stat({ label, value, tone = "text-neutral-100", hint }) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3">
      <div className="text-xs text-neutral-400">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums ${tone}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-neutral-500">{hint}</div>}
    </div>
  );
}

const STATUS_STYLE = {
  "En Patio": { dot: "bg-neutral-300", text: "text-neutral-200" },
  "En Ruta": { dot: "bg-green-500", text: "text-green-400" },
  Mantenimiento: { dot: "bg-amber-400", text: "text-amber-300" },
};

export function StatusBadge({ status }) {
  const s = STATUS_STYLE[status];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${s.text}`}>
      <span className={`h-2 w-2 rounded-full ${s.dot}`} />
      {status}
    </span>
  );
}

const BADGE_TONES = {
  neutral: "border-neutral-700 text-neutral-300",
  ok: "border-green-700 bg-green-950 text-green-300",
  warn: "border-amber-600 bg-amber-950 text-amber-300",
  danger: "border-red-700 bg-red-950 text-red-300",
  info: "border-sky-700 bg-sky-950 text-sky-300",
};

export function Badge({ tone = "neutral", children, className = "" }) {
  return (
    <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium ${BADGE_TONES[tone]} ${className}`}>
      {children}
    </span>
  );
}

export function Notice({ kind = "info", children, onClose }) {
  const tone = {
    ok: "border-green-700 bg-green-950 text-green-200",
    error: "border-red-700 bg-red-950 text-red-200",
    info: "border-neutral-700 bg-neutral-900 text-neutral-200",
    warn: "border-amber-600 bg-amber-950 text-amber-200",
  }[kind];
  return (
    <div role={kind === "error" ? "alert" : "status"} className={`flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-sm ${tone}`}>
      <div className="min-w-0 break-words">{children}</div>
      {onClose && (
        <button onClick={onClose} aria-label="Cerrar aviso" className="shrink-0 text-xs opacity-70 hover:opacity-100">
          Cerrar
        </button>
      )}
    </div>
  );
}

export function Loading({ text = "Cargando" }) {
  return (
    <div className="flex items-center gap-2 py-6 text-sm text-neutral-400">
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-neutral-600 border-t-brand-400" />
      {text}
    </div>
  );
}

export const inputCls =
  "w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400";

export function Field({ label, hint, children, className = "" }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-medium text-neutral-400">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-neutral-500">{hint}</span>}
    </label>
  );
}

// ---- formato de celdas ----
const TS = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/;
const DT = /^(\d{4})-(\d{2})-(\d{2})$/;
export function fmtCell(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v ? "Sí" : "No";
  if (typeof v === "string") {
    const t = v.match(TS);
    if (t) return `${t[3]}/${t[2]} ${t[4]}:${t[5]}`;
    const d = v.match(DT);
    if (d) return `${d[3]}/${d[2]}/${d[1]}`;
  }
  return String(v);
}
const isNum = (v) => typeof v === "number" || (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v));

export function DataTable({ fields, rows, pageSize = 12, className = "", onRowClick, emptyText = "Sin resultados" }) {
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [rows]);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const slice = useMemo(() => rows.slice(page * pageSize, page * pageSize + pageSize), [rows, page, pageSize]);
  const numeric = useMemo(() => fields.map((_, i) => rows.length > 0 && rows.slice(0, 40).every((r) => r[i] === null || isNum(r[i]))), [fields, rows]);
  return (
    <div className={className}>
      <div className="overflow-x-auto rounded-lg border border-neutral-800">
        <table className="w-full min-w-max text-left text-sm">
          <thead className="bg-neutral-950 text-xs text-neutral-400">
            <tr>
              {fields.map((f, i) => (
                <th key={i} className={`whitespace-nowrap px-3 py-2 font-medium ${numeric[i] ? "text-right" : ""}`}>
                  {f}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slice.length === 0 && (
              <tr>
                <td colSpan={fields.length} className="px-3 py-6 text-center text-neutral-500">
                  {emptyText}
                </td>
              </tr>
            )}
            {slice.map((r, ri) => (
              <tr
                key={ri}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
                className={`border-t border-neutral-800 ${ri % 2 ? "bg-neutral-900" : "bg-neutral-900/40"} ${onRowClick ? "cursor-pointer hover:bg-neutral-800" : ""}`}
              >
                {r.map((v, ci) => {
                  const t = fmtCell(v);
                  return (
                    <td key={ci} className={`whitespace-nowrap px-3 py-1.5 tabular-nums ${numeric[ci] ? "text-right" : ""} ${t === null ? "text-neutral-600" : "text-neutral-200"}`}>
                      {t === null ? "—" : t}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > pageSize && (
        <div className="mt-2 flex items-center justify-between text-xs text-neutral-400">
          <span>
            Filas {page * pageSize + 1} a {Math.min(rows.length, (page + 1) * pageSize)} de {rows.length}
          </span>
          <span className="flex items-center gap-2">
            <button disabled={page === 0} onClick={() => setPage(page - 1)} className="rounded-md border border-neutral-700 px-2 py-1 hover:bg-neutral-800 disabled:opacity-40">
              Anterior
            </button>
            <span>
              {page + 1} / {pages}
            </span>
            <button disabled={page >= pages - 1} onClick={() => setPage(page + 1)} className="rounded-md border border-neutral-700 px-2 py-1 hover:bg-neutral-800 disabled:opacity-40">
              Siguiente
            </button>
          </span>
        </div>
      )}
    </div>
  );
}

// Convierte el resultado de una consulta en texto CSV (con BOM para que Excel respete los acentos)
export function toCsv(fields, rows) {
  const esc = (v) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [fields.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\r\n");
}

export function downloadText(name, text, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
