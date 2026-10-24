// Genera database/05_seed.sql con datos ficticios y reproducibles (semilla fija).
// Uso: node database/generar_seed.mjs
// Los nombres, DPI, teléfonos y correos son inventados. Los nombres de estaciones son referenciales
// y las distancias son ilustrativas; no corresponden a mediciones reales del Transmetro.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "05_seed.sql");

// ---------- utilidades ----------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261023);
const ri = (a, b) => Math.floor(rnd() * (b - a + 1)) + a;
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const chance = (p) => rnd() < p;
const q = (s) => (s === null || s === undefined ? "NULL" : `'${String(s).replace(/'/g, "''")}'`);
const n2 = (x) => Number(x).toFixed(2);
const pad = (n, l = 3) => String(n).padStart(l, "0");
const strip = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");

const out = [];
const emit = (s) => out.push(s);
function insert(table, cols, rows) {
  if (!rows.length) return;
  const CH = 200;
  for (let i = 0; i < rows.length; i += CH) {
    const part = rows.slice(i, i + CH);
    emit(`INSERT INTO ${table} (${cols.join(", ")}) VALUES\n  ${part.map((r) => "(" + r.join(", ") + ")").join(",\n  ")};`);
  }
}

// ---------- datos maestros ----------
const MUNIS = [
  ["Guatemala", "Guatemala", "21 calle 6-77, zona 1", "2285-8000"],
  ["Mixco", "Guatemala", "Plaza Central, Mixco", "2430-3000"],
  ["Villa Nueva", "Guatemala", "Plaza Central, Villa Nueva", "6628-3000"],
  ["Santa Catarina Pinula", "Guatemala", "Plaza Central, Santa Catarina Pinula", "6629-6000"],
  ["San Miguel Petapa", "Guatemala", "Plaza Central, San Miguel Petapa", "6628-1000"],
  ["Villa Canales", "Guatemala", "Plaza Central, Villa Canales", "6629-4000"],
  ["Chinautla", "Guatemala", "Plaza Central, Chinautla", "6628-2000"],
  ["Amatitlán", "Guatemala", "Plaza Central, Amatitlán", "6629-1000"],
];

const LINEAS = [
  { cod: "L12", nombre: "Línea 12 · Centra Sur – Centra Norte (corredor piloto)", color: "#1F8A4C", muni: 1, hi: "05:00", hf: "21:30" },
  { cod: "L6", nombre: "Línea 6 · Terminal Mixco – El Trébol", color: "#2563EB", muni: 2, hi: "05:00", hf: "21:00" },
  { cod: "L13", nombre: "Línea 13 · Terminal Villa Nueva – El Trébol", color: "#D97706", muni: 3, hi: "05:30", hf: "20:30" },
  { cod: "L18", nombre: "Línea 18 · Terminal Santa Catarina – Plaza Barrios", color: "#9333EA", muni: 4, hi: "05:30", hf: "20:30" },
  { cod: "L20", nombre: "Línea 20 · Terminal Chinautla – Centra Norte (en planificación)", color: "#DC2626", muni: 7, hi: "06:00", hf: "20:00" },
];

