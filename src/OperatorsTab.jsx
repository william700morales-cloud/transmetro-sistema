import { useState } from "react";
import { Panel, Btn, Stat } from "./ui";

const MAX_ATTEMPTS = 3;

const SEED_OPERATORS = [
  { id: "OP-01", name: "Piloto 01", pin: "1111" },
  { id: "OP-02", name: "Piloto 02", pin: "2222" },
  { id: "OP-03", name: "Piloto 03", pin: "3333" },
  { id: "OP-04", name: "Piloto 04", pin: "4444" },
].map((o) => ({ ...o, bus: null, score: 100, attempts: 0, locked: false, events: [], since: null }));

const INFRACTIONS = [
  { key: "brake", label: "Frenada brusca", penalty: 3 },
  { key: "accel", label: "Aceleración brusca", penalty: 2 },
  { key: "speed", label: "Exceso de velocidad", penalty: 5 },
  { key: "door", label: "Puertas abiertas en movimiento", penalty: 4 },
];

const rating = (s) => (s >= 90 ? "Excelente" : s >= 75 ? "Aceptable" : "Requiere capacitación");
const ratingTone = (s) => (s >= 90 ? "text-green-400" : s >= 75 ? "text-amber-300" : "text-red-400");

const pad2 = (n) => String(n).padStart(2, "0");
const now = () => {
  const d = new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
};

const fieldCls =
  "w-full border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-neutral-100";

