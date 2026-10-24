-- =====================================================================
-- Archivo 03: vistas de apoyo a los reportes
-- =====================================================================
SET search_path TO transmetro, public;

-- Estaciones de cada línea en orden, con distancia al tramo anterior y acumulada (reglas 1, 12, 13)
CREATE OR REPLACE VIEW vw_linea_estaciones AS
WITH t AS (
    SELECT le.id_linea, le.orden, le.id_estacion,
           LAG(le.id_estacion) OVER (PARTITION BY le.id_linea ORDER BY le.orden) AS anterior
      FROM linea_estacion le
)
SELECT l.id_linea, l.codigo AS linea, t.orden, e.id_estacion, e.codigo AS cod_estacion,
       e.nombre AS estacion,
       COALESCE(fn_distancia_tramo(t.anterior, t.id_estacion), 0) AS km_desde_anterior,
       SUM(COALESCE(fn_distancia_tramo(t.anterior, t.id_estacion), 0))
           OVER (PARTITION BY t.id_linea ORDER BY t.orden) AS km_acumulado
  FROM t
  JOIN linea l    ON l.id_linea = t.id_linea
  JOIN estacion e ON e.id_estacion = t.id_estacion;

-- Resumen de cada línea: estaciones, distancia y cumplimiento de la regla de flota (reglas 5, 11, 13)
CREATE OR REPLACE VIEW vw_linea_resumen AS
SELECT l.id_linea, l.codigo, l.nombre, m.nombre AS municipalidad, l.estado,
       COUNT(DISTINCT le.id_estacion)                         AS estaciones,
       fn_distancia_linea(l.id_linea)                         AS distancia_km,
       (SELECT count(*) FROM bus b WHERE b.id_linea = l.id_linea) AS buses_asignados,
       ceil(COUNT(DISTINCT le.id_estacion) * fn_parametro('FLOTA_MIN_POR_ESTACION'))::INT AS buses_minimo,
       floor(COUNT(DISTINCT le.id_estacion) * fn_parametro('FLOTA_MAX_POR_ESTACION'))::INT AS buses_maximo
  FROM linea l
  JOIN municipalidad m ON m.id_municipalidad = l.id_municipalidad
  LEFT JOIN linea_estacion le ON le.id_linea = l.id_linea
 GROUP BY l.id_linea, l.codigo, l.nombre, m.nombre, l.estado;

CREATE OR REPLACE VIEW vw_linea_cumplimiento AS
SELECT r.*,
       CASE
         WHEN buses_asignados > buses_maximo THEN 'EXCEDE EL MÁXIMO'
         WHEN buses_asignados < buses_minimo AND estado = 'ACTIVA' THEN 'FALTAN BUSES'
         WHEN buses_asignados < buses_minimo THEN 'EN PLANIFICACIÓN'
         ELSE 'CUMPLE'
       END AS cumplimiento
  FROM vw_linea_resumen r;

-- Resumen de cada estación (reglas 2, 3, 6, 10, 11, 16)
CREATE OR REPLACE VIEW vw_estacion_resumen AS
SELECT e.id_estacion, e.codigo, e.nombre, m.nombre AS municipalidad, e.capacidad_anden,
       (SELECT string_agg(l.codigo, ', ' ORDER BY l.codigo)
          FROM linea_estacion le JOIN linea l USING (id_linea) WHERE le.id_estacion = e.id_estacion) AS lineas,
       (SELECT count(*) FROM acceso a WHERE a.id_estacion = e.id_estacion) AS accesos,
       (SELECT count(*) FROM asignacion_guardia ag JOIN acceso a USING (id_acceso)
         WHERE a.id_estacion = e.id_estacion AND ag.fecha_fin IS NULL) AS guardias,
       (SELECT count(*) FROM parqueo p WHERE p.id_estacion = e.id_estacion) AS parqueos,
       c.hostname AS computadora,
       (SELECT string_agg(o.nombres || ' ' || o.apellidos, '; ' ORDER BY o.turno)
          FROM operador o WHERE o.id_computadora = c.id_computadora AND o.activo) AS operadores
  FROM estacion e
  JOIN municipalidad m ON m.id_municipalidad = e.id_municipalidad
  LEFT JOIN computadora c ON c.id_estacion = e.id_estacion;