// Estaciones: clave -> [nombre, municipalidad, tipo]  (tipo: T terminal, I intercambio, N normal)
const EST = {
  CS: ["Centra Sur", 1, "T"], AB: ["Aguilar Batres", 1, "N"], HI: ["Hincapié", 1, "N"], CU: ["Ciudad Universitaria", 1, "N"],
  TR: ["El Trébol", 1, "I"], RO: ["Roosevelt", 1, "I"], RE: ["Reformador", 1, "N"], PB: ["Plaza Barrios", 1, "I"],
  PC: ["Parque Central", 1, "N"], PI: ["Plaza Italia", 1, "N"], CG: ["Cuatro Grados", 1, "N"], BE: ["Bethania", 1, "N"],
  AT: ["Atanasio Tzul", 1, "N"], CSJ: ["Calzada San Juan", 1, "N"], CN: ["Centra Norte", 1, "T"],
  TM: ["Terminal Mixco", 2, "T"], MC: ["Mixco Centro", 2, "N"], LO: ["Lourdes", 2, "N"], SC: ["San Cristóbal", 2, "N"],
  MM: ["Monte María", 2, "N"], LA: ["Los Arcos", 1, "N"],
  TV: ["Terminal Villa Nueva", 3, "T"], BA: ["Bárcenas", 3, "N"], CR: ["Ciudad Real", 3, "N"], VH: ["Villa Hermosa", 3, "N"], PE: ["San Miguel Petapa", 5, "N"],
  TS: ["Terminal Santa Catarina", 4, "T"], DJ: ["Don Justo", 4, "N"], OA: ["Oakland", 1, "N"], AM: ["Las Américas", 1, "N"], SA: ["Zona 1 Sexta Avenida", 1, "N"],
  TC: ["Terminal Chinautla", 7, "T"], FL: ["Las Flores", 7, "N"], LV: ["Lavarreda", 7, "N"], PA: ["Paraíso", 1, "N"],
};
// Orden de estaciones por línea (la misma estación puede aparecer en varias líneas)
const ORDEN = {
  L12: ["CS", "AB", "HI", "CU", "TR", "RO", "RE", "PB", "PC", "PI", "CG", "BE", "AT", "CSJ", "CN"],
  L6: ["TM", "MC", "LO", "SC", "MM", "LA", "RO", "TR"],
  L13: ["TV", "BA", "CR", "VH", "PE", "CS", "TR"],
  L18: ["TS", "DJ", "OA", "AM", "SA", "PB"],
  L20: ["TC", "FL", "LV", "PA", "CN"],
};
// Posición geográfica aproximada (solo ilustrativa)
const GEO = {
  L12: [[14.552, -90.533], [14.676, -90.514]],
};
const estKeys = Object.keys(EST);
const estId = Object.fromEntries(estKeys.map((k, i) => [k, i + 1]));
const lineaId = Object.fromEntries(LINEAS.map((l, i) => [l.cod, i + 1]));

// coordenadas
const coords = {};
{
  const L = ORDEN.L12;
  L.forEach((k, i) => {
    const t = i / (L.length - 1);
    coords[k] = [14.552 + (14.676 - 14.552) * t, -90.533 + (-90.514 + 90.533) * t + Math.sin(t * 9) * 0.004];
  });
  const branch = (cod, anchor, dLat, dLon) => {
    const L2 = ORDEN[cod];
    L2.forEach((k) => {
      if (coords[k]) return;
      const idx = L2.indexOf(k);
      const near = L2.findIndex((x) => coords[x] && x !== k);
      const ai = L2.findIndex((x) => x === anchor);
      const dist = Math.abs(idx - ai);
      const [alat, alon] = coords[anchor];
      coords[k] = [alat + dLat * dist + (rnd() - 0.5) * 0.004, alon + dLon * dist + (rnd() - 0.5) * 0.004];
    });
  };
  branch("L6", "RO", 0.003, -0.012);
  branch("L13", "CS", -0.014, -0.004);
  branch("L18", "PB", -0.012, 0.01);
  branch("L20", "CN", 0.012, 0.007);
}

// tramos (distancia entre estaciones contiguas): L12 suma exactamente 18.40 km
const tramos = new Map();
const key = (a, b) => (estId[a] < estId[b] ? `${estId[a]}-${estId[b]}` : `${estId[b]}-${estId[a]}`);
function setTramo(a, b, km) {
  const k = key(a, b);
  if (!tramos.has(k)) tramos.set(k, { a: Math.min(estId[a], estId[b]), b: Math.max(estId[a], estId[b]), km });
}
{
  const L = ORDEN.L12;
  const w = L.slice(1).map(() => 0.6 + rnd());
  const sum = w.reduce((x, y) => x + y, 0);
  let acc = 0;
  const km = w.map((x) => Math.round((x / sum) * 18.4 * 100) / 100);
  km[km.length - 1] = Math.round((18.4 - km.slice(0, -1).reduce((x, y) => x + y, 0)) * 100) / 100;
  L.slice(1).forEach((k, i) => setTramo(L[i], k, km[i]));
  for (const cod of ["L6", "L13", "L18", "L20"]) {
    const Lx = ORDEN[cod];
    Lx.slice(1).forEach((k, i) => setTramo(Lx[i], k, Math.round((0.8 + rnd() * 1.9) * 100) / 100));
  }
}

// ---------- parqueos ----------
const PARQ = [
  { cod: "PQ-CS", nombre: "Patio Centra Sur", cap: 50, est: "CS", dir: "Km 8.5 Calzada Aguilar Batres, zona 12" },
  { cod: "PQ-CN", nombre: "Patio Centra Norte", cap: 40, est: "CN", dir: "Calzada Atanasio Tzul, zona 18" },
  { cod: "PQ-MX", nombre: "Parqueo Terminal Mixco", cap: 20, est: "TM", dir: "Terminal de Mixco" },
  { cod: "PQ-VN", nombre: "Parqueo Terminal Villa Nueva", cap: 20, est: "TV", dir: "Terminal de Villa Nueva" },
  { cod: "PQ-SC", nombre: "Parqueo Terminal Santa Catarina", cap: 12, est: "TS", dir: "Terminal de Santa Catarina Pinula" },
  { cod: "PQ-CH", nombre: "Parqueo Terminal Chinautla", cap: 8, est: "TC", dir: "Terminal de Chinautla" },
  { cod: "PQ-TL", nombre: "Taller y parqueo central", cap: 30, est: null, dir: "Zona 12, taller municipal" },
];
const parqId = Object.fromEntries(PARQ.map((p, i) => [p.cod, i + 1]));

