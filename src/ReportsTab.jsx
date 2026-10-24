import { useEffect, useMemo, useState } from "react";
import { Panel, Btn, Badge, Notice, Loading, DataTable, toCsv, downloadText } from "./ui";
import { useDb } from "./db/useDb";
import { parseReports, runQuery, friendlyError } from "./db/db";

// Resalta de forma sencilla las palabras clave de SQL
const KW = /\b(SELECT|FROM|WHERE|JOIN|LEFT|ON|AS|GROUP BY|ORDER BY|HAVING|UNION ALL|USING|AND|OR|NOT|EXISTS|COUNT|DISTINCT|SUM|CASE|WHEN|THEN|ELSE|END|IS|NULL|DESC|ASC|LIMIT|IN|LOWER|LEAST|GREATEST|COALESCE|LAG|OVER|PARTITION BY)\b/g;
function Sql({ text }) {
  const parts = useMemo(() => {
    const out = [];
    let last = 0;
    for (const m of text.matchAll(KW)) {
      if (m.index > last) out.push([text.slice(last, m.index), false]);
      out.push([m[0], true]);
      last = m.index + m[0].length;
    }
    out.push([text.slice(last), false]);
    return out;
  }, [text]);
  return (
    <pre className="max-h-80 overflow-auto rounded-lg border border-neutral-800 bg-neutral-950 p-3 font-log text-xs leading-relaxed text-neutral-200">
      {parts.map(([t, k], i) =>
        k ? (
          <span key={i} className="font-medium text-brand-300">
            {t}
          </span>
        ) : (
          <span key={i}>{t}</span>
        )
      )}
    </pre>
  );
}

export default function ReportsTab({ initialReport, log }) {
  const { status, rev } = useDb();
  const reports = useMemo(() => parseReports(), []);
  const [sel, setSel] = useState(initialReport && reports.find((r) => r.id === initialReport) ? initialReport : "R01");
  const [res, setRes] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const rep = reports.find((r) => r.id === sel);

  useEffect(() => {
    if (status !== "ready" || !rep) return undefined;
    let alive = true;
    setBusy(true);
    runQuery(rep.sql)
      .then((r) => {
        if (!alive) return;
        setRes(r);
        setError(null);
      })
      .catch((e) => alive && (setError(friendlyError(e)), setRes(null)))
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
    };
  }, [status, rev, rep]);

  if (status !== "ready") return <Loading text="Preparando la base de datos" />;

  return (
    <div className="grid gap-4 lg:grid-cols-[19rem_1fr]">
      <nav className="no-print space-y-1" aria-label="Reportes">
        {reports.map((r) => (
          <button
            key={r.id}
            onClick={() => setSel(r.id)}
            aria-current={sel === r.id}
            className={`block w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400 ${
              sel === r.id ? "border-brand-500 bg-neutral-800 text-white" : "border-neutral-800 bg-neutral-900 text-neutral-300 hover:border-neutral-600"
            }`}
          >
            <span className="mr-2 font-log text-xs text-brand-300">{r.id}</span>
            {r.titulo}
          </button>
        ))}
      </nav>

      {rep && (
        <div className="min-w-0 space-y-4">
          <Panel
            title={
              <span>
                <span className="mr-2 font-log text-brand-300">{rep.id}</span>
                {rep.titulo}
              </span>
            }
            right={
              <span className="no-print flex items-center gap-2">
                <Btn className="!py-1 text-xs" disabled={!res} onClick={() => res && (downloadText(`${rep.id}.csv`, toCsv(res.fields, res.rows)), log?.("REP", `Reporte ${rep.id} exportado a CSV (${res.rowCount} filas)`, "ok"))}>
                  Exportar CSV
                </Btn>
                <Btn className="!py-1 text-xs" onClick={() => window.print()}>
                  Imprimir
                </Btn>
              </span>
            }
          >
            <p className="text-sm text-neutral-300">{rep.descripcion}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-400">
              <span>Reglas del enunciado:</span>
              {rep.reglas.split(",").map((n) => (
                <Badge key={n} tone="info">
                  {n.trim()}
                </Badge>
              ))}
            </div>
          </Panel>

          <Panel title="Consulta SQL ejecutada" right={<Btn className="no-print !py-1 text-xs" onClick={() => navigator.clipboard?.writeText(rep.sql)}>Copiar SQL</Btn>}>
            <Sql text={rep.sql} />
          </Panel>

          <Panel
            title="Resultado"
            right={res && <span className="text-xs text-neutral-400">{res.rowCount} filas · {res.ms} ms en PostgreSQL</span>}
          >
            {busy && !res && <Loading text="Ejecutando la consulta" />}
            {error && <Notice kind="error">{error}</Notice>}
            {res && <DataTable fields={res.fields} rows={res.rows} pageSize={15} />}
          </Panel>
        </div>
      )}
    </div>
  );
}