-- Todos los accesos de cada línea (regla 8)
CREATE OR REPLACE VIEW vw_accesos_por_linea AS
SELECT l.codigo AS linea, le.orden, e.nombre AS estacion, a.numero AS acceso, a.nombre AS nombre_acceso,
       a.tipo, count(ag.id_asignacion) AS guardias_vigentes
  FROM linea l
  JOIN linea_estacion le ON le.id_linea = l.id_linea
  JOIN estacion e        ON e.id_estacion = le.id_estacion
  JOIN acceso a          ON a.id_estacion = e.id_estacion
  LEFT JOIN asignacion_guardia ag ON ag.id_acceso = a.id_acceso AND ag.fecha_fin IS NULL
 GROUP BY l.codigo, le.orden, e.nombre, a.numero, a.nombre, a.tipo;

-- Buses asignados a cada línea, con parqueo y piloto vigente (reglas 4, 6, 7)
CREATE OR REPLACE VIEW vw_buses_por_linea AS
SELECT l.codigo AS linea, b.numero_unidad, b.placa, b.tipo, b.capacidad_pasajeros, b.estado,
       p.nombre AS parqueo,
       (SELECT string_agg(left(pi.nombres, 1) || '. ' || pi.apellidos || ' (' || lower(ap.turno) || ')', '; ' ORDER BY ap.turno)
          FROM asignacion_piloto_bus ap JOIN piloto pi USING (id_piloto)
         WHERE ap.id_bus = b.id_bus AND ap.fecha_fin IS NULL) AS pilotos
  FROM bus b
  JOIN linea l   ON l.id_linea = b.id_linea
  JOIN parqueo p ON p.id_parqueo = b.id_parqueo;

CREATE OR REPLACE VIEW vw_buses_sin_linea AS
SELECT b.numero_unidad, b.placa, b.tipo, b.capacidad_pasajeros, b.estado, p.nombre AS parqueo
  FROM bus b JOIN parqueo p USING (id_parqueo)
 WHERE b.id_linea IS NULL;

-- Ficha del piloto: educación, residencia y comunicación (regla 9). El DPI se muestra enmascarado.
CREATE OR REPLACE VIEW vw_pilotos_ficha AS
SELECT pi.id_piloto,
       pi.nombres || ' ' || pi.apellidos AS piloto,
       '*********' || right(pi.dpi, 4)    AS dpi_enmascarado,
       date_part('year', age(DATE '2026-10-23', pi.fecha_nacimiento))::INT AS edad,
       pi.licencia_tipo, pi.direccion_residencia, pi.zona, m.nombre AS municipio_residencia, m.departamento,
       pi.telefono_movil, pi.telefono_residencial, pi.correo,
       pi.contacto_emergencia_nombre, pi.contacto_emergencia_telefono,
       (SELECT count(*) FROM piloto_estudio pe WHERE pe.id_piloto = pi.id_piloto) AS estudios_registrados,
       (SELECT pe.titulo FROM piloto_estudio pe WHERE pe.id_piloto = pi.id_piloto
         ORDER BY CASE pe.nivel WHEN 'POSTGRADO' THEN 6 WHEN 'UNIVERSITARIO' THEN 5 WHEN 'TECNICO' THEN 4
                  WHEN 'DIVERSIFICADO' THEN 3 WHEN 'BASICO' THEN 2 WHEN 'PRIMARIA' THEN 1 ELSE 0 END DESC,
                  pe.anio_inicio DESC LIMIT 1) AS mayor_estudio,
       (SELECT b.numero_unidad FROM asignacion_piloto_bus ap JOIN bus b USING (id_bus)
         WHERE ap.id_piloto = pi.id_piloto AND ap.fecha_fin IS NULL) AS bus_actual
  FROM piloto pi
  JOIN municipalidad m ON m.id_municipalidad = pi.id_municipalidad_residencia;