// ---------- buses ----------
// [línea, cantidad, tipo, capacidad, distribución de parqueos]
const FLOTA = [
  ["L12", 27, "ARTICULADO", 160, [["PQ-CS", 14], ["PQ-CN", 13]]],
  ["L6", 12, "CONVENCIONAL", 80, [["PQ-MX", 12]]],
  ["L13", 9, "CONVENCIONAL", 80, [["PQ-VN", 9]]],
  ["L18", 7, "CONVENCIONAL", 80, [["PQ-SC", 7]]],
  ["L20", 3, "CONVENCIONAL", 80, [["PQ-CH", 3]]],
  [null, 13, "ARTICULADO", 160, [["PQ-CS", 8], ["PQ-TL", 5]]], // reserva del corredor piloto: 27 + 13 = 40 buses
];
const buses = []; // {id, num, linea, cap, tipo, parq, estado}
const platesUsed = new Set();
function plate() {
  for (;;) {
    const p = `C-${ri(100, 999)}${String.fromCharCode(65 + ri(0, 25))}${String.fromCharCode(65 + ri(0, 25))}${String.fromCharCode(65 + ri(0, 25))}`;
    if (!platesUsed.has(p)) { platesUsed.add(p); return p; }
  }
}
for (const [lin, cant, tipo, cap, dist] of FLOTA) {
  const slots = dist.flatMap(([p, n]) => Array(n).fill(p));
  for (let i = 0; i < cant; i++) {
    const id = buses.length + 1;
    buses.push({
      id, num: `TM-${pad(id)}`, placa: plate(), tipo, cap, anio: ri(2019, 2025), linea: lin, parq: slots[i],
      estado: lin === null && i % 3 === 2 ? "MANTENIMIENTO" : "OPERATIVO",
    });
  }
}

// ---------- personas ----------
const NOMBRES = ["José", "Carlos", "Luis", "Juan", "Miguel", "Pedro", "Marvin", "Edwin", "Oscar", "Byron", "Selvin", "Walter", "Erick", "Hugo", "Mynor", "Rudy", "Ángel", "Brayan", "Kevin", "Jorge", "Mario", "Víctor", "Ricardo", "Fredy", "Otto", "Alex", "Elmer", "Cristian", "Wilmer", "Josué", "María", "Ana", "Sandra", "Karla", "Lucía", "Gloria", "Rosa", "Silvia", "Patricia", "Mayra"];
const APELLIDOS = ["López", "García", "Pérez", "Hernández", "Morales", "Ramírez", "Castillo", "Méndez", "Gómez", "Cifuentes", "Barrios", "Xicay", "Tzoc", "Ajú", "Chávez", "Orellana", "Archila", "Velásquez", "Ordóñez", "Sandoval", "Reyes", "Cruz", "Estrada", "Juárez", "Ixcoy", "Coc", "Ac", "Girón", "Pineda", "Monzón", "Aguilar", "Rivera", "Cabrera", "Gonzalez", "Tun", "Samayoa"];
const usedDpi = new Set();
const dpi = () => { for (;;) { let s = String(ri(1, 9)); for (let i = 0; i < 12; i++) s += ri(0, 9); if (!usedDpi.has(s)) { usedDpi.add(s); return s; } } };
const movil = () => `${pick(["3", "4", "5"])}${ri(100, 999)}-${ri(1000, 9999)}`;
const fijo = () => `${pick(["2", "6"])}${ri(200, 499)}-${ri(1000, 9999)}`;
const persona = () => ({ n: `${pick(NOMBRES)} ${pick(NOMBRES.slice(0, 30))}`, a: `${pick(APELLIDOS)} ${pick(APELLIDOS)}` });
const fecha = (y0, y1) => `${ri(y0, y1)}-${pad(ri(1, 12), 2)}-${pad(ri(1, 28), 2)}`;

