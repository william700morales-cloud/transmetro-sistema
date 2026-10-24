-- =====================================================================
-- Archivo 06: consultas de los reportes que muestra la aplicación web
-- Cada bloque empieza con "-- @reporte ID | Título | Descripción | Reglas".
-- La aplicación lee este mismo archivo, así que lo que se ve en pantalla
-- es exactamente lo que está documentado aquí.
-- =====================================================================
SET search_path TO transmetro, public;

-- @reporte R01 | Líneas del sistema | Cada línea con su municipalidad, número de estaciones, distancia total y buses asignados frente al mínimo y máximo permitidos. | 5, 11, 13
SELECT l.codigo                              AS "Línea",
       l.nombre                              AS "Nombre",
       m.nombre                              AS "Municipalidad",
       l.estado                              AS "Estado",
       COUNT(DISTINCT le.id_estacion)        AS "Estaciones",
       fn_distancia_linea(l.id_linea)        AS "Distancia (km)",
       COUNT(DISTINCT b.id_bus)              AS "Buses asignados",
       COUNT(DISTINCT le.id_estacion)        AS "Mínimo de buses",
       2 * COUNT(DISTINCT le.id_estacion)    AS "Máximo de buses"
  FROM linea l
  JOIN municipalidad m        ON m.id_municipalidad = l.id_municipalidad
  LEFT JOIN linea_estacion le ON le.id_linea = l.id_linea
  LEFT JOIN bus b             ON b.id_linea = l.id_linea
 GROUP BY l.id_linea, l.codigo, l.nombre, m.nombre, l.estado
 ORDER BY l.codigo;

-- @reporte R02 | Estaciones de cada línea en orden | Recorrido de cada línea: orden de las estaciones, distancia desde la anterior y distancia acumulada. | 1, 12, 13
SELECT linea AS "Línea", orden AS "Orden", estacion AS "Estación",
       km_desde_anterior AS "Km desde la anterior", km_acumulado AS "Km acumulados"
  FROM vw_linea_estaciones
 ORDER BY linea, orden;

-- @reporte R03 | Estaciones de la red | Cada estación con su municipalidad, líneas a las que pertenece, accesos, guardias, parqueos, PC de trabajo y operadores. | 2, 3, 6, 10, 11, 16
SELECT e.codigo AS "Código", e.nombre AS "Estación", m.nombre AS "Municipalidad",
       (SELECT string_agg(l.codigo, ', ' ORDER BY l.codigo)
          FROM linea_estacion le JOIN linea l USING (id_linea)
         WHERE le.id_estacion = e.id_estacion)                         AS "Líneas",
       (SELECT count(*) FROM acceso a WHERE a.id_estacion = e.id_estacion) AS "Accesos",
       (SELECT count(*) FROM asignacion_guardia ag JOIN acceso a USING (id_acceso)
         WHERE a.id_estacion = e.id_estacion AND ag.fecha_fin IS NULL)  AS "Guardias",
       (SELECT count(*) FROM parqueo p WHERE p.id_estacion = e.id_estacion) AS "Parqueos",
       c.hostname AS "PC de trabajo"
  FROM estacion e
  JOIN municipalidad m      ON m.id_municipalidad = e.id_municipalidad
  LEFT JOIN computadora c   ON c.id_estacion = e.id_estacion
 ORDER BY e.codigo;

-- @reporte R04 | Buses asignados a cada línea | Detalle de los buses de cada línea con su parqueo y los pilotos vigentes por turno. | 4, 6, 7
SELECT l.codigo AS "Línea", b.numero_unidad AS "Unidad", b.placa AS "Placa", b.tipo AS "Tipo",
       b.capacidad_pasajeros AS "Capacidad", b.estado AS "Estado", p.nombre AS "Parqueo",
       (SELECT string_agg(pi.nombres || ' ' || pi.apellidos || ' (' || lower(ap.turno) || ')', '; ' ORDER BY ap.turno)
          FROM asignacion_piloto_bus ap JOIN piloto pi USING (id_piloto)
         WHERE ap.id_bus = b.id_bus AND ap.fecha_fin IS NULL) AS "Pilotos"
  FROM bus b
  JOIN linea l   ON l.id_linea = b.id_linea
  JOIN parqueo p ON p.id_parqueo = b.id_parqueo
 ORDER BY l.codigo, b.numero_unidad;

