import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Panel, Btn, Stat, StatusBadge } from "./ui";
import PassengersTab from "./PassengersTab";
import OperatorsTab from "./OperatorsTab";
import NetworkTab from "./NetworkTab";
import StationTab from "./StationTab";
import ReportsTab from "./ReportsTab";
import DatabaseTab from "./DatabaseTab";
import { useDb, useQuery } from "./db/useDb";

const ROUTE_KM = 18.4;
const CRITICAL_GAP = 6;

const TERMINALS = {
  N: { name: "Terminal Centra Norte", short: "Centra Norte", pos: 0, dir: 1, lat: 14.676, lon: -90.514 },
  S: { name: "Terminal Centra Sur", short: "Centra Sur", pos: 100, dir: -1, lat: 14.552, lon: -90.533 },
};

const STATIONS = [
  { id: "N", name: "Andén Centra Norte", lat: 14.676, lon: -90.514 },
  { id: "T", name: "Andén Trébol", lat: 14.6, lon: -90.537 },
  { id: "S", name: "Andén Centra Sur", lat: 14.552, lon: -90.533 },
];

const PROFILES = {
  regular: { label: "Tarjeta regular", cardId: "4812", fare: 1.0 },
  estudiante: { label: "Estudiante", cardId: "2057", fare: 0.5 },
  adulto: { label: "Adulto mayor", cardId: "7731", fare: 0.25 },
};

const INITIAL_BUSES = [
  { id: 101, status: "En Ruta", terminal: "N", pos: 18, dir: 1, speed: 1.6, hold: 0 },
  { id: 102, status: "Mantenimiento", terminal: "N", pos: 0, dir: 1, speed: 1.4, hold: 0 },
  { id: 103, status: "En Patio", terminal: "N", pos: 0, dir: 1, speed: 1.5, hold: 0 },
  { id: 104, status: "En Ruta", terminal: "N", pos: 46, dir: 1, speed: 1.3, hold: 0 },
  { id: 105, status: "En Patio", terminal: "S", pos: 100, dir: -1, speed: 1.7, hold: 0 },
  { id: 106, status: "En Ruta", terminal: "S", pos: 71, dir: -1, speed: 1.5, hold: 0 },
  { id: 107, status: "En Patio", terminal: "N", pos: 0, dir: 1, speed: 1.2, hold: 0 },
  { id: 108, status: "En Patio", terminal: "S", pos: 100, dir: -1, speed: 1.4, hold: 0 },
];

const pad = (n, l = 2) => String(n).padStart(l, "0");
const stamp = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const q = (n) => `Q${n.toFixed(2)}`;

const busCoords = (b) => {
  const t = b.pos / 100;
  return {
    lat: TERMINALS.N.lat + (TERMINALS.S.lat - TERMINALS.N.lat) * t,
    lon: TERMINALS.N.lon + (TERMINALS.S.lon - TERMINALS.N.lon) * t + Math.sin(t * 9) * 0.004,
  };
};

const alarmCoords = (a, buses) => {
  if (a.kind === "bus") {
    const b = buses.find((x) => x.id === a.busId);
    return b ? busCoords(b) : { lat: a.lat, lon: a.lon };
  }
  return { lat: a.lat, lon: a.lon };
};

const GLOBAL_CSS = `
.font-ui{font-family:'IBM Plex Sans Condensed','Arial Narrow',system-ui,sans-serif}
.font-log{font-family:'IBM Plex Mono',ui-monospace,Menlo,Consolas,monospace}
@keyframes sosflash{0%,100%{background:rgba(220,38,38,0)}50%{background:rgba(220,38,38,.38)}}
.sos-flash{animation:sosflash .9s ease-in-out infinite}
@keyframes alarmblink{0%,100%{background:#450a0a}50%{background:#b91c1c}}
.alarm-blink{animation:alarmblink .6s steps(2,end) infinite}
@keyframes walk{from{top:-14%}to{top:104%}}
.walker{animation:walk .9s linear forwards}
@media (prefers-reduced-motion: reduce){
  .sos-flash{animation:none;background:rgba(220,38,38,.25)}
  .alarm-blink{animation:none;background:#b91c1c}
  .walker{animation-duration:.01s}
}
`;