export default function OperatorsTab({ buses, log }) {
  const [ops, setOps] = useState(SEED_OPERATORS);
  const [opId, setOpId] = useState(SEED_OPERATORS[0].id);
  const [pin, setPin] = useState("");
  const [busId, setBusId] = useState("");
  const [msg, setMsg] = useState(null);
  const [closed, setClosed] = useState([]);

  const patch = (id, fn) => setOps((list) => list.map((o) => (o.id === id ? fn(o) : o)));

  const taken = new Set(ops.filter((o) => o.bus != null).map((o) => o.bus));
  const available = buses.filter((b) => b.status !== "Mantenimiento" && !taken.has(b.id));
  const active = ops.filter((o) => o.bus != null);
  const selected = ops.find((o) => o.id === opId);

  const startShift = () => {
    if (!selected) return;
    if (selected.locked) {
      setMsg({ tone: "text-red-400", text: `${selected.id} bloqueado. Debe desbloquearlo un despachador.` });
      return;
    }
    if (selected.bus != null) {
      setMsg({ tone: "text-amber-300", text: `${selected.id} ya tiene un turno activo en el Bus #${selected.bus}.` });
      return;
    }
    if (!busId) {
      setMsg({ tone: "text-amber-300", text: "Seleccione una unidad disponible." });
      return;
    }
    if (pin !== selected.pin) {
      const attempts = selected.attempts + 1;
      const locked = attempts >= MAX_ATTEMPTS;
      patch(selected.id, (o) => ({ ...o, attempts, locked }));
      setPin("");
      if (locked) {
        setMsg({ tone: "text-red-400", text: `PIN incorrecto. ${selected.id} bloqueado tras ${MAX_ATTEMPTS} intentos.` });
        log("OPE", `AUTENTICACIÓN FALLIDA - ${selected.id} bloqueado tras ${MAX_ATTEMPTS} intentos`, "alarm");
      } else {
        setMsg({ tone: "text-amber-300", text: `PIN incorrecto. Intentos restantes: ${MAX_ATTEMPTS - attempts}.` });
        log("OPE", `PIN incorrecto para ${selected.id} - Intento ${attempts} de ${MAX_ATTEMPTS}`, "warn");
      }
      return;
    }
    const bus = Number(busId);
    patch(selected.id, (o) => ({ ...o, bus, score: 100, attempts: 0, events: [], since: now() }));
    setPin("");
    setBusId("");
    setMsg({ tone: "text-green-400", text: `Turno iniciado: ${selected.name} en el Bus #${bus}.` });
    log("OPE", `Inicio de turno - ${selected.id} (${selected.name}) asignado al Bus #${bus}`, "ok");
  };

  const infraction = (op, inf) => {
    patch(op.id, (o) => ({
      ...o,
      score: Math.max(0, o.score - inf.penalty),
      events: [{ label: inf.label, penalty: inf.penalty, at: now() }, ...o.events].slice(0, 6),
    }));
    log("OPE", `Evento de conducta - ${op.id} - Bus #${op.bus} - ${inf.label} (-${inf.penalty} pts)`, "warn");
  };

  const endShift = (op) => {
    setClosed((c) => [{ id: op.id, name: op.name, bus: op.bus, score: op.score, at: now() }, ...c].slice(0, 5));
    patch(op.id, (o) => ({ ...o, bus: null, events: [], since: null }));
    log("OPE", `Cierre de turno - ${op.id} - Bus #${op.bus} - Puntaje ${op.score} (${rating(op.score)})`, "ok");
  };

  const unlock = (op) => {
    patch(op.id, (o) => ({ ...o, locked: false, attempts: 0 }));
    log("OPE", `Desbloqueo autorizado por despachador - ${op.id}`, "info");
    setMsg({ tone: "text-green-400", text: `${op.id} desbloqueado.` });
  };

  const avg = active.length ? Math.round(active.reduce((s, o) => s + o.score, 0) / active.length) : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Operadores registrados" value={ops.length} />
        <Stat label="Turnos activos" value={active.length} tone="text-green-400" />
        <Stat label="Bloqueados" value={ops.filter((o) => o.locked).length} tone={ops.some((o) => o.locked) ? "text-red-400" : "text-neutral-100"} />
        <Stat label="Puntaje promedio" value={avg == null ? "n/d" : avg} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Autenticación de turno">
          <div className="space-y-3">
            <label className="block text-xs text-neutral-400">
              Operador
              <select className={`${fieldCls} mt-1`} value={opId} onChange={(e) => { setOpId(e.target.value); setPin(""); setMsg(null); }}>
                {ops.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.id} - {o.name}
                    {o.locked ? " (bloqueado)" : o.bus != null ? ` (Bus #${o.bus})` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-neutral-400">
              PIN de 4 dígitos
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                className={`${fieldCls} mt-1 font-log tracking-widest`}
                autoComplete="off"
              />
            </label>
            <label className="block text-xs text-neutral-400">
              Unidad asignada
              <select className={`${fieldCls} mt-1`} value={busId} onChange={(e) => setBusId(e.target.value)}>
                <option value="">Seleccione una unidad</option>
                {available.map((b) => (
                  <option key={b.id} value={b.id}>
                    Bus #{b.id} ({b.status})
                  </option>
                ))}
              </select>
            </label>
            <Btn variant="primary" className="w-full" onClick={startShift} disabled={pin.length < 4}>
              Iniciar turno
            </Btn>
            <p className={`min-h-[1.25rem] text-sm ${msg ? msg.tone : "text-neutral-400"}`} aria-live="polite">
              {msg ? msg.text : "Tras 3 PIN incorrectos el operador queda bloqueado."}
            </p>
          </div>
        </Panel>

        <Panel title="Turnos activos y conducta">
          {active.length === 0 ? (
            <p className="flex min-h-[10rem] items-center justify-center text-sm text-neutral-400">Sin turnos activos.</p>
          ) : (
            <div className="space-y-3">
              {active.map((o) => (
                <div key={o.id} className="border border-neutral-800 bg-neutral-950 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold">
                        {o.id} - {o.name}
                      </div>
                      <div className="text-xs text-neutral-400">
                        Bus #{o.bus} - Turno desde {o.since}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`text-2xl font-bold ${ratingTone(o.score)}`}>{o.score}</div>
                      <div className={`text-xs ${ratingTone(o.score)}`}>{rating(o.score)}</div>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {INFRACTIONS.map((inf) => (
                      <Btn key={inf.key} variant="warn" className="text-xs" onClick={() => infraction(o, inf)}>
                        {inf.label}
                      </Btn>
                    ))}
                    <Btn className="text-xs" onClick={() => endShift(o)}>
                      Cerrar turno
                    </Btn>
                  </div>
                  {o.events.length > 0 && (
                    <ul className="mt-3 space-y-1 text-xs text-neutral-300">
                      {o.events.map((e, i) => (
                        <li key={`${e.at}-${i}`} className="flex justify-between border-t border-neutral-800 pt-1">
                          <span>{e.label}</span>
                          <span className="font-log text-neutral-400">
                            -{e.penalty} pts - {e.at}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Operadores bloqueados">
          {ops.filter((o) => o.locked).length === 0 ? (
            <p className="text-sm text-neutral-400">Ningún operador bloqueado.</p>
          ) : (
            <ul className="space-y-2">
              {ops
                .filter((o) => o.locked)
                .map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-2 border border-red-700 bg-red-950 px-3 py-2 text-sm">
                    <span className="text-red-100">
                      {o.id} - {o.name}
                    </span>
                    <Btn variant="danger" className="text-xs" onClick={() => unlock(o)}>
                      Desbloquear (despachador)
                    </Btn>
                  </li>
                ))}
            </ul>
          )}
        </Panel>

        <Panel title="Turnos cerrados">
          {closed.length === 0 ? (
            <p className="text-sm text-neutral-400">Aún no se han cerrado turnos en esta sesión.</p>
          ) : (
            <ul className="space-y-2">
              {closed.map((c, i) => (
                <li key={`${c.id}-${c.at}-${i}`} className="flex flex-wrap items-center justify-between gap-2 border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm">
                  <span className="font-semibold">{c.id}</span>
                  <span className="text-neutral-300">Bus #{c.bus}</span>
                  <span className={ratingTone(c.score)}>
                    {c.score} - {rating(c.score)}
                  </span>
                  <span className="font-log text-xs text-neutral-400">{c.at}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