-- @reporte R05 | Buses sin línea asignada | Buses de reserva: no están en ninguna línea, pero siempre tienen parqueo. | 4, 7
SELECT b.numero_unidad AS "Unidad", b.placa AS "Placa", b.tipo AS "Tipo",
       b.capacidad_pasajeros AS "Capacidad", b.estado AS "Estado", p.nombre AS "Parqueo"
  FROM bus b
  JOIN parqueo p ON p.id_parqueo = b.id_parqueo
 WHERE b.id_linea IS NULL
 ORDER BY b.numero_unidad;

-- @reporte R06 | Accesos de cada línea | Todos los accesos de todas las estaciones de cada línea, con los guardias vigentes de cada uno. | 3, 8, 10
SELECT l.codigo AS "Línea", le.orden AS "Orden", e.nombre AS "Estación", a.numero AS "Acceso",
       a.nombre AS "Nombre del acceso", a.tipo AS "Tipo", count(ag.id_asignacion) AS "Guardias vigentes"
  FROM linea l
  JOIN linea_estacion le ON le.id_linea = l.id_linea
  JOIN estacion e        ON e.id_estacion = le.id_estacion
  JOIN acceso a          ON a.id_estacion = e.id_estacion
  LEFT JOIN asignacion_guardia ag ON ag.id_acceso = a.id_acceso AND ag.fecha_fin IS NULL
 GROUP BY l.codigo, le.orden, e.nombre, a.numero, a.nombre, a.tipo
 ORDER BY l.codigo, le.orden, a.numero;

-- @reporte R07 | Guardias de seguridad por acceso | Guardias asignados a cada acceso, con su turno. | 10
SELECT e.nombre AS "Estación", a.numero AS "Acceso", g.nombres || ' ' || g.apellidos AS "Guardia",
       ag.turno AS "Turno", g.telefono AS "Teléfono", ag.fecha_inicio AS "Desde"
  FROM asignacion_guardia ag
  JOIN guardia g  ON g.id_guardia = ag.id_guardia
  JOIN acceso a   ON a.id_acceso = ag.id_acceso
  JOIN estacion e ON e.id_estacion = a.id_estacion
 WHERE ag.fecha_fin IS NULL
 ORDER BY e.nombre, a.numero, ag.turno;

-- @reporte R08 | Distancia entre estaciones contiguas | Distancia de cada tramo entre dos estaciones, en kilómetros, y las líneas que lo recorren. | 12
SELECT ea.nombre AS "Estación A", eb.nombre AS "Estación B", t.distancia_km AS "Distancia (km)",
       (SELECT string_agg(DISTINCT l.codigo, ', ')
          FROM linea_estacion x JOIN linea_estacion y ON y.id_linea = x.id_linea AND y.orden = x.orden + 1
          JOIN linea l ON l.id_linea = x.id_linea
         WHERE LEAST(x.id_estacion, y.id_estacion) = t.id_estacion_a
           AND GREATEST(x.id_estacion, y.id_estacion) = t.id_estacion_b) AS "Líneas"
  FROM tramo t
  JOIN estacion ea ON ea.id_estacion = t.id_estacion_a
  JOIN estacion eb ON eb.id_estacion = t.id_estacion_b
 ORDER BY t.id_estacion_a, t.id_estacion_b;

-- @reporte R09 | Estaciones de intercambio | Estaciones que pertenecen a más de una línea. | 2
SELECT e.nombre AS "Estación", count(*) AS "Número de líneas",
       string_agg(l.codigo, ', ' ORDER BY l.codigo) AS "Líneas"
  FROM estacion e
  JOIN linea_estacion le ON le.id_estacion = e.id_estacion
  JOIN linea l           ON l.id_linea = le.id_linea
 GROUP BY e.id_estacion, e.nombre
HAVING count(*) > 1
 ORDER BY count(*) DESC, e.nombre;

-- @reporte R10 | Pilotos: residencia y comunicación | Datos personales, de residencia y de contacto de los pilotos (DPI enmascarado) y su mayor nivel de estudio. | 9
SELECT piloto AS "Piloto", dpi_enmascarado AS "DPI", edad AS "Edad", licencia_tipo AS "Licencia",
       direccion_residencia AS "Dirección", zona AS "Zona", municipio_residencia AS "Municipio",
       telefono_movil AS "Teléfono móvil", correo AS "Correo", mayor_estudio AS "Mayor estudio",
       bus_actual AS "Bus actual"
  FROM vw_pilotos_ficha
 ORDER BY piloto;

