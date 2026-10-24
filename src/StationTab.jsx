import { useEffect, useMemo, useState } from "react";
import { Panel, Btn, Badge, Notice, Field, inputCls, Loading, Stat } from "./ui";
import { useDb, useQuery } from "./db/useDb";
import { queryObjects } from "./db/db";

const SQL_ESTACIONES = `
SELECT e.id_estacion, e.codigo, e.nombre, m.nombre AS municipalidad, e.capacidad_anden, e.es_terminal
  FROM estacion e JOIN municipalidad m ON m.id_municipalidad = e.id_municipalidad
 ORDER BY e.nombre`;

const SQL_LINEAS = `
SELECT l.id_linea, l.codigo, l.color_hex, le.orden,
       (SELECT MIN(b.capacidad_pasajeros) FROM bus b WHERE b.id_linea = l.id_linea) AS cap_bus
  FROM linea_estacion le JOIN linea l USING (id_linea)
 WHERE le.id_estacion = $1
 ORDER BY l.codigo`;

const SQL_ACCESOS = `
SELECT a.id_acceso, a.numero, a.nombre, a.tipo,
       string_agg(g.nombres || ' ' || g.apellidos || ' (' || lower(ag.turno) || ')', '; ' ORDER BY ag.turno) AS guardias
  FROM acceso a
  LEFT JOIN asignacion_guardia ag ON ag.id_acceso = a.id_acceso AND ag.fecha_fin IS NULL
  LEFT JOIN guardia g ON g.id_guardia = ag.id_guardia
 WHERE a.id_estacion = $1
 GROUP BY a.id_acceso, a.numero, a.nombre, a.tipo
 ORDER BY a.numero`;

const SQL_PC = `
SELECT c.hostname, c.ip_vpn::text AS ip, c.estado,
       (SELECT string_agg(o.nombres || ' ' || o.apellidos || ' (' || lower(o.turno) || ')', '; ' ORDER BY o.turno)
          FROM operador o WHERE o.id_computadora = c.id_computadora AND o.activo) AS operadores,
       (SELECT string_agg(er.rol || ': ' || er.medio || ' ' || er.ancho_banda_mbps || ' Mbps', ' · ' ORDER BY er.rol)
          FROM enlace_red er WHERE er.id_estacion = c.id_estacion) AS enlaces
  FROM computadora c WHERE c.id_estacion = $1`;

const SQL_PARQUEOS = `
SELECT p.nombre, p.capacidad_buses, count(b.id_bus)::int AS usados
  FROM parqueo p LEFT JOIN bus b USING (id_parqueo)
 WHERE p.id_estacion = $1
 GROUP BY p.id_parqueo, p.nombre, p.capacidad_buses`;

const SQL_ALERTAS = `
SELECT a.id_alerta, a.fecha, a.id_linea, l.codigo AS linea, a.pasajeros_esperando, a.umbral, a.atendida, b.numero_unidad AS refuerzo
  FROM alerta a JOIN linea l USING (id_linea) LEFT JOIN bus b ON b.id_bus = a.id_bus_refuerzo
 WHERE a.id_estacion = $1
 ORDER BY a.atendida, a.fecha DESC, a.id_alerta DESC
 LIMIT 10`;

const SQL_REFUERZOS = `
SELECT b.id_bus, b.numero_unidad, b.id_linea
  FROM bus b
 WHERE b.estado = 'OPERATIVO'
   AND (b.id_linea IN (SELECT id_linea FROM linea_estacion WHERE id_estacion = $1) OR b.id_linea IS NULL)
 ORDER BY b.numero_unidad`;

const SQL_VISITAS = `
SELECT v.id_visita, v.hora_programada, l.codigo AS linea, b.numero_unidad AS bus, vj.sentido,
       b.capacidad_pasajeros AS cap, v.pasajeros_a_bordo, v.ocupacion_pct, v.espera_extra_min
  FROM visita v
  JOIN viaje vj ON vj.id_viaje = v.id_viaje
  JOIN bus b ON b.id_bus = vj.id_bus
  JOIN linea l ON l.id_linea = vj.id_linea
 WHERE v.id_estacion = $1
 ORDER BY v.hora_programada
 LIMIT 12`;

