import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { getDb, runQuery, queryObjects, friendlyError, resetDb, storageKind } from "./db";

const DbContext = createContext(null);

export function DbProvider({ children }) {
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [step, setStep] = useState("Iniciando la base de datos");
  const [error, setError] = useState(null);
  const [rev, setRev] = useState(0); // sube cada vez que cambian los datos
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    getDb(setStep)
      .then(() => setStatus("ready"))
      .catch((e) => {
        setError(String(e?.message ?? e));
        setStatus("error");
      });
  }, []);

  // Ejecuta una modificación y avisa a las pantallas para que vuelvan a consultar
  const write = useCallback(async (sql, params = []) => {
    try {
      const r = await runQuery(sql, params);
      setRev((n) => n + 1);
      return { ok: true, result: r };
    } catch (e) {
      return { ok: false, error: friendlyError(e) };
    }
  }, []);

  const reset = useCallback(async () => {
    setStatus("loading");
    setStep("Restableciendo la base de datos");
    try {
      await resetDb(setStep);
      setRev((n) => n + 1);
      setStatus("ready");
      return { ok: true };
    } catch (e) {
      setError(String(e?.message ?? e));
      setStatus("error");
      return { ok: false, error: friendlyError(e) };
    }
  }, []);

  const value = { status, step, error, rev, write, reset, storage: storageKind };
  return <DbContext.Provider value={value}>{children}</DbContext.Provider>;
}

export const useDb = () => useContext(DbContext);

// Consulta que se repite cuando cambian los datos o los parámetros.
// Devuelve { rows (objetos), loading, error }.
export function useQuery(sql, params = [], enabled = true) {
  const { status, rev } = useDb();
  const [state, setState] = useState({ rows: [], loading: true, error: null });
  const key = JSON.stringify(params);
  useEffect(() => {
    if (status !== "ready" || !enabled) return undefined;
    let alive = true;
    queryObjects(sql, params)
      .then((rows) => alive && setState({ rows, loading: false, error: null }))
      .catch((e) => alive && setState({ rows: [], loading: false, error: friendlyError(e) }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, rev, sql, key, enabled]);
  return state;
}