-- @reporte R11 | Historial educativo de los pilotos | Cada estudio registrado de cada piloto, en orden cronológico. | 9
SELECT pi.nombres || ' ' || pi.apellidos AS "Piloto", pe.nivel AS "Nivel", pe.titulo AS "Título",
       pe.institucion AS "Institución", pe.anio_inicio AS "Inicio", pe.anio_fin AS "Fin",
       CASE WHEN pe.concluido THEN 'Concluido' ELSE 'En curso' END AS "Estado"
  FROM piloto_estudio pe
  JOIN piloto pi ON pi.id_piloto = pe.id_piloto
 ORDER BY pi.apellidos, pi.nombres, pe.anio_inicio;

-- @reporte R12 | Parqueos y ocupación | Capacidad de cada parqueo, buses que alberga y estación a la que pertenece (si la tiene). | 6, 7
SELECT p.codigo AS "Código", p.nombre AS "Parqueo", COALESCE(e.nombre, '(sin estación)') AS "Estación",
       p.capacidad_buses AS "Capacidad", count(b.id_bus) AS "Buses",
       p.capacidad_buses - count(b.id_bus) AS "Espacios libres"
  FROM parqueo p
  LEFT JOIN estacion e ON e.id_estacion = p.id_estacion
  LEFT JOIN bus b      ON b.id_parqueo = p.id_parqueo
 GROUP BY p.id_parqueo, p.codigo, p.nombre, e.nombre, p.capacidad_buses
 ORDER BY p.codigo;

-- @reporte R13 | Alertas de capacidad de estaciones | Alertas generadas cuando esperan 150 % o más de la capacidad de un bus, y bus de refuerzo enviado. | 14
SELECT id_alerta AS "Alerta", fecha AS "Fecha y hora", linea AS "Línea", estacion AS "Estación",
       pasajeros_esperando AS "Pasajeros esperando", umbral AS "Umbral", pct_capacidad_bus AS "% de la capacidad del bus",
       estado AS "Estado", bus_refuerzo AS "Bus de refuerzo"
  FROM vw_alertas_capacidad
 ORDER BY fecha, id_alerta;

-- @reporte R14 | Visitas con espera adicional | Visitas de los buses a estaciones donde iban con menos del 25 % de su capacidad y esperan 5 minutos más. | 1, 15
SELECT linea AS "Línea", bus AS "Bus", sentido AS "Sentido", orden AS "Orden", estacion AS "Estación",
       hora_programada AS "Hora programada", pasajeros_a_bordo AS "Pasajeros", capacidad_pasajeros AS "Capacidad",
       ocupacion_pct AS "Ocupación %", espera_base_min + espera_extra_min AS "Espera total (min)",
       salida_estimada AS "Salida estimada"
  FROM vw_visitas_espera
 WHERE espera_extra_min > 0
 ORDER BY hora_programada, bus;

-- @reporte R15 | PC, operador y enlaces de red por estación | Computadora de trabajo de cada estación, operadores asignados y enlaces de comunicación. | 16, 17
SELECT estacion AS "Estación", hostname AS "PC", ip_vpn::TEXT AS "IP en la VPN", estado_pc AS "Estado de la PC",
       operador AS "Operador", turno AS "Turno", enlaces AS "Enlaces"
  FROM vw_operadores_estacion
 ORDER BY estacion, turno;

-- @reporte R16 | Recaudo por método de pago | Operaciones y monto total por método de pago y tipo (recarga o cobro de pasaje). | 18
SELECT mp.nombre AS "Método de pago", p.tipo AS "Tipo", count(*) AS "Operaciones", sum(p.monto) AS "Total (Q)"
  FROM pago p
  JOIN metodo_pago mp ON mp.id_metodo_pago = p.id_metodo_pago
 GROUP BY mp.nombre, p.tipo
 ORDER BY mp.nombre, p.tipo;

-- @reporte R17 | Controles de integridad | Cantidad de incumplimientos de cada regla; todos deben estar en cero. | 2, 5, 10, 12
SELECT 'Accesos sin guardia vigente (regla 10)' AS "Control", count(*) AS "Incumplimientos" FROM vw_accesos_sin_guardia
UNION ALL
SELECT 'Estaciones sin línea (regla 2)', count(*) FROM estacion e
 WHERE NOT EXISTS (SELECT 1 FROM linea_estacion le WHERE le.id_estacion = e.id_estacion)
UNION ALL
SELECT 'Líneas activas fuera del rango de buses (regla 5)', count(*) FROM vw_linea_cumplimiento
 WHERE estado = 'ACTIVA' AND cumplimiento <> 'CUMPLE'
UNION ALL
SELECT 'Tramos contiguos sin distancia (regla 12)', count(*) FROM vw_tramos_faltantes
UNION ALL
SELECT 'Buses sin parqueo (regla 7)', count(*) FROM bus WHERE id_parqueo IS NULL;