// ---------- INICIO DEL SCRIPT ----------
emit("-- =====================================================================");
emit("-- Archivo 05: datos de demostración (generado por generar_seed.mjs, semilla fija)");
emit("-- Datos ficticios: nombres, DPI, teléfonos y correos son inventados.");
emit("-- =====================================================================");
emit("SET search_path TO transmetro, public;");
emit("BEGIN;");

insert("parametro_sistema", ["clave", "valor", "descripcion"], [
  ["FLOTA_MIN_POR_ESTACION", 1, "Buses mínimos por estación de la línea (regla 5)"],
  ["FLOTA_MAX_POR_ESTACION", 2, "Buses máximos por estación de la línea (regla 5)"],
  ["ALERTA_AFORO_PCT", 150, "Alerta si esperan este % de la capacidad de un bus (regla 14)"],
  ["OCUPACION_MIN_PCT", 25, "Ocupación mínima del bus para no esperar más (regla 15)"],
  ["ESPERA_EXTRA_MIN", 5, "Minutos adicionales de espera si el bus va casi vacío (regla 15)"],
  ["ESPERA_BASE_MIN", 1, "Minutos normales de parada en una estación"],
  ["VELOCIDAD_PROMEDIO_KMH", 24, "Velocidad comercial promedio para estimar horas de llegada"],
].map(([c, v, d]) => [q(c), v, q(d)]));

insert("tipo_tarjeta", ["nombre", "tarifa"], [["Regular", 1.0], ["Estudiante", 0.5], ["Adulto mayor", 0.25], ["Persona con discapacidad", 0.0]].map(([a, b]) => [q(a), n2(b)]));
insert("metodo_pago", ["nombre", "usa_saldo_tarjeta", "permite_recarga"], [
  ["Efectivo en taquilla", false, true],
  ["Tarjeta de acceso (saldo prepagado)", true, false],
  ["Tarjeta de débito o crédito", false, true],
  ["Billetera móvil", false, true],
  ["Transferencia bancaria", false, true],
].map(([a, b, c]) => [q(a), b ? "TRUE" : "FALSE", c ? "TRUE" : "FALSE"]));

insert("municipalidad", ["nombre", "departamento", "direccion", "telefono"], MUNIS.map((m) => m.map(q)));
insert("linea", ["codigo", "nombre", "color_hex", "id_municipalidad", "estado", "hora_inicio", "hora_fin"],
  LINEAS.map((l) => [q(l.cod), q(l.nombre), q(l.color), l.muni, q("PLANIFICADA"), q(l.hi), q(l.hf)]));

insert("estacion", ["codigo", "nombre", "direccion", "id_municipalidad", "latitud", "longitud", "capacidad_anden", "es_terminal"],
  estKeys.map((k) => {
    const [nombre, muni, tipo] = EST[k];
    const [lat, lon] = coords[k];
    const cap = tipo === "T" ? 600 : tipo === "I" ? 450 : 250;
    return [q(`E-${pad(estId[k])}`), q(nombre), q(`Estación ${nombre}, ${MUNIS[muni - 1][0]}`), muni, lat.toFixed(6), lon.toFixed(6), cap, tipo === "T" ? "TRUE" : "FALSE"];
  }));

const leRows = [];
for (const l of LINEAS) ORDEN[l.cod].forEach((k, i) => leRows.push([lineaId[l.cod], estId[k], i + 1]));
insert("linea_estacion", ["id_linea", "id_estacion", "orden"], leRows);
insert("tramo", ["id_estacion_a", "id_estacion_b", "distancia_km"], [...tramos.values()].sort((x, y) => x.a - y.a || x.b - y.b).map((t) => [t.a, t.b, n2(t.km)]));

// accesos
const accesos = []; // {id, est, num}
const CARD = ["Norte", "Sur", "Oriente", "Poniente"];
for (const k of estKeys) {
  const tipo = EST[k][2];
  const n = tipo === "T" ? 4 : tipo === "I" ? 3 : chance(0.45) ? 2 : 1;
  for (let i = 1; i <= n; i++) {
    accesos.push({ id: accesos.length + 1, est: k, num: i, nombre: `Acceso ${CARD[(i - 1) % 4]}`, tipo: i === n && n >= 2 ? "ACCESIBLE" : i <= 2 ? "PRINCIPAL" : "SECUNDARIO" });
  }
}
insert("acceso", ["id_estacion", "numero", "nombre", "tipo"], accesos.map((a) => [estId[a.est], a.num, q(a.nombre), q(a.tipo)]));

insert("parqueo", ["codigo", "nombre", "capacidad_buses", "id_estacion", "direccion"],
  PARQ.map((p) => [q(p.cod), q(p.nombre), p.cap, p.est ? estId[p.est] : "NULL", q(p.dir)]));