function RouteTrack({ buses, pairs }) {
  const bunched = new Set(pairs.flatMap((p) => [p.lead.id, p.trail.id]));
  const lane = (dir, label) => (
    <div>
      <div className="mb-1 text-xs text-neutral-400">{label}</div>
      <div className="relative h-11 border border-neutral-800 bg-neutral-950">
        <div className="absolute inset-x-5 top-1/2 h-px bg-neutral-700" />
        <div className="absolute inset-x-5 inset-y-0">
          {buses
            .filter((b) => b.status === "En Ruta" && b.dir === dir)
            .map((b) => {
              const isB = bunched.has(b.id);
              const held = b.hold > 0;
              const color = isB
                ? "bg-amber-400 text-black ring-2 ring-amber-200"
                : held
                ? "bg-neutral-500 text-black"
                : "bg-green-500 text-black";
              return (
                <div
                  key={b.id}
                  style={{ left: `${b.pos}%` }}
                  className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 px-1.5 py-0.5 text-xs font-bold transition-[left] duration-1000 ease-linear ${color}`}
                  title={`Bus #${b.id}`}
                >
                  {b.id}
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-xs text-neutral-300">
        <span>{TERMINALS.N.name}</span>
        <span>{TERMINALS.S.name}</span>
      </div>
      {lane(1, "Sentido Centra Norte a Centra Sur")}
      {lane(-1, "Sentido Centra Sur a Centra Norte")}
    </div>
  );
}

function FleetTab({
  buses, pairs, running, setRunning, selectedId, setSelectedId,
  onPortico, onForceBunching, onMaintenance, onHold, dispatches, headways,
}) {
  const count = (s) => buses.filter((b) => b.status === s).length;
  const inPatio = (t) => buses.filter((b) => b.status === "En Patio" && b.terminal === t).length;
  const target = selectedId ? `Bus #${selectedId} seleccionado` : "Selección automática de unidad";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Flota articulada" value={buses.length} />
        <Stat label="En patio" value={count("En Patio")} />
        <Stat label="En ruta" value={count("En Ruta")} tone="text-green-400" />
        <Stat label="En mantenimiento" value={count("Mantenimiento")} tone="text-amber-300" />
      </div>

      <Panel title="Pórticos RFID y despacho">
        <div className="flex flex-wrap items-center gap-3">
          <Btn variant="primary" onClick={onPortico}>
            Simular entrada/salida en pórtico RFID
          </Btn>
          <Btn variant="warn" onClick={onForceBunching}>
            Forzar convoy (bus bunching)
          </Btn>
          <Btn onClick={() => setRunning(!running)}>{running ? "Pausar simulación" : "Reanudar simulación"}</Btn>
          <span className="text-xs text-neutral-400">{target}</span>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {["N", "S"].map((t) => (
            <div key={t} className="border border-neutral-800 bg-neutral-950 px-4 py-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">{TERMINALS[t].name}</span>
                <span className="inline-flex items-center gap-1.5 text-xs text-green-400">
                  <span className="h-2 w-2 bg-green-500" /> Pórtico activo
                </span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-neutral-400">
                <div>
                  En patio
                  <div className="text-lg font-semibold text-neutral-100">{inPatio(t)}</div>
                </div>
                <div>
                  Despachos
                  <div className="text-lg font-semibold text-neutral-100">{dispatches[t]}</div>
                </div>
                <div>
                  Último intervalo
                  <div className="text-lg font-semibold text-neutral-100">
                    {headways[t] == null ? "n/d" : `${headways[t]} s`}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      {pairs.length > 0 ? (
        <div className="space-y-2">
          {pairs.map((p) => (
            <div
              key={p.key}
              role="alert"
              className="flex flex-wrap items-center justify-between gap-3 border border-amber-500 bg-amber-950 px-4 py-3"
            >
              <div>
                <div className="text-sm font-semibold text-amber-300">Bus bunching detectado</div>
                <div className="text-sm text-amber-100">
                  Bus #{p.lead.id} y Bus #{p.trail.id} a {Math.round(p.gap * ROUTE_KM * 10)} m. El umbral crítico es{" "}
                  {Math.round(CRITICAL_GAP * ROUTE_KM * 10)} m.
                </div>
              </div>
              <Btn variant="warn" onClick={() => onHold(p.trail.id)}>
                Retener Bus #{p.trail.id} por 10 s
              </Btn>
            </div>
          ))}
        </div>
      ) : (
        <div className="border border-neutral-800 bg-neutral-900 px-4 py-2.5 text-sm text-green-400">
          Intervalos entre unidades dentro del rango normal.
        </div>
      )}

      <Panel title="Posición de unidades en ruta">
        <RouteTrack buses={buses} pairs={pairs} />
      </Panel>

      <Panel title="Unidades articuladas" right={<span className="text-xs text-neutral-400">Toca una unidad para seleccionarla</span>}>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {buses.map((b) => {
            const sel = selectedId === b.id;
            const km = (b.pos * ROUTE_KM) / 100;
            return (
              <div
                key={b.id}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedId(sel ? null : b.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedId(sel ? null : b.id);
                  }
                }}
                className={`cursor-pointer border bg-neutral-950 p-3 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-neutral-100 ${
                  sel ? "border-neutral-100" : "border-neutral-800 hover:border-neutral-600"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-lg font-bold">Bus #{b.id}</span>
                  <StatusBadge status={b.status} />
                </div>
                <div className="mt-1 text-xs text-neutral-400">Articulado de 18 m</div>
                <div className="mt-2 text-sm text-neutral-200">
                  {b.status === "En Ruta"
                    ? `Km ${km.toFixed(1)} desde Centra Norte`
                    : TERMINALS[b.terminal].name}
                </div>
                <div className="text-xs text-neutral-400">
                  {b.status === "En Ruta"
                    ? b.hold > 0
                      ? `Retenido ${b.hold} s`
                      : b.dir === 1
                      ? "Hacia Centra Sur"
                      : "Hacia Centra Norte"
                    : b.status === "Mantenimiento"
                    ? "Despacho bloqueado"
                    : "Listo para despacho"}
                </div>
                <div className="mt-3">
                  <Btn
                    className="w-full text-xs"
                    disabled={b.status === "En Ruta"}
                    onClick={(e) => {
                      e.stopPropagation();
                      onMaintenance(b.id);
                    }}
                  >
                    {b.status === "Mantenimiento" ? "Liberar de mantenimiento" : "Enviar a mantenimiento"}
                  </Btn>
                </div>
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}

function GateTab({ log, onEvasion }) {
  const [profileKey, setProfileKey] = useState("regular");
  const [balances, setBalances] = useState({ regular: 12, estudiante: 8, adulto: 5 });
  const [cardActive, setCardActive] = useState(false);
  const [gate, setGate] = useState({ state: "idle", msg: "", key: 0 });
  const [latency, setLatency] = useState(null);
  const [stats, setStats] = useState({ ok: 0, denied: 0, evasion: 0, revenue: 0 });
  const [evasions, setEvasions] = useState([]);
  const timers = useRef([]);
  const keySeq = useRef(0);
  const evasionSeq = useRef(0);

  const profile = PROFILES[profileKey];
  const balance = balances[profileKey];
  const busy = gate.state === "reading";

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  const later = (fn, ms) => {
    timers.current.push(setTimeout(fn, ms));
  };
  useEffect(() => clearTimers, []);

  const selectProfile = (k) => {
    clearTimers();
    setProfileKey(k);
    setCardActive(false);
    setGate({ state: "idle", msg: "", key: ++keySeq.current });
  };

  const tapCard = () => {
    if (busy) return;
    clearTimers();
    setCardActive(true);
    setGate({ state: "card", msg: "", key: ++keySeq.current });
    log("RF-04", `Lectura NFC Tarjeta Ciudadana ID #${profile.cardId} - Perfil: ${profile.label}`, "info");
  };

  const removeCard = () => {
    clearTimers();
    setCardActive(false);
    setGate({ state: "idle", msg: "", key: ++keySeq.current });
  };

  const recharge = () => {
    setBalances((b) => ({ ...b, [profileKey]: b[profileKey] + 10 }));
    log("RF-04", `Recarga Tarjeta ID #${profile.cardId} - Monto: Q10.00 - Saldo: ${q(balance + 10)}`, "ok");
  };

  const validate = (mode) => {
    if (!cardActive || busy) return;
    clearTimers();
    const ms = Math.round(110 + Math.random() * 170);
    const key = ++keySeq.current;
    setGate({ state: "reading", msg: "", key });
    later(() => {
      setLatency(ms);
      setCardActive(false);
      const shownBalance = mode === "nofunds" ? 0 : balance;
      if (shownBalance >= profile.fare) {
        const nb = balance - profile.fare;
        setBalances((b) => ({ ...b, [profileKey]: nb }));
        setStats((s) => ({ ...s, ok: s.ok + 1, revenue: s.revenue + profile.fare }));
        setGate({ state: "granted", msg: `Cobro ${q(profile.fare)}. Saldo ${q(nb)}`, key: ++keySeq.current });
        log("RF-08", `Validación de Tarjeta ID #${profile.cardId} - Saldo: ${q(nb)} - Cobro ${q(profile.fare)} - ${ms} ms`, "ok");
      } else {
        setStats((s) => ({ ...s, denied: s.denied + 1 }));
        setGate({
          state: "denied",
          msg: `Saldo ${q(shownBalance)}. Tarifa ${q(profile.fare)}`,
          key: ++keySeq.current,
        });
        log("RF-08", `Acceso DENEGADO Tarjeta ID #${profile.cardId} - Saldo insuficiente: ${q(shownBalance)} - ${ms} ms`, "warn");
      }
      later(() => setGate({ state: "idle", msg: "", key: ++keySeq.current }), 2400);
    }, ms);
  };

  const evade = () => {
    if (busy) return;
    clearTimers();
    setCardActive(false);
    const n = ++evasionSeq.current;
    setGate({ state: "evasion", msg: "", key: ++keySeq.current });
    setStats((s) => ({ ...s, evasion: s.evasion + 1 }));
    setEvasions((l) => [{ id: `EV-${pad(n, 3)}`, at: stamp(), turnstile: "T-02", station: "Estación Trébol" }, ...l].slice(0, 5));
    onEvasion();
    log("RF-11", "ALERTA EVASIÓN TARIFARIA - Salto de molinete T-02 detectado por sensor óptico sin validación previa", "alarm");
    later(() => setGate({ state: "idle", msg: "", key: ++keySeq.current }), 3500);
  };

  const LCD = {
    idle: { a: "Acerque su tarjeta", b: "Tarifa según perfil", tone: "text-neutral-300", light: "bg-neutral-600" },
    card: { a: "Tarjeta detectada", b: `${profile.label} #${profile.cardId}`, tone: "text-neutral-100", light: "bg-neutral-300" },
    reading: { a: "Validando", b: "No retire la tarjeta", tone: "text-amber-300", light: "bg-amber-400" },
    granted: { a: "Acceso permitido", b: gate.msg, tone: "text-green-400", light: "bg-green-500" },
    denied: { a: "Saldo insuficiente", b: gate.msg, tone: "text-red-400", light: "bg-red-600" },
    evasion: { a: "Paso no autorizado", b: "Auditoría RF-11 registrada", tone: "text-red-200", light: "bg-red-600" },
  }[gate.state];

  const open = gate.state === "granted" || gate.state === "evasion";
  const panelStripe = {
    backgroundImage:
      "repeating-linear-gradient(135deg,#525252 0,#525252 8px,#262626 8px,#262626 16px)",
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">

      <Panel
        title="Molinete T-02, Estación Trébol"
        right={
          <span className="inline-flex items-center gap-1.5 text-xs text-neutral-300">
            <span className={`h-2.5 w-2.5 ${LCD.light}`} />
            {gate.state === "idle" ? "En espera" : gate.state === "reading" ? "Leyendo" : gate.state === "granted" ? "Abierto" : gate.state === "card" ? "Tarjeta en lector" : "Bloqueado"}
          </span>
        }
        className={gate.state === "evasion" ? "border-red-600" : ""}
      >
        <div
          className={`mb-4 border px-4 py-3 font-log ${
            gate.state === "evasion" ? "alarm-blink border-red-500" : "border-neutral-700 bg-neutral-950"
          }`}
          aria-live="polite"
        >
          <div className={`text-lg font-medium ${LCD.tone}`}>{LCD.a}</div>
          <div className="min-h-[1.25rem] text-sm text-neutral-300">{LCD.b}</div>
        </div>

        <div className="relative mx-auto h-48 w-full max-w-xs overflow-hidden border border-neutral-700 bg-neutral-950">

          <div
            style={panelStripe}
            className={`absolute bottom-0 left-0 top-0 w-1/2 border-r border-neutral-500 transition-transform duration-200 ${
              open ? "-translate-x-full" : ""
            }`}
          />
          <div
            style={panelStripe}
            className={`absolute bottom-0 right-0 top-0 w-1/2 border-l border-neutral-500 transition-transform duration-200 ${
              open ? "translate-x-full" : ""
            }`}
          />

          {(gate.state === "granted" || gate.state === "evasion") && (
            <div
              key={gate.key}
              className={`walker absolute left-1/2 z-10 h-5 w-5 -translate-x-1/2 rounded-full ${
                gate.state === "granted" ? "bg-green-500" : "bg-red-500"
              }`}
            />
          )}

          <div className={`absolute left-1/2 top-2 z-20 h-2 w-16 -translate-x-1/2 ${LCD.light}`} />
        </div>

        <div className="mt-4 flex items-center justify-between text-xs text-neutral-400">
          <span>
            Última validación:{" "}
            {latency == null ? (
              "sin datos"
            ) : (
              <span className={latency < 300 ? "text-green-400" : "text-amber-300"}>{latency} ms</span>
            )}
          </span>
          <span>Objetivo: menos de 300 ms</span>
        </div>
      </Panel>

      <div className="space-y-4">
        <Panel title="Tarjeta ciudadana">
          <div className="grid grid-cols-3 gap-2" role="group" aria-label="Perfil de tarjeta">
            {Object.entries(PROFILES).map(([k, p]) => (
              <button
                key={k}
                onClick={() => selectProfile(k)}
                aria-pressed={profileKey === k}
                className={`border px-2 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-neutral-100 ${
                  profileKey === k
                    ? "border-neutral-100 bg-neutral-100 text-black"
                    : "border-neutral-700 text-neutral-300 hover:bg-neutral-800"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2">
            <div className="border border-neutral-800 bg-neutral-950 px-3 py-2">
              <div className="text-xs text-neutral-400">ID de tarjeta</div>
              <div className="font-log text-sm">#{profile.cardId}</div>
            </div>
            <div className="border border-neutral-800 bg-neutral-950 px-3 py-2">
              <div className="text-xs text-neutral-400">Saldo</div>
              <div className="font-log text-sm">{q(balance)}</div>
            </div>
            <div className="border border-neutral-800 bg-neutral-950 px-3 py-2">
              <div className="text-xs text-neutral-400">Tarifa (simulada)</div>
              <div className="font-log text-sm">{q(profile.fare)}</div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Btn variant="primary" onClick={tapCard} disabled={busy}>
              Acercar Tarjeta Ciudadana (NFC)
            </Btn>
            <Btn onClick={recharge}>Recargar Q10.00</Btn>
            <Btn onClick={removeCard} disabled={!cardActive || busy}>
              Retirar tarjeta
            </Btn>
          </div>
        </Panel>

        <Panel title="Acciones del molinete">
          <div className="grid gap-2 sm:grid-cols-2">
            <Btn variant="ok" disabled={!cardActive || busy} onClick={() => validate("ok")}>
              Validar acceso (saldo OK)
            </Btn>
            <Btn variant="warn" disabled={!cardActive || busy} onClick={() => validate("nofunds")}>
              Validar acceso (sin saldo)
            </Btn>
            <Btn variant="danger" className="sm:col-span-2" disabled={busy} onClick={evade}>
              Simular salto de molinete (evasión)
            </Btn>
          </div>
          {!cardActive && (
            <p className="mt-2 text-xs text-neutral-400">
              Acerca la tarjeta al lector para habilitar la validación.
            </p>
          )}
        </Panel>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Accesos" value={stats.ok} tone="text-green-400" />
          <Stat label="Rechazos" value={stats.denied} tone="text-amber-300" />
          <Stat label="Evasiones" value={stats.evasion} tone={stats.evasion ? "text-red-400" : "text-neutral-100"} />
          <Stat label="Recaudo" value={q(stats.revenue)} />
        </div>
      </div>

      <div className="lg:col-span-2">
        <Panel title="Auditoría de evasión tarifaria (RF-11)">
          {evasions.length === 0 ? (
            <p className="text-sm text-neutral-400">Sin eventos. Simula un salto de molinete para generar un registro.</p>
          ) : (
            <ul className="space-y-2">
              {evasions.map((e) => (
                <li
                  key={e.id}
                  className="flex flex-wrap items-center justify-between gap-2 border border-red-700 bg-red-950 px-3 py-2 text-sm"
                >
                  <span className="font-semibold text-red-300">{e.id}</span>
                  <span className="text-red-100">Salto detectado en {e.turnstile}, {e.station}</span>
                  <span className="font-log text-xs text-red-200">{e.at}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

const ALARM_STEPS = [
  { key: "activa", label: "Alerta activa" },
  { key: "reconocida", label: "Reconocida por C5" },
  { key: "apoyo", label: "Apoyo despachado" },
];
const STATUS_LABEL = { activa: "Activa", reconocida: "Reconocida", apoyo: "Apoyo despachado", cerrada: "Cerrada" };

function SecurityTab({ buses, alarm, history, onPanic, onAdvance }) {
  const [source, setSource] = useState("bus");
  const [busId, setBusId] = useState(101);
  const [stationId, setStationId] = useState("T");

  const live = alarm ? alarmCoords(alarm, buses) : null;
  const stepIndex = alarm ? ALARM_STEPS.findIndex((s) => s.key === alarm.status) : -1;
  const selectCls =
    "w-full border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-neutral-100";

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Botón de pánico (RF-17)">
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Origen de la alerta">
            {[
              ["bus", "Operador a bordo"],
              ["station", "Operador en andén"],
            ].map(([k, label]) => (
              <button
                key={k}
                aria-pressed={source === k}
                onClick={() => setSource(k)}
                className={`border px-2 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-neutral-100 ${
                  source === k
                    ? "border-neutral-100 bg-neutral-100 text-black"
                    : "border-neutral-700 text-neutral-300 hover:bg-neutral-800"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="mt-3">
            {source === "bus" ? (
              <select className={selectCls} value={busId} onChange={(e) => setBusId(Number(e.target.value))} aria-label="Unidad">
                {buses.map((b) => (
                  <option key={b.id} value={b.id}>
                    Bus #{b.id} ({b.status})
                  </option>
                ))}
              </select>
            ) : (
              <select className={selectCls} value={stationId} onChange={(e) => setStationId(e.target.value)} aria-label="Andén">
                {STATIONS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <button
            disabled={!!alarm}
            onClick={() => onPanic({ kind: source, busId, stationId })}
            className="mt-4 flex h-44 w-full flex-col items-center justify-center bg-red-700 text-white transition-colors hover:bg-red-600 focus-visible:outline focus-visible:outline-4 focus-visible:outline-neutral-100 disabled:cursor-not-allowed disabled:bg-neutral-800 disabled:text-neutral-500"
          >
            <span className="text-6xl font-bold leading-none">SOS</span>
            <span className="mt-2 text-base font-semibold">
              {alarm ? "Alerta en curso" : "Alerta de pánico"}
            </span>
          </button>
          <p className="mt-2 text-xs text-neutral-400">
            Genera una alerta prioritaria con las coordenadas GPS simuladas del origen.
          </p>
        </Panel>

        <Panel title="Incidente en curso (RF-19)" className={alarm ? "border-red-600" : ""}>
          {!alarm ? (
            <div className="flex h-full min-h-[14rem] items-center justify-center text-sm text-neutral-400">
              Sin alertas activas. El sistema está en monitoreo normal.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-2xl font-bold text-red-400">{alarm.id}</div>
                  <div className="text-sm text-neutral-200">
                    {alarm.kind === "bus" ? "Operador a bordo" : "Operador en andén"}: {alarm.label}
                  </div>
                  <div className="text-xs text-neutral-400">Activada a las {alarm.at}</div>
                </div>
                <span className="bg-red-700 px-2 py-1 text-xs font-semibold text-white">Prioridad crítica</span>
              </div>

              <div className="border border-red-800 bg-red-950 px-4 py-3">
                <div className="text-xs text-red-200">
                  Coordenadas GPS {alarm.kind === "bus" ? "(seguimiento en vivo)" : "(posición fija)"}
                </div>
                <div className="font-log text-xl text-red-100">
                  {live.lat.toFixed(5)}, {live.lon.toFixed(5)}
                </div>
              </div>

              <ol className="grid grid-cols-3 gap-2 text-xs">
                {ALARM_STEPS.map((s, i) => (
                  <li
                    key={s.key}
                    className={`border px-2 py-2 ${
                      i < stepIndex
                        ? "border-neutral-500 text-neutral-100"
                        : i === stepIndex
                        ? "border-red-500 font-semibold text-red-400"
                        : "border-neutral-800 text-neutral-600"
                    }`}
                  >
                    {s.label}
                  </li>
                ))}
              </ol>

              <div className="flex flex-wrap gap-2">
                <Btn variant="danger" disabled={alarm.status !== "activa"} onClick={() => onAdvance("reconocida")}>
                  Reconocer alerta
                </Btn>
                <Btn variant="warn" disabled={alarm.status !== "reconocida"} onClick={() => onAdvance("apoyo")}>
                  Despachar apoyo
                </Btn>
                <Btn disabled={alarm.status !== "apoyo"} onClick={() => onAdvance("cerrada")}>
                  Cerrar incidente
                </Btn>
              </div>
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Monitoreo de unidades (RF-19)">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-left text-sm">
            <thead className="text-xs text-neutral-400">
              <tr className="border-b border-neutral-800">
                <th className="py-2 pr-3 font-medium">Unidad</th>
                <th className="py-2 pr-3 font-medium">Estado</th>
                <th className="py-2 pr-3 font-medium">Latitud</th>
                <th className="py-2 pr-3 font-medium">Longitud</th>
                <th className="py-2 pr-3 font-medium">Velocidad</th>
                <th className="py-2 font-medium">Señal GPS</th>
              </tr>
            </thead>
            <tbody>
              {buses.map((b) => {
                const c = busCoords(b);
                const flagged = alarm && alarm.kind === "bus" && alarm.busId === b.id;
                const spd = b.status === "En Ruta" && b.hold === 0 ? Math.round(b.speed * 14) : 0;
                return (
                  <tr key={b.id} className={`border-b border-neutral-800 ${flagged ? "bg-red-950 text-red-200" : ""}`}>
                    <td className="py-2 pr-3 font-semibold">Bus #{b.id}</td>
                    <td className="py-2 pr-3">
                      <StatusBadge status={b.status} />
                    </td>
                    <td className="py-2 pr-3 font-log text-xs">{c.lat.toFixed(5)}</td>
                    <td className="py-2 pr-3 font-log text-xs">{c.lon.toFixed(5)}</td>
                    <td className="py-2 pr-3 font-log text-xs">{spd} km/h</td>
                    <td className={`py-2 text-xs ${flagged ? "font-semibold text-red-300" : "text-green-400"}`}>
                      {flagged ? "SOS activo" : "Normal"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Historial de alertas">
        {history.length === 0 ? (
          <p className="text-sm text-neutral-400">Aún no se han registrado alertas en esta sesión.</p>
        ) : (
          <ul className="space-y-2">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm">
                <span className="font-semibold">{h.id}</span>
                <span className="text-neutral-300">{h.label}</span>
                <span className="font-log text-xs text-neutral-400">{h.at}</span>
                <span className={h.status === "cerrada" ? "text-green-400" : "text-red-400"}>{STATUS_LABEL[h.status]}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

const LOG_TONE = {
  info: "text-neutral-300",
  ok: "text-green-400",
  warn: "text-amber-300",
  alarm: "border-l-2 border-red-500 bg-red-950 pl-1.5 font-semibold text-red-300",
};

function LogConsole({ logs, onClear }) {
  const ref = useRef(null);
  const [auto, setAuto] = useState(true);
  useEffect(() => {
    if (auto && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [logs, auto]);

  return (
    <aside className="flex h-64 min-h-0 flex-col no-print border-t border-neutral-800 bg-neutral-950 lg:h-auto lg:w-[26rem] lg:flex-none lg:border-l lg:border-t-0">
      <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-2.5">
        <h2 className="text-sm font-semibold">Consola de eventos</h2>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-neutral-400">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="accent-neutral-300" />
            Seguir
          </label>
          <button
            onClick={onClear}
            className="border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-neutral-100"
          >
            Limpiar
          </button>
        </div>
      </div>
      <div ref={ref} className="font-log min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-2 text-xs leading-relaxed">
        {logs.length === 0 && <div className="text-neutral-600">Sin eventos.</div>}
        {logs.map((l) => (
          <div key={l.id} className={`break-words ${LOG_TONE[l.level]}`}>
            <span className="text-neutral-500">[{l.ts}]</span> [{l.rf}] {l.msg}
          </div>
        ))}
      </div>
    </aside>
  );
}

const WORKSPACES = [
  {
    key: "red",
    label: "Red y base de datos",
    tabs: [
      ["lineas", "Líneas y flota"],
      ["estacion", "Estación del operador"],
      ["reportes", "Reportes SQL"],
      ["bd", "Base de datos"],
    ],
  },
  {
    key: "c5",
    label: "Centro de control C5 (simulación)",
    tabs: [
      ["flota", "Flota y terminales"],
      ["molinete", "Tarjeta y molinete"],
      ["seguridad", "Seguridad y alertas"],
      ["pasajeros", "Pasajeros"],
      ["operadores", "Operadores"],
    ],
  },
];
const ALL_TABS = WORKSPACES.flatMap((w) => w.tabs.map(([k]) => k));
const tabWorkspace = (t) => WORKSPACES.find((w) => w.tabs.some(([k]) => k === t))?.key ?? "red";

// La dirección #reportes/R04 abre directamente esa pestaña (útil para documentar y para las capturas)
function readHash() {
  const [t, arg] = window.location.hash.replace(/^#\/?/, "").split("/");
  return { tab: ALL_TABS.includes(t) ? t : "lineas", arg: arg ? decodeURIComponent(arg) : undefined };
}

export default function App() {
  const [initial] = useState(readHash);
  const [tab, setTab] = useState(initial.tab);
  const { status: dbStatus, step: dbStep } = useDb();

  useEffect(() => {
    const onHash = () => setTab(readHash().tab);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    const cur = window.location.hash.replace(/^#\/?/, "").split("/")[0];
    if (cur !== tab) window.history.replaceState(null, "", `#${tab}`);
  }, [tab]);
  const [now, setNow] = useState(new Date());
  const [logs, setLogs] = useState([]);
  const [buses, setBuses] = useState(INITIAL_BUSES);
  const [running, setRunning] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [dispatches, setDispatches] = useState({ N: 0, S: 0 });
  const [headways, setHeadways] = useState({ N: null, S: null });
  const [evasionCount, setEvasionCount] = useState(0);
  const [alarm, setAlarm] = useState(null);
  const [history, setHistory] = useState([]);

  const busesRef = useRef(INITIAL_BUSES);
  const logSeq = useRef(0);
  const alarmSeq = useRef(0);
  const lastDispatch = useRef({ N: null, S: null });
  const seenPairs = useRef(new Set());
  const booted = useRef(false);

  const log = useCallback((rf, msg, level = "info") => {
    const entry = { id: ++logSeq.current, ts: stamp(), rf, msg, level };
    setLogs((prev) => [...prev.slice(-199), entry]);
  }, []);

  const updateBuses = useCallback((next) => {
    busesRef.current = next;
    setBuses(next);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    log("RF-01", `Sistema iniciado - Flota registrada: ${INITIAL_BUSES.length} unidades articuladas`, "ok");
    log("RF-02", "Pórticos RFID en Terminal Centra Norte y Terminal Centra Sur en línea", "ok");
  }, [log]);

  useEffect(() => {
    if (dbStatus === "ready") log("BD", "PostgreSQL listo en el navegador - catálogo de líneas, estaciones, accesos, buses y pilotos cargado", "ok");
  }, [dbStatus, log]);

  useEffect(() => {
    if (!running) return undefined;
    const id = setInterval(() => {
      const events = [];
      const list = busesRef.current;
      const next = list.map((b) => {
        if (b.status !== "En Ruta") return b;
        if (b.hold > 0) return { ...b, hold: b.hold - 1 };
        const pos = b.pos + b.dir * b.speed;
        const arrived = b.dir === 1 ? pos >= 100 : pos <= 0;
        if (!arrived) return { ...b, pos };
        const tk = b.dir === 1 ? "S" : "N";
        const t = TERMINALS[tk];
        const inPatio = list.filter((x) => x.status === "En Patio" && x.terminal === tk).length + 1;
        events.push(`Entrada en pórtico RFID ${t.name} - Bus #${b.id} - Unidades en patio: ${inPatio}`);
        return { ...b, status: "En Patio", terminal: tk, pos: t.pos, dir: t.dir, hold: 0 };
      });
      updateBuses(next);
      events.forEach((m) => log("RF-02", m, "ok"));
    }, 1000);
    return () => clearInterval(id);
  }, [running, log, updateBuses]);

  const pairs = useMemo(() => {
    const out = [];
    [1, -1].forEach((d) => {
      const g = buses
        .filter((b) => b.status === "En Ruta" && b.dir === d)
        .sort((a, b) => b.pos * d - a.pos * d);
      for (let i = 0; i < g.length - 1; i++) {
        const gap = Math.abs(g[i].pos - g[i + 1].pos);
        if (gap < CRITICAL_GAP) out.push({ lead: g[i], trail: g[i + 1], gap, key: `${g[i].id}-${g[i + 1].id}` });
      }
    });
    return out;
  }, [buses]);

  useEffect(() => {
    const keys = new Set(pairs.map((p) => p.key));
    pairs.forEach((p) => {
      if (!seenPairs.current.has(p.key)) {
        log(
          "RF-03",
          `BUS BUNCHING - Bus #${p.lead.id} y Bus #${p.trail.id} a ${Math.round(p.gap * ROUTE_KM * 10)} m (umbral ${Math.round(CRITICAL_GAP * ROUTE_KM * 10)} m)`,
          "warn"
        );
      }
    });
    seenPairs.current = keys;
  }, [pairs, log]);

  const dispatchBus = (id) => {
    const list = busesRef.current;
    const b = list.find((x) => x.id === id);
    const t = TERMINALS[b.terminal];
    const nowMs = Date.now();
    const prev = lastDispatch.current[b.terminal];
    const headway = prev ? Math.round((nowMs - prev) / 1000) : null;
    lastDispatch.current[b.terminal] = nowMs;
    updateBuses(list.map((x) => (x.id === id ? { ...x, status: "En Ruta", pos: t.pos, dir: t.dir, hold: 0 } : x)));
    setDispatches((d) => ({ ...d, [b.terminal]: d[b.terminal] + 1 }));
    setHeadways((h) => ({ ...h, [b.terminal]: headway }));
    log("RF-02", `Salida en pórtico RFID ${t.name} - Bus #${id} - Tag leído correctamente`, "ok");
    log("RF-03", `Despacho Bus #${id} desde ${t.short}${headway !== null ? ` - Intervalo desde el despacho anterior: ${headway} s` : " - Primer despacho de la sesión"}`, "info");
  };

  const enterBus = (id) => {
    const list = busesRef.current;
    const b = list.find((x) => x.id === id);
    const tk = b.pos < 50 ? "N" : "S";
    const t = TERMINALS[tk];
    const inPatio = list.filter((x) => x.status === "En Patio" && x.terminal === tk).length + 1;
    updateBuses(list.map((x) => (x.id === id ? { ...x, status: "En Patio", terminal: tk, pos: t.pos, dir: t.dir, hold: 0 } : x)));
    log("RF-02", `Entrada en pórtico RFID ${t.name} - Bus #${id} - Unidades en patio: ${inPatio}`, "ok");
  };

  const onPortico = () => {
    const list = busesRef.current;
    let target = selectedId ? list.find((b) => b.id === selectedId) : null;
    if (!target) {
      target =
        list.find((b) => b.status === "En Patio") ||
        list
          .filter((b) => b.status === "En Ruta")
          .sort((a, b) => Math.min(a.pos, 100 - a.pos) - Math.min(b.pos, 100 - b.pos))[0];
    }
    if (!target) {
      log("RF-02", "Sin unidades disponibles para operar en pórtico", "warn");
      return;
    }
    if (target.status === "Mantenimiento") {
      log("RF-03", `Despacho bloqueado - Bus #${target.id} está en mantenimiento`, "warn");
      return;
    }
    if (target.status === "En Patio") dispatchBus(target.id);
    else enterBus(target.id);
  };

  const onMaintenance = (id) => {
    const list = busesRef.current;
    const b = list.find((x) => x.id === id);
    if (!b || b.status === "En Ruta") return;
    const toMaint = b.status !== "Mantenimiento";
    updateBuses(list.map((x) => (x.id === id ? { ...x, status: toMaint ? "Mantenimiento" : "En Patio" } : x)));
    log("RF-01", toMaint ? `Bus #${id} enviado a mantenimiento - Retirado del conteo operativo` : `Bus #${id} liberado de mantenimiento - Disponible en patio`, toMaint ? "warn" : "ok");
  };

  const onForceBunching = () => {
    const list = busesRef.current;
    const groups = [1, -1]
      .map((d) => list.filter((b) => b.status === "En Ruta" && b.dir === d).sort((a, b) => b.pos * d - a.pos * d))
      .filter((g) => g.length >= 2);
    if (groups.length === 0) {
      log("RF-03", "Se requieren al menos 2 unidades en ruta en el mismo sentido para simular un convoy", "warn");
      return;
    }
    const [lead, trail] = groups[0];
    const newPos = Math.min(100, Math.max(0, lead.pos - lead.dir * 3));
    updateBuses(list.map((x) => (x.id === trail.id ? { ...x, pos: newPos, hold: 0 } : x)));
  };

  const onHold = (id) => {
    updateBuses(busesRef.current.map((x) => (x.id === id ? { ...x, hold: 10 } : x)));
    log("RF-03", `Retención aplicada a Bus #${id} - 10 s para recuperar intervalo`, "info");
  };

  const triggerPanic = ({ kind, busId, stationId }) => {
    if (alarm) return;
    const id = `SOS-${pad(++alarmSeq.current, 4)}`;
    let label;
    let lat;
    let lon;
    if (kind === "bus") {
      const b = busesRef.current.find((x) => x.id === busId);
      ({ lat, lon } = busCoords(b));
      label = `Bus #${b.id}`;
    } else {
      const s = STATIONS.find((x) => x.id === stationId);
      lat = s.lat;
      lon = s.lon;
      label = s.name;
    }
    const at = stamp();
    setAlarm({ id, kind, busId, stationId, label, lat, lon, at, status: "activa" });
    setHistory((h) => [{ id, label, at, status: "activa" }, ...h].slice(0, 8));
    setTab("seguridad");
    log(
      "RF-17",
      `ALERTA DE PÁNICO ${id} - ${kind === "bus" ? "Operador a bordo" : "Operador en andén"} - ${label} - GPS ${lat.toFixed(5)}, ${lon.toFixed(5)} - PRIORIDAD CRÍTICA`,
      "alarm"
    );
  };

  const advanceAlarm = (next) => {
    if (!alarm) return;
    const c = alarmCoords(alarm, busesRef.current);
    if (next === "cerrada") {
      log("RF-19", `Incidente ${alarm.id} cerrado - Registro archivado en bitácora de seguridad`, "ok");
      setHistory((h) => h.map((x) => (x.id === alarm.id ? { ...x, status: "cerrada" } : x)));
      setAlarm(null);
      return;
    }
    if (next === "reconocida") {
      log("RF-19", `${alarm.id} reconocida por operador C5 - Seguimiento GPS prioritario activo`, "warn");
    } else {
      log("RF-19", `${alarm.id} - Apoyo despachado a ${c.lat.toFixed(5)}, ${c.lon.toFixed(5)}`, "warn");
    }
    setAlarm({ ...alarm, status: next });
    setHistory((h) => h.map((x) => (x.id === alarm.id ? { ...x, status: next } : x)));
  };

  const emergency = alarm && alarm.status === "activa";
  const pendientes = useQuery("SELECT count(*)::int AS n FROM alerta WHERE NOT atendida").rows[0]?.n ?? 0;
  const badges = {
    flota: pairs.length ? { n: pairs.length, cls: "bg-amber-400 text-black" } : null,
    molinete: evasionCount ? { n: evasionCount, cls: "bg-red-600 text-white" } : null,
    seguridad: alarm ? { n: "SOS", cls: "bg-red-600 text-white" } : null,
    estacion: pendientes ? { n: pendientes, cls: "bg-red-600 text-white" } : null,
  };
  const workspace = tabWorkspace(tab);
  const tabs = WORKSPACES.find((w) => w.key === workspace).tabs.map(([key, label]) => ({ key, label, badge: badges[key] || null }));

  return (
    <div
      className={`font-ui flex h-screen flex-col bg-neutral-950 text-neutral-100 ${
        alarm ? "ring-4 ring-inset ring-red-600" : ""
      }`}
    >
      <style>{GLOBAL_CSS}</style>
      {emergency && <div className="sos-flash pointer-events-none fixed inset-0 z-40" aria-hidden="true" />}

      <header className="no-print border-b border-neutral-800 bg-neutral-900">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
          <div className="flex items-center gap-3">
            <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true">
              <rect width="34" height="34" rx="8" fill="#1f9d55" />
              <path d="M7 22h20M9 22v-9a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9M12 26.5a1.6 1.6 0 1 0 0-.01M22 26.5a1.6 1.6 0 1 0 0-.01M12 16h10" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            <div>
              <h1 className="text-lg font-bold leading-tight">Transmetro Guatemala</h1>
              <p className="text-xs text-neutral-400">Sistema de control de líneas, estaciones, flota y recaudación</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span
              className={`inline-flex items-center gap-1.5 text-xs ${dbStatus === "ready" ? "text-brand-300" : dbStatus === "error" ? "text-red-400" : "text-amber-300"}`}
              title={dbStatus === "loading" ? dbStep : "Base de datos PostgreSQL en el navegador"}
            >
              <span className={`h-2 w-2 rounded-full ${dbStatus === "ready" ? "bg-brand-400" : dbStatus === "error" ? "bg-red-500" : "animate-pulse bg-amber-400"}`} />
              {dbStatus === "ready" ? "PostgreSQL conectado" : dbStatus === "error" ? "Error en la base de datos" : "Cargando base de datos"}
            </span>
            <span className={`inline-flex items-center gap-1.5 ${running ? "text-green-400" : "text-amber-300"}`}>
              <span className={`h-2 w-2 rounded-full ${running ? "bg-green-500" : "bg-amber-400"}`} />
              {running ? "Simulación activa" : "Simulación en pausa"}
            </span>
            <span className="font-log text-neutral-200">
              {now.toLocaleDateString("es-GT")} {stamp(now)}
            </span>
          </div>
        </div>
        {alarm && (
          <div
            role="alert"
            className={`relative z-50 px-4 py-2 text-sm font-semibold text-white ${emergency ? "bg-red-600" : "bg-red-900"}`}
          >
            EMERGENCIA {alarm.id}: {alarm.label}. Estado: {STATUS_LABEL[alarm.status]}.
          </div>
        )}
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <nav className="no-print sticky top-0 z-30 border-b border-neutral-800 bg-neutral-950">
            <div className="flex gap-2 px-4 pt-3">
              {WORKSPACES.map((w) => (
                <button
                  key={w.key}
                  aria-pressed={workspace === w.key}
                  onClick={() => setTab(w.tabs[0][0])}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400 ${
                    workspace === w.key ? "border-brand-500 bg-brand-900 text-brand-300" : "border-neutral-700 text-neutral-400 hover:text-neutral-200"
                  }`}
                >
                  {w.label}
                </button>
              ))}
            </div>
            <div className="flex overflow-x-auto" role="tablist">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={tab === t.key}
                  onClick={() => setTab(t.key)}
                  className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-5 py-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-400 ${
                    tab === t.key ? "border-brand-400 text-white" : "border-transparent text-neutral-400 hover:text-neutral-200"
                  }`}
                >
                  {t.label}
                  {t.badge && <span className={`rounded px-1.5 text-xs font-bold ${t.badge.cls}`}>{t.badge.n}</span>}
                </button>
              ))}
            </div>
          </nav>

          <div className="p-4">
            {tab === "lineas" && <NetworkTab log={log} initialLinea={readHash().arg} />}
            {tab === "estacion" && <StationTab log={log} initialEstacion={readHash().arg} />}
            {tab === "reportes" && <ReportsTab log={log} initialReport={readHash().arg} />}
            {tab === "bd" && <DatabaseTab log={log} />}
            <div className={tab === "flota" ? "" : "hidden"}>
              <FleetTab
                buses={buses}
                pairs={pairs}
                running={running}
                setRunning={setRunning}
                selectedId={selectedId}
                setSelectedId={setSelectedId}
                onPortico={onPortico}
                onForceBunching={onForceBunching}
                onMaintenance={onMaintenance}
                onHold={onHold}
                dispatches={dispatches}
                headways={headways}
              />
            </div>
            <div className={tab === "molinete" ? "" : "hidden"}>
              <GateTab log={log} onEvasion={() => setEvasionCount((n) => n + 1)} />
            </div>
            <div className={tab === "seguridad" ? "" : "hidden"}>
              <SecurityTab buses={buses} alarm={alarm} history={history} onPanic={triggerPanic} onAdvance={advanceAlarm} />
            </div>
            <div className={tab === "pasajeros" ? "" : "hidden"}>
              <PassengersTab buses={buses} log={log} />
            </div>
            <div className={tab === "operadores" ? "" : "hidden"}>
              <OperatorsTab buses={buses} log={log} />
            </div>
          </div>
        </main>

        <LogConsole logs={logs} onClear={() => setLogs([])} />
      </div>
    </div>
  );
}