-- Alertas de capacidad (regla 14)
CREATE OR REPLACE VIEW vw_alertas_capacidad AS
SELECT a.id_alerta, a.fecha, l.codigo AS linea, e.nombre AS estacion, a.pasajeros_esperando, a.umbral,
       round(a.pasajeros_esperando * fn_parametro('ALERTA_AFORO_PCT') / a.umbral, 0) AS pct_capacidad_bus,
       CASE WHEN a.atendida THEN 'ATENDIDA' ELSE 'PENDIENTE' END AS estado,
       b.numero_unidad AS bus_refuerzo, a.mensaje
  FROM alerta a
  JOIN estacion e ON e.id_estacion = a.id_estacion
  JOIN linea l    ON l.id_linea = a.id_linea
  LEFT JOIN bus b ON b.id_bus = a.id_bus_refuerzo;

-- Visitas planificadas y reales de cada unidad, con la espera adicional (reglas 1 y 15)
CREATE OR REPLACE VIEW vw_visitas_espera AS
SELECT v.id_viaje, l.codigo AS linea, b.numero_unidad AS bus, vj.sentido, v.orden, e.nombre AS estacion,
       v.hora_programada, v.hora_llegada_real, b.capacidad_pasajeros, v.pasajeros_a_bordo, v.ocupacion_pct,
       fn_parametro('ESPERA_BASE_MIN')::INT AS espera_base_min, v.espera_extra_min,
       v.hora_programada + (fn_parametro('ESPERA_BASE_MIN') + v.espera_extra_min) * INTERVAL '1 minute'
           AS salida_estimada
  FROM visita v
  JOIN viaje vj   ON vj.id_viaje = v.id_viaje
  JOIN bus b      ON b.id_bus = vj.id_bus
  JOIN linea l    ON l.id_linea = vj.id_linea
  JOIN estacion e ON e.id_estacion = v.id_estacion;

-- Controles de integridad que el sistema vigila
CREATE OR REPLACE VIEW vw_accesos_sin_guardia AS
SELECT e.nombre AS estacion, a.numero AS acceso, a.nombre
  FROM acceso a JOIN estacion e USING (id_estacion)
 WHERE NOT EXISTS (SELECT 1 FROM asignacion_guardia ag WHERE ag.id_acceso = a.id_acceso AND ag.fecha_fin IS NULL);

CREATE OR REPLACE VIEW vw_tramos_faltantes AS
SELECT l.codigo AS linea, a.nombre AS desde, b.nombre AS hasta
  FROM (SELECT id_linea, id_estacion, LAG(id_estacion) OVER (PARTITION BY id_linea ORDER BY orden) AS anterior
          FROM linea_estacion) t
  JOIN linea l    ON l.id_linea = t.id_linea
  JOIN estacion a ON a.id_estacion = t.anterior
  JOIN estacion b ON b.id_estacion = t.id_estacion
 WHERE t.anterior IS NOT NULL AND fn_distancia_tramo(t.anterior, t.id_estacion) IS NULL;

-- Operadores y PC de cada estación (regla 16)
CREATE OR REPLACE VIEW vw_operadores_estacion AS
SELECT e.nombre AS estacion, c.hostname, c.ip_vpn, c.estado AS estado_pc,
       o.nombres || ' ' || o.apellidos AS operador, o.usuario, o.turno,
       (SELECT string_agg(er.rol || ': ' || er.medio || ' ' || er.ancho_banda_mbps || ' Mbps', ' | ' ORDER BY er.rol)
          FROM enlace_red er WHERE er.id_estacion = e.id_estacion) AS enlaces
  FROM computadora c
  JOIN estacion e ON e.id_estacion = c.id_estacion
  LEFT JOIN operador o ON o.id_computadora = c.id_computadora AND o.activo;

-- Recaudo por método de pago (regla 18)
CREATE OR REPLACE VIEW vw_recaudo_metodo_pago AS
SELECT mp.nombre AS metodo, p.tipo, count(*) AS operaciones, sum(p.monto) AS total_q
  FROM pago p JOIN metodo_pago mp USING (id_metodo_pago)
 GROUP BY mp.nombre, p.tipo;
