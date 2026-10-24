import { useEffect, useMemo, useState } from "react";
import { Panel, Btn, Stat, Badge, Notice, Field, inputCls, Loading } from "./ui";
import { useDb, useQuery } from "./db/useDb";

const SQL_LINEAS = `
SELECT c.id_linea, c.codigo, c.nombre, c.municipalidad, c.estado, c.estaciones, c.distancia_km,
       c.buses_asignados, c.buses_minimo, c.buses_maximo, c.cumplimiento, l.color_hex
  FROM vw_linea_cumplimiento c JOIN linea l USING (id_linea)
 ORDER BY c.codigo`;

const SQL_TOTALES = `
SELECT (SELECT count(*) FROM linea WHERE estado = 'ACTIVA')::int AS lineas,
       (SELECT count(*) FROM estacion)::int AS estaciones,
       (SELECT count(*) FROM acceso)::int AS accesos,
       (SELECT count(*) FROM bus)::int AS buses,
       (SELECT count(*) FROM bus WHERE id_linea IS NULL)::int AS sin_linea`;

const SQL_ESTACIONES = `
SELECT v.orden, v.estacion, v.km_desde_anterior, v.km_acumulado, m.nombre AS municipalidad, e.es_terminal,
       (SELECT count(*) FROM acceso a WHERE a.id_estacion = v.id_estacion)::int AS accesos,
       (SELECT string_agg(l.codigo, ',' ORDER BY l.codigo)
          FROM linea_estacion x JOIN linea l USING (id_linea)
         WHERE x.id_estacion = v.id_estacion AND x.id_linea <> v.id_linea) AS otras_lineas
  FROM vw_linea_estaciones v
  JOIN estacion e ON e.id_estacion = v.id_estacion
  JOIN municipalidad m ON m.id_municipalidad = e.id_municipalidad
 WHERE v.id_linea = $1
 ORDER BY v.orden`;

const SQL_BUSES = `
SELECT b.id_bus, b.numero_unidad, b.placa, b.tipo, b.capacidad_pasajeros, b.estado, b.id_parqueo, p.nombre AS parqueo
  FROM bus b JOIN parqueo p USING (id_parqueo)
 WHERE b.id_linea = $1
 ORDER BY b.numero_unidad`;

const SQL_LIBRES = `
SELECT b.id_bus, b.numero_unidad, b.tipo, b.capacidad_pasajeros, b.estado, p.nombre AS parqueo
  FROM bus b JOIN parqueo p USING (id_parqueo)
 WHERE b.id_linea IS NULL
 ORDER BY b.numero_unidad`;

const SQL_PARQUEOS = `
SELECT p.id_parqueo, p.nombre, p.capacidad_buses, count(b.id_bus)::int AS usados
  FROM parqueo p LEFT JOIN bus b USING (id_parqueo)
 GROUP BY p.id_parqueo, p.nombre, p.capacidad_buses
 ORDER BY p.nombre`;

const CUMPLE_TONE = { CUMPLE: "ok", "EN PLANIFICACIÓN": "info", "FALTAN BUSES": "danger", "EXCEDE EL MÁXIMO": "danger" };

function FleetMeter({ buses, min, max }) {
  const scale = Math.max(max * 1.12, buses + 1, 1);
  const pct = (n) => `${Math.min(100, (n / scale) * 100)}%`;
  const ok = buses >= min && buses <= max;
  return (
    <div>
      <div className="relative h-4 rounded-full bg-neutral-800">
        <div className="absolute inset-y-0 rounded-full bg-neutral-700/60" style={{ left: pct(min), width: `calc(${pct(max)} - ${pct(min)})` }} title="Rango permitido" />
        <div className={`absolute inset-y-0 left-0 rounded-full ${ok ? "bg-brand-500" : "bg-amber-500"}`} style={{ width: pct(buses) }} />
        <div className="absolute -top-1 h-6 w-px bg-neutral-300" style={{ left: pct(min) }} />
        <div className="absolute -top-1 h-6 w-px bg-neutral-300" style={{ left: pct(max) }} />
      </div>
      <div className="relative mt-1 h-4 text-[11px] text-neutral-400">
        <span className="absolute -translate-x-1/2" style={{ left: pct(min) }}>
          mín. {min}
        </span>
        <span className="absolute -translate-x-1/2" style={{ left: pct(max) }}>
          máx. {max}
        </span>
      </div>
    </div>
  );
}

