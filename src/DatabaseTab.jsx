import { useEffect, useState } from "react";
import { Panel, Btn, Badge, Notice, Loading, DataTable, Stat, inputCls } from "./ui";
import { useDb } from "./db/useDb";
import { runQuery, execScript, testsScript, friendlyError, DB_VERSION } from "./db/db";

const EJEMPLOS = [
  ["Líneas y buses", "SELECT codigo, estado, estaciones, buses_asignados, buses_minimo, buses_maximo, cumplimiento\n  FROM vw_linea_cumplimiento ORDER BY codigo;"],
  ["Distancia entre dos estaciones", "SELECT fn_distancia_en_linea(\n  (SELECT id_linea FROM linea WHERE codigo = 'L12'),\n  (SELECT id_estacion FROM estacion WHERE nombre = 'Centra Sur'),\n  (SELECT id_estacion FROM estacion WHERE nombre = 'Centra Norte')) AS km;"],
  ["Romper la regla 5", "UPDATE bus SET id_linea = (SELECT id_linea FROM linea WHERE codigo = 'L12')\n WHERE id_bus IN (SELECT id_bus FROM bus WHERE id_linea IS NULL LIMIT 4);"],
  ["Bitácora de auditoría", "SELECT fecha, tabla, operacion, id_registro FROM bitacora ORDER BY id_bitacora DESC LIMIT 20;"],
];

const TABLAS = `
SELECT c.relname AS tabla
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'transmetro' AND c.relkind = 'r'
 ORDER BY c.relname`;

export default function DatabaseTab({ log }) {
  const { status, rev, reset, storage } = useDb();
  const [version, setVersion] = useState("");
  const [tablas, setTablas] = useState([]);
  const [tests, setTests] = useState(null);
  const [testBusy, setTestBusy] = useState(false);
  const [sql, setSql] = useState(EJEMPLOS[0][1]);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState(null);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    if (status !== "ready") return;
    runQuery("SELECT version()").then((r) => setVersion((String(r.rows[0][0]).match(/PostgreSQL [\d.]+/) || [""])[0]));
    runQuery(TABLAS).then(async (r) => {
      const out = [];
      for (const [t] of r.rows) {
        const c = await runQuery(`SELECT count(*)::int FROM transmetro."${t}"`);
        const k = await runQuery("SELECT count(*)::int FROM information_schema.columns WHERE table_schema='transmetro' AND table_name=$1", [t]);
        out.push([t, k.rows[0][0], c.rows[0][0]]);
      }
      setTablas(out);
    });
  }, [status, rev]);

  if (status !== "ready") return <Loading text="Preparando la base de datos" />;

  const total = tablas.reduce((a, r) => a + r[2], 0);

  const ejecutarPruebas = async () => {
    setTestBusy(true);
    try {
      await execScript(testsScript());
      const r = await runQuery("SELECT id, regla, descripcion, estado FROM transmetro_test.resultado ORDER BY id");
      setTests(r);
      const ok = r.rows.filter((x) => x[3] === "OK").length;
      log("PRB", `Pruebas automáticas de la base de datos: ${ok} de ${r.rowCount} superadas`, ok === r.rowCount ? "ok" : "warn");
    } catch (e) {
      setNotice({ kind: "error", text: friendlyError(e) });
    } finally {
      setTestBusy(false);
    }
  };

  const ejecutar = async () => {
    setErr(null);
    try {
      const r = await runQuery(sql);
      setRes(r);
      if (!/^\s*(select|with|show|explain)/i.test(sql)) setNotice({ kind: "ok", text: `Instrucción ejecutada (${r.affected} filas afectadas).` });
    } catch (e) {
      setRes(null);
      setErr(friendlyError(e));
    }
  };

  const restablecer = async () => {
    const r = await reset();
    setTests(null);
    setRes(null);
    setNotice(r.ok ? { kind: "ok", text: "La base de datos volvió a su estado inicial con los datos de demostración." } : { kind: "error", text: r.error });
    log("BD", "Base de datos restablecida a los datos de demostración", "warn");
  };

  const ok = tests ? tests.rows.filter((r) => r[3] === "OK").length : 0;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Motor" value="PostgreSQL" hint={version ? version.replace("PostgreSQL ", "versión ") : ""} />
        <Stat label="Tablas" value={tablas.length || "—"} hint={`${total} filas en total`} />
        <Stat label="Almacenamiento" value={storage() === "indexeddb" ? "Navegador" : "Memoria"} hint={`IndexedDB · base ${DB_VERSION}`} />
        <Stat label="Pruebas de reglas" value={tests ? `${ok}/${tests.rowCount}` : "—"} tone={tests && ok === tests.rowCount ? "text-brand-400" : "text-neutral-100"} />
      </div>
      {notice && (
        <Notice kind={notice.kind} onClose={() => setNotice(null)}>
          {notice.text}
        </Notice>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel
          title="Pruebas automáticas de las reglas del enunciado"
          right={
            <Btn variant="primary" className="!py-1 text-xs" onClick={ejecutarPruebas} disabled={testBusy}>
              {testBusy ? "Ejecutando" : "Ejecutar pruebas"}
            </Btn>
          }
        >
          <p className="mb-3 text-xs text-neutral-400">
            Cada prueba intenta una operación que rompe una regla (o la cumple) y comprueba que PostgreSQL responda como se espera. Las pruebas se revierten: no cambian los datos.
          </p>
          {tests ? <DataTable fields={["Prueba", "Regla", "Descripción", "Resultado"]} rows={tests.rows.map((r) => [r[0], r[1], r[2], r[3] === "OK" ? "OK" : "FALLA"])} pageSize={10} /> : <p className="text-sm text-neutral-500">Aún no se han ejecutado.</p>}
        </Panel>

        <Panel title="Tablas de la base de datos">
          <DataTable fields={["Tabla", "Columnas", "Filas"]} rows={tablas} pageSize={14} />
        </Panel>
      </div>

      <Panel
        title="Consola SQL"
        right={
          <span className="flex items-center gap-2">
            <Badge tone="warn">Base local del navegador</Badge>
            <Btn variant="danger" className="!py-1 text-xs" onClick={restablecer}>
              Restablecer datos
            </Btn>
          </span>
        }
      >
        <div className="mb-2 flex flex-wrap gap-2">
          {EJEMPLOS.map(([n, s]) => (
            <button key={n} onClick={() => setSql(s)} className="rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800">
              {n}
            </button>
          ))}
        </div>
        <textarea
          className={`${inputCls} h-32 font-log text-xs`}
          spellCheck={false}
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          onKeyDown={(e) => (e.ctrlKey || e.metaKey) && e.key === "Enter" && ejecutar()}
          aria-label="Consulta SQL"
        />
        <div className="mt-2 flex items-center gap-3">
          <Btn variant="primary" onClick={ejecutar}>
            Ejecutar (Ctrl + Enter)
          </Btn>
          {res && (
            <span className="text-xs text-neutral-400">
              {res.rowCount} filas · {res.ms} ms
            </span>
          )}
        </div>
        {err && (
          <div className="mt-3">
            <Notice kind="error">{err}</Notice>
          </div>
        )}
        {res && res.fields.length > 0 && <DataTable className="mt-3" fields={res.fields} rows={res.rows} pageSize={10} />}
      </Panel>
    </div>
  );
}