// guardias: al menos uno por acceso (dos en terminales y accesos principales de intercambios)
const TURNOS = ["MATUTINO", "VESPERTINO", "NOCTURNO"];
const guardias = [];
const asigG = [];
for (const a of accesos) {
  const tipo = EST[a.est][2];
  const cant = tipo === "T" ? 2 : tipo === "I" && a.tipo === "PRINCIPAL" ? 2 : 1;
  for (let i = 0; i < cant; i++) {
    const p = persona();
    const g = { id: guardias.length + 1, ...p, dpi: dpi(), tel: movil(), alta: fecha(2018, 2025) };
    guardias.push(g);
    asigG.push([g.id, a.id, q(TURNOS[i % 3]), q(fecha(2024, 2026)), "NULL"]);
  }
}
for (let i = 0; i < 6; i++) { // guardias disponibles sin acceso asignado (reserva)
  const p = persona();
  guardias.push({ id: guardias.length + 1, ...p, dpi: dpi(), tel: movil(), alta: fecha(2025, 2026) });
}
insert("guardia", ["dpi", "nombres", "apellidos", "telefono", "fecha_contratacion"], guardias.map((g) => [q(g.dpi), q(g.n), q(g.a), q(g.tel), q(g.alta)]));
insert("asignacion_guardia", ["id_guardia", "id_acceso", "turno", "fecha_inicio", "fecha_fin"], asigG);

// buses
insert("bus", ["numero_unidad", "placa", "tipo", "capacidad_pasajeros", "anio", "estado", "id_linea", "id_parqueo"],
  buses.map((b) => [q(b.num), q(b.placa), q(b.tipo), b.cap, b.anio, q(b.estado), b.linea ? lineaId[b.linea] : "NULL", parqId[b.parq]]));

// cambio de parqueo de ejemplo (regla 7): un bus de reserva pasa del patio al taller
const reservaCS = buses.find((b) => b.linea === null && b.parq === "PQ-CS");
emit(`UPDATE bus SET id_parqueo = ${parqId["PQ-TL"]} WHERE id_bus = ${reservaCS.id};`);
reservaCS.parq = "PQ-TL";

// pilotos
const BARRIOS = ["Colonia Villa Linda", "Colonia El Milagro", "Colonia Primero de Julio", "Colonia La Brigada", "Residenciales Los Álamos", "Colonia Lomas de Portugal", "Aldea El Carmen", "Colonia Nueva Montserrat", "Colonia Bethania", "Colonia San José"];
const ESCUELAS = ["Escuela Oficial Urbana Mixta No. ", "Escuela Nacional de Varones No. "];
const DIVERS = [["Bachiller en Ciencias y Letras", "Instituto Nacional Diversificado"], ["Perito Contador", "Instituto por Cooperativa"], ["Bachiller en Computación", "Colegio Privado Mixto"], ["Magisterio de Educación Primaria", "Escuela Normal"], ["Perito en Mecánica Automotriz", "Instituto Técnico Vocacional"]];
const pilotos = [];
const estudios = [];
const NPIL = 90;
for (let i = 0; i < NPIL; i++) {
  const p = persona();
  const nacim = fecha(1970, 2003);
  const muni = pick([1, 1, 1, 2, 2, 3, 3, 4, 5, 6, 7, 8]);
  const pil = {
    id: i + 1, ...p, dpi: dpi(), nacim,
    lic: `L-${ri(100000, 999999)}${i}`.slice(0, 15), ltipo: pick(["A", "A", "B", "C"]),
    alta: fecha(2012, 2026),
    dir: `${ri(1, 20)}a avenida ${ri(1, 40)}-${ri(1, 99)}, ${pick(BARRIOS)}`, zona: ri(1, 18), muni,
    movil: movil(), fijo: chance(0.6) ? fijo() : null,
  };
  const em = persona();
  pil.em = `${em.n.split(" ")[0]} ${em.a.split(" ")[0]}`; pil.emtel = movil();
  pil.correo = `${strip(p.n.split(" ")[0])}.${strip(p.a.split(" ")[0])}${i + 1}@correo.example`;
  pilotos.push(pil);
  const y0 = Number(nacim.slice(0, 4)) + 7;
  estudios.push([pil.id, "PRIMARIA", "Primaria completa", `${pick(ESCUELAS)}${ri(1, 120)}`, y0, y0 + 6, true]);
  estudios.push([pil.id, "BASICO", "Ciclo básico", "Instituto Nacional de Educación Básica", y0 + 6, y0 + 9, true]);
  if (chance(0.85)) { const d = pick(DIVERS); estudios.push([pil.id, "DIVERSIFICADO", d[0], d[1], y0 + 9, y0 + 12, true]); }
  if (chance(0.25)) estudios.push([pil.id, "TECNICO", pick(["Técnico en Mecánica Diésel", "Técnico en Logística", "Técnico en Seguridad Vial"]), "Centro de Capacitación Técnica", y0 + 13, y0 + 14, true]);
  if (chance(0.08)) estudios.push([pil.id, "UNIVERSITARIO", "Técnico universitario en Administración", "Universidad Regional", y0 + 13, null, false]);
  if (chance(0.75)) estudios.push([pil.id, "CAPACITACION", "Curso de conducción defensiva y transporte masivo", "Centro de Capacitación del Transmetro", 2022 + ri(0, 3), null, true]);
}
insert("piloto", ["dpi", "nombres", "apellidos", "fecha_nacimiento", "licencia_numero", "licencia_tipo", "fecha_contratacion", "direccion_residencia", "zona", "id_municipalidad_residencia", "telefono_movil", "telefono_residencial", "correo", "contacto_emergencia_nombre", "contacto_emergencia_telefono"],
  pilotos.map((p) => [q(p.dpi), q(p.n), q(p.a), q(p.nacim), q(p.lic), q(p.ltipo), q(p.alta), q(p.dir), p.zona, p.muni, q(p.movil), q(p.fijo), q(p.correo), q(p.em), q(p.emtel)]));