export default function NetworkTab({ log, initialLinea }) {
  const { status, write } = useDb();
  const lineas = useQuery(SQL_LINEAS);
  const totales = useQuery(SQL_TOTALES);
  const parqueos = useQuery(SQL_PARQUEOS);
  const [sel, setSel] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busLibre, setBusLibre] = useState("");

  useEffect(() => {
    if (sel || lineas.rows.length === 0) return;
    const wanted = lineas.rows.find((l) => l.codigo === initialLinea) || lineas.rows[0];
    setSel(wanted.id_linea);
  }, [lineas.rows, sel, initialLinea]);

  const linea = useMemo(() => lineas.rows.find((l) => l.id_linea === sel), [lineas.rows, sel]);
  const estaciones = useQuery(SQL_ESTACIONES, [sel], sel != null);
  const buses = useQuery(SQL_BUSES, [sel], sel != null);
  const libres = useQuery(SQL_LIBRES);

  useEffect(() => {
    if (!libres.rows.find((b) => String(b.id_bus) === busLibre)) setBusLibre(libres.rows[0] ? String(libres.rows[0].id_bus) : "");
  }, [libres.rows, busLibre]);

  if (status !== "ready") return <Loading text="Preparando la base de datos" />;

  const act = async (sql, params, okMsg, logMsg) => {
    const r = await write(sql, params);
    if (r.ok) {
      setNotice({ kind: "ok", text: okMsg });
      log("BD", logMsg ?? okMsg, "ok");
    } else {
      setNotice({ kind: "error", text: `La base de datos rechazó el cambio: ${r.error}` });
      log("BD", `Cambio rechazado por las reglas del sistema: ${r.error}`, "warn");
    }
  };

  const asignar = () => {
    const b = libres.rows.find((x) => String(x.id_bus) === busLibre);
    if (!b) return;
    act("UPDATE bus SET id_linea = $1 WHERE id_bus = $2", [sel, b.id_bus], `El bus ${b.numero_unidad} quedó asignado a la línea ${linea.codigo}.`);
  };
  const quitar = (b) =>
    act("UPDATE bus SET id_linea = NULL WHERE id_bus = $1", [b.id_bus], `El bus ${b.numero_unidad} salió de la línea ${linea.codigo} y quedó sin línea.`);
  const moverParqueo = (b, idParqueo) => {
    const p = parqueos.rows.find((x) => x.id_parqueo === Number(idParqueo));
    act("UPDATE bus SET id_parqueo = $1 WHERE id_bus = $2", [Number(idParqueo), b.id_bus], `El bus ${b.numero_unidad} cambió al parqueo ${p?.nombre}. El cambio queda en el historial.`);
  };
  const cambiarEstado = (estado) =>
    act("UPDATE linea SET estado = $1 WHERE id_linea = $2", [estado, sel], `La línea ${linea.codigo} ahora está ${estado}.`);

  const t = totales.rows[0];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Líneas activas" value={t?.lineas ?? "—"} />
        <Stat label="Estaciones" value={t?.estaciones ?? "—"} />
        <Stat label="Accesos" value={t?.accesos ?? "—"} />
        <Stat label="Buses en la flota" value={t?.buses ?? "—"} />
        <Stat label="Buses sin línea" value={t?.sin_linea ?? "—"} tone="text-amber-300" />
      </div>

      {notice && (
        <Notice kind={notice.kind} onClose={() => setNotice(null)}>
          {notice.text}
        </Notice>
      )}

      <div className="grid gap-4 xl:grid-cols-[22rem_1fr]">
        <div className="space-y-2" role="list" aria-label="Líneas">
          {lineas.rows.map((l) => (
            <button
              key={l.id_linea}
              role="listitem"
              onClick={() => setSel(l.id_linea)}
              aria-pressed={sel === l.id_linea}
              className={`block w-full rounded-xl border p-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400 ${
                sel === l.id_linea ? "border-brand-500 bg-neutral-800" : "border-neutral-800 bg-neutral-900 hover:border-neutral-600"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-base font-bold">
                  <span className="h-3 w-3 rounded-full" style={{ background: l.color_hex }} />
                  {l.codigo}
                </span>
                <Badge tone={CUMPLE_TONE[l.cumplimiento] || "neutral"}>{l.cumplimiento}</Badge>
              </div>
              <div className="mt-1 text-sm text-neutral-200">{l.nombre}</div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-neutral-400">
                <span>
                  <b className="text-sm text-neutral-100">{l.estaciones}</b> estaciones
                </span>
                <span>
                  <b className="text-sm text-neutral-100">{l.distancia_km}</b> km
                </span>
                <span>
                  <b className="text-sm text-neutral-100">{l.buses_asignados}</b> buses
                </span>
              </div>
              <div className="mt-1 text-xs text-neutral-500">{l.municipalidad}</div>
            </button>
          ))}
          {lineas.loading && <Loading />}
        </div>

        {linea && (
          <div className="space-y-4">
            <Panel
              title={
                <span className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full" style={{ background: linea.color_hex }} />
                  {linea.nombre}
                </span>
              }
              right={
                <span className="flex items-center gap-2">
                  <Badge tone={linea.estado === "ACTIVA" ? "ok" : "warn"}>{linea.estado}</Badge>
                  {linea.estado !== "ACTIVA" && (
                    <Btn variant="primary" className="!py-1 text-xs" onClick={() => cambiarEstado("ACTIVA")}>
                      Activar línea
                    </Btn>
                  )}
                  {linea.estado === "ACTIVA" && (
                    <Btn className="!py-1 text-xs" onClick={() => cambiarEstado("SUSPENDIDA")}>
                      Suspender
                    </Btn>
                  )}
                </span>
              }
            >
              <div className="grid gap-4 md:grid-cols-[1fr_16rem]">
                <div>
                  <div className="mb-1 flex items-baseline justify-between text-sm">
                    <span className="font-semibold">Flota de la línea</span>
                    <span className="text-neutral-300">
                      <b className="text-lg text-neutral-100">{linea.buses_asignados}</b> buses · rango permitido {linea.buses_minimo} a {linea.buses_maximo}
                    </span>
                  </div>
                  <FleetMeter buses={linea.buses_asignados} min={linea.buses_minimo} max={linea.buses_maximo} />
                  <p className="mt-2 text-xs text-neutral-400">
                    Regla 5: cada línea necesita como mínimo tantos buses como estaciones ({linea.estaciones}) y como máximo el doble ({linea.buses_maximo}).
                    La base de datos revisa esta regla al confirmar cada cambio.
                  </p>
                </div>
                <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-sm">
                  <div className="text-xs text-neutral-400">Municipalidad</div>
                  <div className="font-semibold">{linea.municipalidad}</div>
                  <div className="mt-2 text-xs text-neutral-400">Distancia de la línea</div>
                  <div className="text-xl font-semibold tabular-nums">{linea.distancia_km} km</div>
                </div>
              </div>
            </Panel>

            <div className="grid gap-4 2xl:grid-cols-[22rem_1fr]">
              <Panel title="Recorrido y estaciones">
                {estaciones.loading ? (
                  <Loading />
                ) : (
                  <ol className="relative ml-2">
                    <span className="absolute bottom-3 left-[5px] top-3 w-0.5" style={{ background: linea.color_hex }} aria-hidden="true" />
                    {estaciones.rows.map((e) => (
                      <li key={e.orden} className="relative pb-3 pl-6 last:pb-0">
                        <span
                          className="absolute left-0 top-1.5 h-3 w-3 rounded-full border-2 bg-neutral-950"
                          style={{ borderColor: linea.color_hex }}
                          aria-hidden="true"
                        />
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-sm font-semibold">
                            {e.orden}. {e.estacion}
                          </span>
                          {e.es_terminal && <Badge tone="info">Terminal</Badge>}
                          {e.otras_lineas && e.otras_lineas.split(",").map((c) => (
                            <Badge key={c} tone="warn">
                              {c}
                            </Badge>
                          ))}
                        </div>
                        <div className="text-xs text-neutral-400">
                          {e.orden > 1 ? `+${e.km_desde_anterior} km · ` : ""}
                          {e.km_acumulado} km acumulados · {e.accesos} {e.accesos === 1 ? "acceso" : "accesos"} · {e.municipalidad}
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </Panel>

              <Panel
                title={`Buses asignados a ${linea.codigo}`}
                right={
                  <span className="flex items-center gap-2">
                    <select className={`${inputCls} !w-52 !py-1 text-xs`} value={busLibre} onChange={(e) => setBusLibre(e.target.value)} aria-label="Bus sin línea">
                      {libres.rows.length === 0 && <option value="">No hay buses libres</option>}
                      {libres.rows.map((b) => (
                        <option key={b.id_bus} value={b.id_bus}>
                          {b.numero_unidad} · {b.tipo.toLowerCase()} · {b.capacidad_pasajeros}
                        </option>
                      ))}
                    </select>
                    <Btn variant="primary" className="!py-1 text-xs" disabled={!busLibre} onClick={asignar}>
                      Asignar a la línea
                    </Btn>
                  </span>
                }
                flush
              >
                <div className="max-h-[32rem] overflow-auto">
                  <table className="w-full min-w-max text-left text-sm">
                    <thead className="sticky top-0 bg-neutral-950 text-xs text-neutral-400">
                      <tr>
                        <th className="px-3 py-2 font-medium">Unidad</th>
                        <th className="px-3 py-2 font-medium">Placa</th>
                        <th className="px-3 py-2 font-medium">Tipo</th>
                        <th className="px-3 py-2 text-right font-medium">Capacidad</th>
                        <th className="px-3 py-2 font-medium">Estado</th>
                        <th className="px-3 py-2 font-medium">Parqueo (puede cambiarse)</th>
                        <th className="px-3 py-2 font-medium" />
                      </tr>
                    </thead>
                    <tbody>
                      {buses.rows.map((b) => (
                        <tr key={b.id_bus} className="border-t border-neutral-800">
                          <td className="px-3 py-1.5 font-semibold">{b.numero_unidad}</td>
                          <td className="px-3 py-1.5 font-log text-xs text-neutral-300">{b.placa}</td>
                          <td className="px-3 py-1.5 text-neutral-300">{b.tipo.toLowerCase()}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{b.capacidad_pasajeros}</td>
                          <td className="px-3 py-1.5">
                            <Badge tone={b.estado === "OPERATIVO" ? "ok" : "warn"}>{b.estado.toLowerCase()}</Badge>
                          </td>
                          <td className="px-3 py-1.5">
                            <select
                              className={`${inputCls} !w-56 !py-1 text-xs`}
                              value={b.id_parqueo}
                              onChange={(e) => moverParqueo(b, e.target.value)}
                              aria-label={`Parqueo del bus ${b.numero_unidad}`}
                            >
                              {parqueos.rows.map((p) => (
                                <option key={p.id_parqueo} value={p.id_parqueo}>
                                  {p.nombre} ({p.usados}/{p.capacidad_buses})
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            <Btn className="!px-2 !py-1 text-xs" onClick={() => quitar(b)}>
                              Quitar
                            </Btn>
                          </td>
                        </tr>
                      ))}
                      {buses.rows.length === 0 && (
                        <tr>
                          <td colSpan={7} className="px-3 py-6 text-center text-neutral-500">
                            Esta línea todavía no tiene buses asignados.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