const SQL_TARJETAS = `
SELECT t.id_tarjeta, t.numero, tt.nombre AS tipo, tt.tarifa, t.saldo, t.estado
  FROM tarjeta_acceso t JOIN tipo_tarjeta tt USING (id_tipo_tarjeta)
 ORDER BY t.numero`;

const SQL_METODOS = `SELECT id_metodo_pago, nombre, usa_saldo_tarjeta, permite_recarga FROM metodo_pago ORDER BY id_metodo_pago`;

// Hora local de Guatemala, en el formato que guarda la base de datos
const ahoraGt = () => new Date().toLocaleString("sv-SE", { timeZone: "America/Guatemala" });

export default function StationTab({ log, initialEstacion }) {
  const { status, write } = useDb();
  const estaciones = useQuery(SQL_ESTACIONES);
  const [sel, setSel] = useState(null);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    if (sel || estaciones.rows.length === 0) return;
    const w = estaciones.rows.find((e) => e.nombre === initialEstacion) || estaciones.rows.find((e) => e.nombre === "El Trébol") || estaciones.rows[0];
    setSel(w.id_estacion);
  }, [estaciones.rows, sel, initialEstacion]);

  const est = estaciones.rows.find((e) => e.id_estacion === sel);
  const lineas = useQuery(SQL_LINEAS, [sel], sel != null);
  const accesos = useQuery(SQL_ACCESOS, [sel], sel != null);
  const pcs = useQuery(SQL_PC, [sel], sel != null);
  const parqueos = useQuery(SQL_PARQUEOS, [sel], sel != null);
  const alertas = useQuery(SQL_ALERTAS, [sel], sel != null);
  const refuerzos = useQuery(SQL_REFUERZOS, [sel], sel != null);
  const visitas = useQuery(SQL_VISITAS, [sel], sel != null);
  const tarjetas = useQuery(SQL_TARJETAS);
  const metodos = useQuery(SQL_METODOS);

  const [lineaSel, setLineaSel] = useState("");
  const [pasajeros, setPasajeros] = useState("");
  const [refuerzoSel, setRefuerzoSel] = useState({});
  const [visitaVal, setVisitaVal] = useState({});
  const [tarjeta, setTarjeta] = useState("");
  const [metodo, setMetodo] = useState("");
  const [monto, setMonto] = useState("10");

  useEffect(() => {
    if (lineas.rows.length && !lineas.rows.find((l) => String(l.id_linea) === lineaSel)) setLineaSel(String(lineas.rows[0].id_linea));
  }, [lineas.rows, lineaSel]);
  useEffect(() => {
    if (tarjetas.rows.length && !tarjeta) setTarjeta(String(tarjetas.rows.find((t) => t.estado === "ACTIVA")?.id_tarjeta ?? tarjetas.rows[0].id_tarjeta));
  }, [tarjetas.rows, tarjeta]);
  useEffect(() => {
    if (metodos.rows.length && !metodo) setMetodo(String(metodos.rows[0].id_metodo_pago));
  }, [metodos.rows, metodo]);

  const lineaActual = lineas.rows.find((l) => String(l.id_linea) === lineaSel);
  const umbral = lineaActual?.cap_bus ? Math.ceil((lineaActual.cap_bus * 150) / 100) : null;
  const numPas = Number(pasajeros);
  const pctUmbral = umbral && numPas ? Math.min(100, Math.round((numPas / umbral) * 100)) : 0;
  const tarj = tarjetas.rows.find((t) => String(t.id_tarjeta) === tarjeta);
  const met = metodos.rows.find((m) => String(m.id_metodo_pago) === metodo);

  if (status !== "ready") return <Loading text="Preparando la base de datos" />;

  const fail = (r, prefijo) => {
    setNotice({ kind: "error", text: `${prefijo}: ${r.error}` });
    log("BD", `${prefijo}: ${r.error}`, "warn");
  };

  const registrarLectura = async () => {
    if (!lineaActual || pasajeros === "" || numPas < 0) return;
    const r = await write("INSERT INTO lectura_estacion (id_estacion, id_linea, fecha, pasajeros_esperando) VALUES ($1,$2,$3,$4)", [
      sel, lineaActual.id_linea, ahoraGt(), numPas,
    ]);
    if (!r.ok) return fail(r, "No se pudo registrar la lectura");
    const a = await queryObjects("SELECT id_alerta, mensaje FROM alerta WHERE id_lectura = (SELECT max(id_lectura) FROM lectura_estacion)");
    if (a.length) {
      setNotice({ kind: "warn", text: `ALERTA ${a[0].id_alerta}: ${a[0].mensaje}` });
      log("R14", `ALERTA DE CAPACIDAD - ${est.nombre} - ${numPas} pasajeros esperando (umbral ${umbral})`, "alarm");
    } else {
      setNotice({ kind: "ok", text: `Lectura registrada: ${numPas} pasajeros esperando. Está por debajo del umbral de ${umbral}, no se genera alerta.` });
      log("R14", `Lectura ${est.nombre}: ${numPas} pasajeros esperando (umbral ${umbral})`, "info");
    }
  };

  const atender = async (a) => {
    const bus = refuerzoSel[a.id_alerta] || refuerzos.rows.find((b) => b.id_linea === a.id_linea || b.id_linea === null)?.id_bus;
    if (!bus) return setNotice({ kind: "error", text: "No hay un bus disponible para enviar como refuerzo." });
    const r = await write("SELECT fn_atender_alerta($1, $2)", [a.id_alerta, Number(bus)]);
    if (!r.ok) return fail(r, "No se pudo atender la alerta");
    setNotice({ kind: "ok", text: `Alerta ${a.id_alerta} atendida: se envió un bus de refuerzo a ${est.nombre}.` });
    log("R14", `Alerta ${a.id_alerta} atendida - bus de refuerzo en camino a ${est.nombre}`, "ok");
  };

  const guardarVisita = async (v) => {
    const val = visitaVal[v.id_visita];
    if (val === undefined || val === "") return;
    const r = await write("UPDATE visita SET pasajeros_a_bordo = $1 WHERE id_visita = $2", [Number(val), v.id_visita]);
    if (!r.ok) return fail(r, "No se pudo registrar a los pasajeros");
    const [row] = await queryObjects("SELECT ocupacion_pct, espera_extra_min FROM visita WHERE id_visita = $1", [v.id_visita]);
    const total = 1 + row.espera_extra_min;
    setNotice({
      kind: row.espera_extra_min > 0 ? "warn" : "ok",
      text: `Bus ${v.bus} con ${val} de ${v.cap} pasajeros (${row.ocupacion_pct} %). ${
        row.espera_extra_min > 0 ? `Va con menos del 25 %: espera ${row.espera_extra_min} minutos más (${total} minutos en total).` : "Supera el 25 %: sale en el tiempo normal."
      }`,
    });
    log("R15", `Visita ${v.bus} en ${est.nombre}: ${row.ocupacion_pct} % de ocupación, espera extra ${row.espera_extra_min} min`, row.espera_extra_min ? "warn" : "ok");
  };

  const pagar = async (tipo) => {
    if (!tarj || !met) return;
    const r = await write("INSERT INTO pago (id_tarjeta, id_metodo_pago, id_estacion, tipo, monto, fecha) VALUES ($1,$2,$3,$4,$5,$6)", [
      tipo === "COBRO_PASAJE" && !met.usa_saldo_tarjeta ? null : Number(tarjeta), Number(metodo), sel, tipo, tipo === "COBRO_PASAJE" ? tarj.tarifa : Number(monto), ahoraGt(),
    ]);
    if (!r.ok) return fail(r, "Pago rechazado");
    const [t] = await queryObjects("SELECT saldo FROM tarjeta_acceso WHERE id_tarjeta = $1", [Number(tarjeta)]);
    const msg = tipo === "RECARGA" ? `Recarga de Q${Number(monto).toFixed(2)} acreditada. Saldo de la tarjeta ${tarj.numero}: Q${t.saldo}.` : `Pasaje cobrado (${tarj.tipo}, Q${tarj.tarifa}). Saldo restante: Q${t.saldo}.`;
    setNotice({ kind: "ok", text: msg });
    log("R16", `${tipo === "RECARGA" ? "Recarga" : "Cobro"} - ${met.nombre} - tarjeta ${tarj.numero} - ${est.nombre}`, "ok");
  };

  const pc = pcs.rows[0];
  return (
    <div className="space-y-4">
      <Panel title="Estación de trabajo del operador" right={<span className="text-xs text-neutral-400">Regla 16: una PC por estación</span>}>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Estación" className="w-72">
            <select className={inputCls} value={sel ?? ""} onChange={(e) => { setSel(Number(e.target.value)); setNotice(null); }}>
              {estaciones.rows.map((e) => (
                <option key={e.id_estacion} value={e.id_estacion}>
                  {e.codigo} · {e.nombre}
                </option>
              ))}
            </select>
          </Field>
          {est && (
            <div className="flex flex-wrap items-center gap-2 pb-2 text-sm text-neutral-300">
              <span>{est.municipalidad}</span>
              {est.es_terminal && <Badge tone="info">Terminal</Badge>}
              {lineas.rows.map((l) => (
                <span key={l.id_linea} className="inline-flex items-center gap-1.5 rounded-md border border-neutral-700 px-1.5 py-0.5 text-xs font-semibold">
                  <span className="h-2 w-2 rounded-full" style={{ background: l.color_hex }} />
                  {l.codigo}
                </span>
              ))}
            </div>
          )}
        </div>
        {pc && (
          <div className="mt-3 grid gap-2 text-sm md:grid-cols-4">
            <div className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2">
              <div className="text-xs text-neutral-400">Computadora</div>
              <div className="font-log">{pc.hostname}</div>
              <div className="font-log text-xs text-neutral-400">{pc.ip}</div>
            </div>
            <div className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2">
              <div className="text-xs text-neutral-400">Estado</div>
              <Badge tone={pc.estado === "EN_LINEA" ? "ok" : "danger"}>{pc.estado === "EN_LINEA" ? "En línea" : pc.estado}</Badge>
            </div>
            <div className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 md:col-span-2">
              <div className="text-xs text-neutral-400">Operadores con control de la PC</div>
              <div>{pc.operadores || "Sin operador asignado"}</div>
            </div>
            <div className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 md:col-span-4">
              <div className="text-xs text-neutral-400">Enlaces de comunicación hacia el centro de control (VPN)</div>
              <div>{pc.enlaces}</div>
            </div>
          </div>
        )}
      </Panel>

      {notice && (
        <Notice kind={notice.kind} onClose={() => setNotice(null)}>
          {notice.text}
        </Notice>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Pasajeros esperando (regla 14)">
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <Field label="Línea">
              <select className={inputCls} value={lineaSel} onChange={(e) => setLineaSel(e.target.value)}>
                {lineas.rows.map((l) => (
                  <option key={l.id_linea} value={l.id_linea}>
                    {l.codigo} (bus de {l.cap_bus ?? "—"} pasajeros)
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Pasajeros en el andén">
              <input className={inputCls} type="number" min="0" value={pasajeros} onChange={(e) => setPasajeros(e.target.value)} placeholder="Ejemplo: 250" />
            </Field>
            <Btn variant="primary" onClick={registrarLectura} disabled={pasajeros === "" || !lineaActual}>
              Registrar lectura
            </Btn>
          </div>
          {umbral && (
            <div className="mt-3">
              <div className="mb-1 flex justify-between text-xs text-neutral-400">
                <span>0</span>
                <span>Umbral de alerta: {umbral} pasajeros (150 % de la capacidad del bus)</span>
              </div>
              <div className="h-3 rounded-full bg-neutral-800">
                <div className={`h-3 rounded-full ${pctUmbral >= 100 ? "bg-red-500" : pctUmbral >= 70 ? "bg-amber-400" : "bg-brand-500"}`} style={{ width: `${pctUmbral}%` }} />
              </div>
            </div>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            {umbral &&
              [["Poca gente", Math.round(umbral * 0.3)], ["Casi al umbral", umbral - 1], ["Justo en el umbral", umbral], ["Hora pico", Math.round(umbral * 1.4)]].map(([lbl, n]) => (
                <button key={lbl} onClick={() => setPasajeros(String(n))} className="rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800">
                  {lbl} ({n})
                </button>
              ))}
          </div>

          <h3 className="mb-2 mt-5 text-sm font-semibold">Alertas de esta estación</h3>
          {alertas.rows.length === 0 ? (
            <p className="text-sm text-neutral-500">No hay alertas en esta estación.</p>
          ) : (
            <ul className="space-y-2">
              {alertas.rows.map((a) => (
                <li key={a.id_alerta} className={`rounded-lg border px-3 py-2 text-sm ${a.atendida ? "border-neutral-800 bg-neutral-950" : "border-red-700 bg-red-950"}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">
                      Alerta {a.id_alerta} · {a.linea}
                    </span>
                    <span className="text-xs text-neutral-300">
                      {a.pasajeros_esperando} esperando (umbral {a.umbral})
                    </span>
                    {a.atendida ? (
                      <Badge tone="ok">Atendida con el bus {a.refuerzo}</Badge>
                    ) : (
                      <span className="flex items-center gap-2">
                        <select
                          className={`${inputCls} !w-32 !py-1 text-xs`}
                          value={refuerzoSel[a.id_alerta] ?? refuerzos.rows.find((b) => b.id_linea === a.id_linea || b.id_linea === null)?.id_bus ?? ""}
                          onChange={(e) => setRefuerzoSel({ ...refuerzoSel, [a.id_alerta]: e.target.value })}
                          aria-label="Bus de refuerzo"
                        >
                          {refuerzos.rows
                            .filter((b) => b.id_linea === a.id_linea || b.id_linea === null)
                            .map((b) => (
                              <option key={b.id_bus} value={b.id_bus}>
                                {b.numero_unidad}
                                {b.id_linea === null ? " (reserva)" : ""}
                              </option>
                            ))}
                        </select>
                        <Btn variant="danger" className="!px-2 !py-1 text-xs" onClick={() => atender(a)}>
                          Enviar bus
                        </Btn>
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Visitas de los buses a la estación (regla 15)">
          <p className="mb-2 text-xs text-neutral-400">
            Si un bus llega con menos del 25 % de su capacidad, espera 5 minutos más en la estación. Registra los pasajeros a bordo y la base de datos calcula la espera.
          </p>
          <div className="overflow-x-auto rounded-lg border border-neutral-800">
            <table className="w-full min-w-max text-left text-sm">
              <thead className="bg-neutral-950 text-xs text-neutral-400">
                <tr>
                  <th className="px-3 py-2 font-medium">Hora</th>
                  <th className="px-3 py-2 font-medium">Línea</th>
                  <th className="px-3 py-2 font-medium">Bus</th>
                  <th className="px-3 py-2 text-right font-medium">A bordo</th>
                  <th className="px-3 py-2 text-right font-medium">Ocupación</th>
                  <th className="px-3 py-2 font-medium">Espera</th>
                  <th className="px-3 py-2 font-medium">Registrar</th>
                </tr>
              </thead>
              <tbody>
                {visitas.rows.map((v) => (
                  <tr key={v.id_visita} className="border-t border-neutral-800">
                    <td className="px-3 py-1.5 tabular-nums">{String(v.hora_programada).slice(11, 16)}</td>
                    <td className="px-3 py-1.5">
                      {v.linea} <span className="text-xs text-neutral-500">{v.sentido === "IDA" ? "ida" : "vuelta"}</span>
                    </td>
                    <td className="px-3 py-1.5">{v.bus}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{v.pasajeros_a_bordo ?? "—"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{v.ocupacion_pct === null ? "—" : `${v.ocupacion_pct} %`}</td>
                    <td className="px-3 py-1.5">
                      {v.pasajeros_a_bordo === null ? <span className="text-neutral-500">Pendiente</span> : v.espera_extra_min > 0 ? <Badge tone="warn">+{v.espera_extra_min} min</Badge> : <Badge tone="ok">Normal</Badge>}
                    </td>
                    <td className="px-3 py-1.5">
                      <span className="flex items-center gap-1">
                        <input
                          type="number"
                          min="0"
                          max={v.cap}
                          className={`${inputCls} !w-20 !py-1 text-xs`}
                          placeholder={`0-${v.cap}`}
                          value={visitaVal[v.id_visita] ?? ""}
                          onChange={(e) => setVisitaVal({ ...visitaVal, [v.id_visita]: e.target.value })}
                          aria-label={`Pasajeros a bordo del bus ${v.bus}`}
                        />
                        <Btn className="!px-2 !py-1 text-xs" onClick={() => guardarVisita(v)}>
                          Guardar
                        </Btn>
                      </span>
                    </td>
                  </tr>
                ))}
                {visitas.rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-neutral-500">
                      No hay visitas programadas en esta estación.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Accesos y guardias de seguridad (regla 10)">
          <ul className="space-y-2">
            {accesos.rows.map((a) => (
              <li key={a.id_acceso} className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">
                    Acceso {a.numero} · {a.nombre}
                  </span>
                  <Badge tone={a.tipo === "ACCESIBLE" ? "info" : "neutral"}>{a.tipo.toLowerCase()}</Badge>
                </div>
                <div className="text-xs text-neutral-400">{a.guardias || "SIN GUARDIA ASIGNADO"}</div>
              </li>
            ))}
          </ul>
          {parqueos.rows.length > 0 && (
            <div className="mt-3 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm">
              <div className="text-xs text-neutral-400">Parqueo de la estación</div>
              {parqueos.rows.map((p) => (
                <div key={p.nombre}>
                  {p.nombre}: {p.usados} de {p.capacidad_buses} espacios ocupados
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Caja: tarjeta de acceso y métodos de pago (regla 18)">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Tarjeta de acceso">
              <select className={inputCls} value={tarjeta} onChange={(e) => setTarjeta(e.target.value)}>
                {tarjetas.rows.map((t) => (
                  <option key={t.id_tarjeta} value={t.id_tarjeta}>
                    {t.numero} · {t.tipo} · Q{t.saldo}
                    {t.estado !== "ACTIVA" ? ` · ${t.estado}` : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Método de pago">
              <select className={inputCls} value={metodo} onChange={(e) => setMetodo(e.target.value)}>
                {metodos.rows.map((m) => (
                  <option key={m.id_metodo_pago} value={m.id_metodo_pago}>
                    {m.nombre}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {tarj && (
            <div className="mt-3 grid grid-cols-3 gap-2">
              <Stat label="Saldo" value={`Q${tarj.saldo}`} />
              <Stat label="Tarifa del perfil" value={`Q${tarj.tarifa}`} />
              <Stat label="Estado" value={tarj.estado.toLowerCase()} tone={tarj.estado === "ACTIVA" ? "text-brand-400" : "text-red-400"} />
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <Field label="Monto de la recarga (Q)" className="w-40">
              <input className={inputCls} type="number" min="1" value={monto} onChange={(e) => setMonto(e.target.value)} />
            </Field>
            <Btn variant="primary" onClick={() => pagar("RECARGA")}>
              Recargar tarjeta
            </Btn>
            <Btn onClick={() => pagar("COBRO_PASAJE")}>Cobrar pasaje</Btn>
          </div>
          <p className="mt-2 text-xs text-neutral-400">
            La recarga solo se acepta con efectivo, tarjeta bancaria, billetera móvil o transferencia. El cobro con tarjeta de acceso descuenta la tarifa del perfil y rechaza el pago si el saldo no alcanza.
          </p>
        </Panel>
      </div>
    </div>
  );
}