insert("piloto_estudio", ["id_piloto", "nivel", "titulo", "institucion", "anio_inicio", "anio_fin", "concluido"],
  estudios.map(([id, nv, t, ins, a0, a1, c]) => [id, q(nv), q(t), q(ins), a0, a1 === null ? "NULL" : a1, c ? "TRUE" : "FALSE"]));

// asignación de pilotos a buses: matutino a cada bus con línea; vespertino en los buses de L12
const asigP = [];
let pi = 0;
const busesConLinea = buses.filter((b) => b.linea);
const pilotoMat = {};
for (const b of busesConLinea) { asigP.push([b.id, pilotos[pi].id, q("MATUTINO"), q("2026-01-12"), "NULL"]); pilotoMat[b.id] = pilotos[pi].id; pi++; }
for (const b of busesConLinea.filter((x) => x.linea === "L12")) { asigP.push([b.id, pilotos[pi].id, q("VESPERTINO"), q("2026-01-12"), "NULL"]); pi++; }
insert("asignacion_piloto_bus", ["id_bus", "id_piloto", "turno", "fecha_inicio", "fecha_fin"], asigP);

// computadoras, operadores y enlaces de red
const comps = estKeys.map((k) => [estId[k], q(`PC-EST-${pad(estId[k])}`), q(`10.20.${estId[k]}.10`)]);
insert("computadora", ["id_estacion", "hostname", "ip_vpn"], comps);
const ops = [];
for (const k of estKeys) {
  const tipo = EST[k][2];
  const turnos = tipo === "N" ? ["MATUTINO"] : ["MATUTINO", "VESPERTINO"];
  turnos.forEach((t) => {
    const p = persona();
    const user = `${strip(p.n.split(" ")[0])[0]}${strip(p.a.split(" ")[0])}${ops.length + 1}`;
    ops.push([q(dpi()), q(p.n), q(p.a), q(user), q(`${user}@transmetro.example`), q(movil()), q(t), estId[k]]);
  });
}
insert("operador", ["dpi", "nombres", "apellidos", "usuario", "correo", "telefono", "turno", "id_computadora"], ops);
const enl = [];
for (const k of estKeys) {
  const tipo = EST[k][2];
  const medio = tipo === "N" ? "BANDA_ANCHA" : "FIBRA";
  enl.push([estId[k], q("PRINCIPAL"), q(medio), q(medio === "FIBRA" ? "ISP fibra metropolitana" : "ISP banda ancha empresarial"), tipo === "N" ? 50 : 200, q("WIREGUARD")]);
  enl.push([estId[k], q("RESPALDO"), q("LTE"), q("Operador móvil LTE"), 40, q("WIREGUARD")]);
}
insert("enlace_red", ["id_estacion", "rol", "medio", "proveedor", "ancho_banda_mbps", "protocolo_vpn"], enl);

