import { useEffect, useMemo, useRef, useState } from "react";
import { Panel, Btn, Stat } from "./ui";

const CAPACITY = 160;
const CRITICAL_LOAD = 0.9;
const RECOVER_LOAD = 0.8;

const STATION_POS = [
  { id: "N", name: "Andén Centra Norte", pos: 0 },
  { id: "T", name: "Andén Trébol", pos: 61 },
  { id: "S", name: "Andén Centra Sur", pos: 100 },
];

const DIRS = [
  { dir: 1, label: "Hacia Centra Sur" },
  { dir: -1, label: "Hacia Centra Norte" },
];

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

const fmtEta = (s) => {
  if (s < 10) return "Llegando";
  const t = Math.round(s);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")} min`;
};

function nextArrival(buses, station, dir) {
  if ((dir === 1 && station.pos >= 100) || (dir === -1 && station.pos <= 0)) return null;
  let best = null;
  buses.forEach((b) => {
    if (b.status !== "En Ruta" || b.dir !== dir) return;
    const approaching = dir === 1 ? b.pos <= station.pos : b.pos >= station.pos;
    if (!approaching) return;
    const eta = Math.abs(station.pos - b.pos) / b.speed + b.hold;
    if (!best || eta < best.eta) best = { bus: b, eta };
  });
  return best;
}

const barColor = (ratio) =>
  ratio >= CRITICAL_LOAD ? "bg-red-500" : ratio >= 0.7 ? "bg-amber-400" : "bg-green-500";

export default function PassengersTab({ buses, log }) {
  const [load, setLoad] = useState({});
  const busesRef = useRef(buses);
  const alerted = useRef(new Set());
  busesRef.current = buses;

  useEffect(() => {
    const id = setInterval(() => {
      setLoad((prev) => {
        const next = {};
        busesRef.current.forEach((b) => {
          if (b.status !== "En Ruta") {
            next[b.id] = 0;
            return;
          }
          const cur = prev[b.id] ?? Math.round(CAPACITY * 0.3);
          next[b.id] = clamp(cur + Math.round(Math.random() * 15 - 6), 0, CAPACITY);
        });
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    Object.entries(load).forEach(([k, n]) => {
      const ratio = n / CAPACITY;
      if (ratio >= CRITICAL_LOAD && !alerted.current.has(k)) {
        alerted.current.add(k);
        log("PAS", `AFORO CRÍTICO - Bus #${k} con ${n}/${CAPACITY} pasajeros (${Math.round(ratio * 100)} %)`, "warn");
      } else if (ratio < RECOVER_LOAD && alerted.current.has(k)) {
        alerted.current.delete(k);
        log("PAS", `Aforo normalizado - Bus #${k} con ${n}/${CAPACITY} pasajeros`, "ok");
      }
    });
  }, [load, log]);

  const peakHour = () => {
    setLoad((prev) => {
      const next = { ...prev };
      busesRef.current.forEach((b) => {
        if (b.status === "En Ruta") next[b.id] = clamp((prev[b.id] ?? 0) + 40, 0, CAPACITY);
      });
      return next;
    });
    log("PAS", "Simulación de hora pico - Ingreso masivo de pasajeros en unidades en ruta", "info");
  };

  const emptyAll = () => {
    setLoad((prev) => Object.fromEntries(Object.keys(prev).map((k) => [k, 0])));
    alerted.current.clear();
    log("PAS", "Contadores de aforo reiniciados", "info");
  };

  const inRoute = buses.filter((b) => b.status === "En Ruta");
  const aboard = inRoute.reduce((s, b) => s + (load[b.id] ?? 0), 0);
  const avg = inRoute.length ? Math.round((aboard / (inRoute.length * CAPACITY)) * 100) : 0;
  const critical = inRoute.filter((b) => (load[b.id] ?? 0) / CAPACITY >= CRITICAL_LOAD).length;

  const boards = useMemo(
    () =>
      STATION_POS.map((st) => ({
        ...st,
        arrivals: DIRS.map((d) => ({ ...d, next: nextArrival(buses, st, d.dir) })),
      })),
    [buses]
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Pasajeros a bordo" value={aboard} />
        <Stat label="Ocupación promedio" value={`${avg} %`} />
        <Stat label="Unidades en aforo crítico" value={critical} tone={critical ? "text-red-400" : "text-neutral-100"} />
        <Stat label="Capacidad por unidad" value={CAPACITY} />
      </div>

      <Panel
        title="Pantallas de andén: tiempo estimado de llegada"
        right={<span className="text-xs text-neutral-400">Calculado con la posición y velocidad de cada unidad</span>}
      >
        <div className="grid gap-3 md:grid-cols-3">
          {boards.map((st) => (
            <div key={st.id} className="border border-neutral-800 bg-neutral-950 px-4 py-3">
              <div className="text-sm font-semibold">{st.name}</div>
              <div className="mt-2 space-y-2">
                {st.arrivals.map((a) => (
                  <div key={a.dir} className="flex items-center justify-between gap-2 border-t border-neutral-800 pt-2 text-sm">
                    <div>
                      <div className="text-xs text-neutral-400">{a.label}</div>
                      <div className="text-xs text-neutral-300">
                        {a.next ? `Bus #${a.next.bus.id}` : st.pos === 0 && a.dir === -1 || st.pos === 100 && a.dir === 1 ? "Sin servicio en este sentido" : "Sin unidades"}
                      </div>
                    </div>
                    <div className={`font-log text-lg ${a.next && a.next.eta < 10 ? "text-green-400" : "text-neutral-100"}`}>
                      {a.next ? fmtEta(a.next.eta) : "--"}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel
        title="Aforo por unidad (sensores ópticos)"
        right={
          <div className="flex gap-2">
            <Btn variant="warn" className="text-xs" onClick={peakHour}>
              Simular hora pico
            </Btn>
            <Btn className="text-xs" onClick={emptyAll}>
              Reiniciar conteo
            </Btn>
          </div>
        }
      >
        <div className="space-y-2">
          {buses.map((b) => {
            const n = load[b.id] ?? 0;
            const ratio = n / CAPACITY;
            return (
              <div key={b.id} className="grid grid-cols-[5rem_1fr_9rem] items-center gap-3 text-sm">
                <span className="font-semibold">Bus #{b.id}</span>
                <div className="h-3 border border-neutral-700 bg-neutral-950" role="img" aria-label={`Ocupación ${Math.round(ratio * 100)} por ciento`}>
                  <div className={`h-full ${barColor(ratio)} transition-[width] duration-500`} style={{ width: `${ratio * 100}%` }} />
                </div>
                <span className={`text-right font-log text-xs ${ratio >= CRITICAL_LOAD ? "font-semibold text-red-400" : "text-neutral-300"}`}>
                  {b.status === "En Ruta" ? `${n}/${CAPACITY} (${Math.round(ratio * 100)} %)` : b.status}
                </span>
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}
