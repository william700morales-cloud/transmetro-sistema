// Capa de acceso a la base de datos.
// Motor: PostgreSQL ejecutado en el navegador con PGlite (WebAssembly). Los datos se guardan en
// IndexedDB, así que sobreviven a recargar la página. Los scripts SQL son los mismos de /database.
import { PGlite } from "@electric-sql/pglite";
import schema from "../../database/01_schema.sql?raw";
import funciones from "../../database/02_funciones_triggers.sql?raw";
import vistas from "../../database/03_vistas.sql?raw";
import seguridad from "../../database/04_seguridad.sql?raw";
import seed from "../../database/05_seed.sql?raw";
import reportesSql from "../../database/06_reportes.sql?raw";
import pruebasSql from "../../database/07_pruebas.sql?raw";

// Si cambia el esquema o los datos, se sube la versión y el navegador crea una base nueva.
export const DB_VERSION = "v1";
const SCRIPTS = [
  ["01 Estructuras (tablas y restricciones)", schema],
  ["02 Funciones y disparadores", funciones],
  ["03 Vistas", vistas],
  ["04 Seguridad", seguridad],
  ["05 Datos de demostración", seed],
];

let dbPromise = null;
let storage = "indexeddb";

const PARSERS = {
  20: Number, // bigint -> número
  1082: (s) => s, // date como texto
  1114: (s) => s, // timestamp como texto (hora local de Guatemala, sin conversión de zona)
};

async function openDb() {
  try {
    const db = new PGlite(`idb://transmetro-${DB_VERSION}`, { parsers: PARSERS });
    await db.waitReady;
    return db;
  } catch (e) {
    storage = "memoria";
    const db = new PGlite({ parsers: PARSERS });
    await db.waitReady;
    return db;
  }
}

async function hasSchema(db) {
  const r = await db.query(
    "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'transmetro'"
  );
  return r.rows[0].n > 0;
}

export async function loadScripts(db, onStep) {
  for (const [name, sql] of SCRIPTS) {
    onStep?.(name);
    await db.exec(sql);
  }
  await db.exec("SET search_path TO transmetro, public");
}

export function getDb(onStep) {
  if (!dbPromise) {
    dbPromise = (async () => {
      onStep?.("Abriendo PostgreSQL en el navegador");
      const db = await openDb();
      if (!(await hasSchema(db))) await loadScripts(db, onStep);
      await db.exec("SET search_path TO transmetro, public");
      return db;
    })();
  }
  return dbPromise;
}

export async function resetDb(onStep) {
  const db = await getDb();
  await loadScripts(db, onStep);
  return db;
}

export function storageKind() {
  return storage;
}

// Ejecuta una consulta y devuelve columnas y filas como arreglos (así se admiten nombres repetidos)
export async function runQuery(sql, params = []) {
  const db = await getDb();
  const t0 = performance.now();
  const r = await db.query(sql, params, { rowMode: "array" });
  return {
    fields: (r.fields || []).map((f) => f.name),
    rows: r.rows || [],
    rowCount: r.rows ? r.rows.length : 0,
    affected: r.affectedRows ?? 0,
    ms: Math.round((performance.now() - t0) * 10) / 10,
  };
}

// Igual que runQuery, pero cada fila es un objeto
export async function queryObjects(sql, params = []) {
  const db = await getDb();
  const r = await db.query(sql, params);
  return r.rows;
}

export async function execScript(sql) {
  const db = await getDb();
  await db.exec(sql);
}

// ----- reportes -----
export function parseReports() {
  const lines = reportesSql.split(/\r?\n/);
  const out = [];
  let cur = null;
  for (const line of lines) {
    const m = line.match(/^-- @reporte (R\d+) \| (.+?) \| (.+?) \| (.+)$/);
    if (m) {
      cur = { id: m[1], titulo: m[2], descripcion: m[3], reglas: m[4], sql: "" };
      out.push(cur);
    } else if (cur && !line.startsWith("SET search_path")) {
      cur.sql += line + "\n";
    }
  }
  return out.map((r) => ({ ...r, sql: r.sql.trim() }));
}

export function testsScript() {
  return pruebasSql;
}

export const SOURCES = { schema, funciones, vistas, seguridad, seed, reportesSql, pruebasSql };

// ----- mensajes de error entendibles -----
export function friendlyError(e) {
  const msg = String(e?.message ?? e);
  if (/not-null constraint/.test(msg)) return "Falta un dato obligatorio: " + msg;
  if (/unique constraint|duplicate key/.test(msg)) return "Ya existe un registro con ese valor único: " + msg;
  if (/violates foreign key/.test(msg)) return "El dato hace referencia a un registro que no existe o que está en uso: " + msg;
  if (/permission denied/.test(msg)) return "Permiso denegado para esta operación: " + msg;
  return msg;
}