// tarjetas y pagos (los saldos los calcula el trigger al registrar recargas y cobros)
const NTARJ = 60;
const tarj = [];
const usedNum = new Set();
for (let i = 0; i < NTARJ; i++) {
  let num; do { num = String(ri(1000000000, 9999999999)); } while (usedNum.has(num)); usedNum.add(num);
  const tipo = chance(0.62) ? 1 : chance(0.5) ? 2 : chance(0.7) ? 3 : 4;
  tarj.push({ id: i + 1, num, tipo, saldo: 0, estado: i % 17 === 16 ? "BLOQUEADA" : "ACTIVA" });
}
insert("tarjeta_acceso", ["numero", "id_tipo_tarjeta", "saldo", "estado", "fecha_emision"], tarj.map((t) => [q(t.num), t.tipo, "0.00", q(t.estado), q(fecha(2025, 2026))]));
const TARIFA = { 1: 1.0, 2: 0.5, 3: 0.25, 4: 0.0 };
const pagos = [];
const ts = (d, h, m) => `2026-10-${pad(d, 2)} ${pad(h, 2)}:${pad(m, 2)}:00`;
for (const t of tarj.filter((x) => x.estado === "ACTIVA")) {
  const monto = pick([10, 20, 20, 50]);
  const metodo = pick([1, 1, 3, 4, 5]);
  pagos.push([t.id, metodo, ri(1, 35), q("RECARGA"), n2(monto), q(ts(ri(9, 14), ri(6, 18), ri(0, 59)))]);
  t.saldo += monto;
}
for (let d = 15; d <= 22; d++) {
  for (let i = 0; i < 80; i++) {
    const r = rnd();
    const est = ri(1, 35), hh = ri(5, 20), mm = ri(0, 59);
    if (r < 0.7) {
      const t = pick(tarj.filter((x) => x.estado === "ACTIVA"));
      if (t.saldo >= TARIFA[t.tipo]) { t.saldo -= TARIFA[t.tipo]; pagos.push([t.id, 2, est, q("COBRO_PASAJE"), n2(TARIFA[t.tipo]), q(ts(d, hh, mm))]); }
      else { const m = pick([10, 20]); pagos.push([t.id, pick([1, 3, 4]), est, q("RECARGA"), n2(m), q(ts(d, hh, mm))]); t.saldo += m; }
    } else if (r < 0.9) {
      pagos.push(["NULL", 1, est, q("COBRO_PASAJE"), "1.00", q(ts(d, hh, mm))]);
    } else {
      pagos.push(["NULL", pick([3, 4]), est, q("COBRO_PASAJE"), "1.00", q(ts(d, hh, mm))]);
    }
  }
}
pagos.sort((a, b) => (a[5] < b[5] ? -1 : 1));
// las recargas deben ir antes del primer cobro de su tarjeta: se reordena de forma estable por tarjeta
const firstRecarga = new Map();
for (const p of pagos) if (p[3] === "'RECARGA'" && !firstRecarga.has(p[0])) firstRecarga.set(p[0], p[5]);
const pagosOk = [];
const saldoSim = new Map(tarj.map((t) => [t.id, 0]));
for (const p of pagos) {
  const id = p[0];
  if (p[3] === "'RECARGA'") { saldoSim.set(id, saldoSim.get(id) + Number(p[4])); pagosOk.push(p); }
  else if (p[1] === 2) {
    const tipo = tarj[id - 1].tipo;
    if (saldoSim.get(id) >= TARIFA[tipo]) { saldoSim.set(id, saldoSim.get(id) - TARIFA[tipo]); pagosOk.push(p); }
  } else pagosOk.push(p);
}
insert("pago", ["id_tarjeta", "id_metodo_pago", "id_estacion", "tipo", "monto", "fecha"], pagosOk.map((p) => p.map((x, i) => (i === 0 || i === 1 || i === 2 ? x : x))));

// viajes y visitas (recorridos del día 2026-10-23)
const viajes = [];
function viaje(linCod, busObj, sentido, hora, estado) {
  viajes.push({ id: viajes.length + 1, lin: linCod, bus: busObj, sentido, hora, estado });
}
const l12 = buses.filter((b) => b.linea === "L12");
const horas = ["05:30", "06:00", "06:30", "07:00", "09:30", "12:00"];
horas.forEach((h, i) => viaje("L12", l12[i], i % 2 === 0 ? "IDA" : "VUELTA", h, i < 5 ? "FINALIZADO" : "PROGRAMADO"));
buses.filter((b) => b.linea === "L6").slice(0, 3).forEach((b, i) => viaje("L6", b, i % 2 ? "VUELTA" : "IDA", ["05:15", "06:15", "07:15"][i], "FINALIZADO"));
buses.filter((b) => b.linea === "L13").slice(0, 2).forEach((b, i) => viaje("L13", b, i % 2 ? "VUELTA" : "IDA", ["05:45", "06:45"][i], "FINALIZADO"));
buses.filter((b) => b.linea === "L18").slice(0, 2).forEach((b, i) => viaje("L18", b, i % 2 ? "VUELTA" : "IDA", ["06:00", "07:00"][i], "FINALIZADO"));
insert("viaje", ["id_linea", "id_bus", "id_piloto", "sentido", "fecha_hora_salida", "estado"],
  viajes.map((v) => [lineaId[v.lin], v.bus.id, pilotoMat[v.bus.id], q(v.sentido), q(`2026-10-23 ${v.hora}:00`), q(v.estado)]));
for (const v of viajes) emit(`SELECT fn_generar_visitas(${v.id});`);
for (const v of viajes) {
  if (v.estado !== "FINALIZADO") continue;
  const orden = ORDEN[v.lin];
  const n = orden.length;
  const base = 0.12 + rnd() * 0.85; // ocupación de cada recorrido
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const f = base * (0.35 + 0.9 * Math.sin(Math.PI * t) ** 0.8) * (0.8 + rnd() * 0.4);
    const pas = Math.max(0, Math.min(v.bus.cap, Math.round(v.bus.cap * f)));
    emit(`UPDATE visita SET pasajeros_a_bordo = ${pas}, hora_llegada_real = hora_programada + INTERVAL '${ri(0, 3)} minutes' WHERE id_viaje = ${v.id} AND orden = ${i + 1};`);
  }
}

// lecturas de pasajeros en espera y alertas (regla 14)
const capLinea = {};
for (const b of buses) if (b.linea) capLinea[b.linea] = Math.min(capLinea[b.linea] ?? 1e9, b.cap);
const lecturas = [];
const lineasDeEst = {};
for (const l of LINEAS) for (const k of ORDEN[l.cod]) (lineasDeEst[k] ||= []).push(l.cod);
const activas = ["L12", "L6", "L13", "L18"];
let alertas = 0;
const alertIds = [];
for (let i = 0; i < 170; i++) {
  const k = pick(estKeys.filter((e) => lineasDeEst[e].some((c) => activas.includes(c))));
  const cod = pick(lineasDeEst[k].filter((c) => activas.includes(c)));
  const pico = chance(0.35);
  const cap = capLinea[cod];
  const pas = Math.max(0, Math.round(cap * (pico ? 0.9 + rnd() * 1.1 : 0.15 + rnd() * 0.9)));
  const hh = pick([5, 6, 7, 7, 8, 12, 17, 18, 18, 19]);
  lecturas.push([estId[k], lineaId[cod], q(`2026-10-23 ${pad(hh, 2)}:${pad(ri(0, 59), 2)}:00`), pas]);
}
lecturas.sort((a, b) => (a[2] < b[2] ? -1 : 1));
lecturas.forEach((r, idx) => {
  const cod = LINEAS[r[1] - 1].cod;
  if (r[3] >= Math.ceil(capLinea[cod] * 1.5)) { alertas++; alertIds.push({ id: alertas, cod }); }
});
insert("lectura_estacion", ["id_estacion", "id_linea", "fecha", "pasajeros_esperando"], lecturas);
// se atienden alrededor del 60 % de las alertas con un bus de refuerzo (de la línea o de reserva)
alertIds.forEach((a, i) => {
  if (i % 5 < 3) {
    const cand = buses.filter((b) => b.linea === a.cod || (b.linea === null && b.estado === "OPERATIVO" && a.cod === "L12"));
    emit(`SELECT fn_atender_alerta(${a.id}, ${cand[(i * 7) % cand.length].id});`);
  }
});

// activación de las líneas (el sistema valida N <= buses <= 2N al confirmar)
emit(`UPDATE linea SET estado = 'ACTIVA' WHERE codigo IN ('L12','L6','L13','L18');`);

emit("COMMIT;");
emit("-- La bitácora se reinicia tras la carga inicial para que solo contenga la actividad real.");
emit("TRUNCATE bitacora;");
emit("-- Fin de la carga inicial.");

writeFileSync(OUT, out.join("\n") + "\n", "utf8");
console.log(JSON.stringify({
  archivo: OUT, estaciones: estKeys.length, accesos: accesos.length, guardias: guardias.length, buses: buses.length,
  pilotos: pilotos.length, estudios: estudios.length, operadores: ops.length, tarjetas: tarj.length, pagos: pagosOk.length,
  viajes: viajes.length, lecturas: lecturas.length, alertas, distanciaL12: [...tramos.values()].length,
}, null, 1));
