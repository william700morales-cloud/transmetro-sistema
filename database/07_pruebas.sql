-- =====================================================================
-- Archivo 07: pruebas automáticas de las reglas del enunciado
-- Cada prueba se ejecuta dentro de una subtransacción que se revierte, así que
-- no modifica los datos. El resultado queda en transmetro_test.resultado.
-- =====================================================================
SET search_path TO transmetro, public;
DROP SCHEMA IF EXISTS transmetro_test CASCADE;
CREATE SCHEMA transmetro_test;

CREATE TABLE transmetro_test.resultado (
    id          VARCHAR(8) PRIMARY KEY,
    regla       VARCHAR(40),
    descripcion TEXT,
    esperado    TEXT,
    obtenido    TEXT,
    estado      VARCHAR(5)
);

-- Prueba que una operación sea rechazada por el sistema
CREATE FUNCTION transmetro_test.esperar_error(p_id TEXT, p_regla TEXT, p_desc TEXT, p_sql TEXT,
                                              p_sqlstate TEXT DEFAULT NULL, p_frag TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_msg TEXT; v_state TEXT;
BEGIN
    BEGIN
        SET CONSTRAINTS ALL IMMEDIATE;
        EXECUTE p_sql;
        RAISE EXCEPTION 'sin error' USING ERRCODE = 'TM999';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
        v_msg := CASE WHEN v_state = 'TM999' THEN NULL ELSE SQLERRM END;
    END;
    INSERT INTO transmetro_test.resultado
    VALUES (p_id, p_regla, p_desc, 'Rechazo: ' || COALESCE(p_frag, p_sqlstate, 'cualquier error'),
            COALESCE(v_msg, 'La operación se aceptó (la regla no se aplicó)'),
            CASE WHEN v_msg IS NOT NULL
                  AND (p_sqlstate IS NULL OR v_state = p_sqlstate)
                  AND (p_frag IS NULL OR v_msg LIKE '%' || p_frag || '%') THEN 'OK' ELSE 'FALLA' END);
END $$;

-- Prueba que una operación se acepte y deje el resultado esperado
CREATE FUNCTION transmetro_test.esperar_ok(p_id TEXT, p_regla TEXT, p_desc TEXT, p_accion TEXT, p_verificacion TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_ok BOOLEAN := FALSE; v_msg TEXT := 'Cumplido'; v_state TEXT;
BEGIN
    BEGIN
        SET CONSTRAINTS ALL IMMEDIATE;
        EXECUTE p_accion;
        EXECUTE p_verificacion INTO v_ok;
        RAISE EXCEPTION 'revertir' USING ERRCODE = 'TM999';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
        IF v_state <> 'TM999' THEN v_ok := FALSE; v_msg := SQLERRM; END IF;
    END;
    INSERT INTO transmetro_test.resultado
    VALUES (p_id, p_regla, p_desc, 'Operación aceptada y verificada',
            CASE WHEN v_ok THEN 'Cumplido' ELSE 'No se cumplió: ' || v_msg END,
            CASE WHEN v_ok THEN 'OK' ELSE 'FALLA' END);
END $$;

-- ---------------- Regla 5: flota por línea ----------------
SELECT transmetro_test.esperar_error('T01', 'R5 máximo de buses',
  'Asignar 4 buses más a la Línea 12 (27 + 4 = 31, el máximo es 30)',
  $t$UPDATE bus SET id_linea = (SELECT id_linea FROM linea WHERE codigo='L12')
      WHERE id_bus IN (SELECT id_bus FROM bus WHERE id_linea IS NULL AND tipo='ARTICULADO' ORDER BY id_bus LIMIT 4)$t$,
  'P0001', 'máximo permitido');
SELECT transmetro_test.esperar_error('T02', 'R5 mínimo de buses',
  'Quitar 13 buses a la Línea 12 activa (quedarían 14, el mínimo es 15)',
  $t$UPDATE bus SET id_linea = NULL
      WHERE id_bus IN (SELECT id_bus FROM bus WHERE id_linea=(SELECT id_linea FROM linea WHERE codigo='L12') ORDER BY id_bus LIMIT 13)$t$,
  'P0001', 'al menos 15 buses');
SELECT transmetro_test.esperar_error('T03', 'R5 activación',
  'Activar la Línea 20 con 3 buses cuando necesita al menos 5',
  $t$UPDATE linea SET estado='ACTIVA' WHERE codigo='L20'$t$, 'P0001', 'al menos 5 buses');
SELECT transmetro_test.esperar_ok('T04', 'R5 activación',
  'Asignar 2 buses de reserva a la Línea 20 y activarla (5 buses para 5 estaciones)',
  $t$UPDATE bus SET id_linea=(SELECT id_linea FROM linea WHERE codigo='L20')
      WHERE id_bus IN (SELECT id_bus FROM bus WHERE id_linea IS NULL AND estado='OPERATIVO' ORDER BY id_bus LIMIT 2);
     UPDATE linea SET estado='ACTIVA' WHERE codigo='L20'$t$,
  $t$SELECT estado='ACTIVA' FROM linea WHERE codigo='L20'$t$);

-- ---------------- Reglas 4, 6 y 7: buses, línea y parqueo ----------------
SELECT transmetro_test.esperar_ok('T05', 'R4 bus sin línea',
  'Un bus puede quedar sin línea asignada',
  $t$UPDATE bus SET id_linea=NULL WHERE numero_unidad='TM-001'$t$,
  $t$SELECT id_linea IS NULL FROM bus WHERE numero_unidad='TM-001'$t$);
SELECT transmetro_test.esperar_error('T06', 'R7 bus sin parqueo',
  'Dejar un bus sin parqueo', $t$UPDATE bus SET id_parqueo=NULL WHERE numero_unidad='TM-001'$t$, '23502');
SELECT transmetro_test.esperar_ok('T07', 'R7 cambio de parqueo',
  'Cambiar un bus de parqueo y conservar el historial',
  $t$UPDATE bus SET id_parqueo=(SELECT id_parqueo FROM parqueo WHERE codigo='PQ-TL') WHERE numero_unidad='TM-001'$t$,
  $t$SELECT count(*)=2 AND count(*) FILTER (WHERE hasta IS NULL)=1
       FROM bus_parqueo_historial h JOIN bus b USING (id_bus) WHERE b.numero_unidad='TM-001'$t$);
SELECT transmetro_test.esperar_error('T08', 'R6 capacidad del parqueo',
  'Mover 6 buses al parqueo de Chinautla (capacidad 8, ya tiene 3)',
  $t$UPDATE bus SET id_parqueo=(SELECT id_parqueo FROM parqueo WHERE codigo='PQ-CH')
      WHERE id_bus IN (SELECT id_bus FROM bus WHERE id_linea IS NULL ORDER BY id_bus LIMIT 6)$t$,
  'P0001', 'está lleno');

-- ---------------- Reglas 2, 3, 8, 10, 11: estaciones, accesos y guardias ----------------
SELECT transmetro_test.esperar_error('T09', 'R2 estación sin línea',
  'Crear una estación que no pertenece a ninguna línea',
  $t$INSERT INTO estacion (codigo,nombre,id_municipalidad,latitud,longitud,capacidad_anden) VALUES ('E-999','Estación de prueba',1,14.6,-90.5,100)$t$,
  'P0001', 'al menos a una línea');
SELECT transmetro_test.esperar_ok('T10', 'R2 varias líneas',
  'Existen estaciones que pertenecen a varias líneas (El Trébol: L12, L6 y L13)',
  $t$SELECT 1$t$,
  $t$SELECT count(*) = 3 FROM linea_estacion le JOIN estacion e USING (id_estacion) WHERE e.nombre='El Trébol'$t$);
SELECT transmetro_test.esperar_error('T11', 'R10 acceso sin guardia',
  'Crear un acceso sin guardia de seguridad',
  $t$INSERT INTO acceso (id_estacion,numero,nombre,tipo) VALUES (1,9,'Acceso de prueba','SECUNDARIO')$t$,
  'P0001', 'al menos un guardia');
SELECT transmetro_test.esperar_error('T12', 'R10 último guardia',
  'Retirar al único guardia de un acceso',
  $t$UPDATE asignacion_guardia SET fecha_fin=current_date
      WHERE id_acceso=(SELECT id_acceso FROM asignacion_guardia WHERE fecha_fin IS NULL
                       GROUP BY id_acceso HAVING count(*)=1 ORDER BY id_acceso LIMIT 1)$t$,
  'P0001', 'al menos un guardia');
SELECT transmetro_test.esperar_error('T13', 'R11 municipalidad obligatoria',
  'Crear una línea sin municipalidad',
  $t$INSERT INTO linea (codigo,nombre) VALUES ('L99','Línea sin municipalidad')$t$, '23502');
SELECT transmetro_test.esperar_ok('T14', 'R8 accesos de una línea',
  'El reporte de accesos de la Línea 12 incluye todos los accesos de sus estaciones',
  $t$SELECT 1$t$,
  $t$SELECT (SELECT count(*) FROM vw_accesos_por_linea WHERE linea='L12') =
            (SELECT count(*) FROM acceso a JOIN linea_estacion le USING (id_estacion)
              WHERE le.id_linea=(SELECT id_linea FROM linea WHERE codigo='L12'))$t$);

-- ---------------- Reglas 12 y 13: distancias ----------------
SELECT transmetro_test.esperar_ok('T15', 'R12 distancia entre estaciones',
  'La distancia entre Centra Sur y El Trébol en la Línea 12 es la suma de sus tramos',
  $t$SELECT 1$t$,
  $t$SELECT fn_distancia_en_linea((SELECT id_linea FROM linea WHERE codigo='L12'),
                                   (SELECT id_estacion FROM estacion WHERE nombre='Centra Sur'),
                                   (SELECT id_estacion FROM estacion WHERE nombre='El Trébol'))
          = (SELECT km_acumulado FROM vw_linea_estaciones WHERE linea='L12' AND estacion='El Trébol')$t$);
SELECT transmetro_test.esperar_ok('T16', 'R13 distancia de la línea',
  'La Línea 12 mide 18.40 km', $t$SELECT 1$t$,
  $t$SELECT fn_distancia_linea((SELECT id_linea FROM linea WHERE codigo='L12')) = 18.40$t$);

-- ---------------- Reglas 14 y 15: alertas y espera extra ----------------
SELECT transmetro_test.esperar_ok('T17', 'R14 sin alerta',
  'Lectura de 239 pasajeros en una estación de la Línea 12 (bus de 160, umbral 240): no genera alerta',
  $t$INSERT INTO lectura_estacion (id_estacion,id_linea,fecha,pasajeros_esperando)
     VALUES (1,(SELECT id_linea FROM linea WHERE codigo='L12'),now(),239)$t$,
  $t$SELECT count(*)=0 FROM alerta WHERE id_lectura=(SELECT max(id_lectura) FROM lectura_estacion)$t$);
SELECT transmetro_test.esperar_ok('T18', 'R14 alerta',
  'Lectura de 240 pasajeros (150 % de la capacidad del bus): genera una alerta pendiente',
  $t$INSERT INTO lectura_estacion (id_estacion,id_linea,fecha,pasajeros_esperando)
     VALUES (1,(SELECT id_linea FROM linea WHERE codigo='L12'),now(),240)$t$,
  $t$SELECT count(*)=1 AND bool_and(NOT atendida) FROM alerta WHERE id_lectura=(SELECT max(id_lectura) FROM lectura_estacion)$t$);
SELECT transmetro_test.esperar_ok('T19', 'R14 atender alerta',
  'Despachar un bus de refuerzo marca la alerta como atendida',
  $t$INSERT INTO lectura_estacion (id_estacion,id_linea,fecha,pasajeros_esperando)
     VALUES (1,(SELECT id_linea FROM linea WHERE codigo='L12'),now(),300);
     SELECT fn_atender_alerta((SELECT max(id_alerta) FROM alerta),
                              (SELECT min(id_bus) FROM bus WHERE id_linea=(SELECT id_linea FROM linea WHERE codigo='L12')))$t$,
  $t$SELECT atendida AND id_bus_refuerzo IS NOT NULL FROM alerta WHERE id_alerta=(SELECT max(id_alerta) FROM alerta)$t$);
SELECT transmetro_test.esperar_ok('T20', 'R15 espera extra',
  'Bus con 39 de 160 pasajeros (24.38 %): espera 5 minutos más',
  $t$UPDATE visita SET pasajeros_a_bordo=39 WHERE id_viaje=1 AND orden=2$t$,
  $t$SELECT espera_extra_min=5 AND ocupacion_pct=24.38 FROM visita WHERE id_viaje=1 AND orden=2$t$);
SELECT transmetro_test.esperar_ok('T21', 'R15 límite del 25 %',
  'Bus con 40 de 160 pasajeros (25 %): no espera más',
  $t$UPDATE visita SET pasajeros_a_bordo=40 WHERE id_viaje=1 AND orden=2$t$,
  $t$SELECT espera_extra_min=0 AND ocupacion_pct=25.00 FROM visita WHERE id_viaje=1 AND orden=2$t$);
SELECT transmetro_test.esperar_error('T22', 'Capacidad del bus',
  'Registrar 161 pasajeros en un bus de capacidad 160',
  $t$UPDATE visita SET pasajeros_a_bordo=161 WHERE id_viaje=1 AND orden=2$t$, 'P0001', 'solo admite 160');
SELECT transmetro_test.esperar_error('T23', 'R4 bus de otra línea',
  'Programar un viaje de la Línea 6 con un bus de la Línea 12',
  $t$INSERT INTO viaje (id_linea,id_bus,id_piloto,sentido,fecha_hora_salida)
     VALUES ((SELECT id_linea FROM linea WHERE codigo='L6'),
             (SELECT min(id_bus) FROM bus WHERE id_linea=(SELECT id_linea FROM linea WHERE codigo='L12')), 1, 'IDA', now())$t$,
  'P0001', 'no está asignado a la línea');
SELECT transmetro_test.esperar_ok('T24', 'R1 visitas en orden',
  'Las visitas de un recorrido de ida siguen el orden de las estaciones de la línea',
  $t$SELECT 1$t$,
  $t$SELECT bool_and(v.orden = le.orden)
       FROM visita v JOIN viaje vj USING (id_viaje) JOIN linea_estacion le
         ON le.id_linea = vj.id_linea AND le.id_estacion = v.id_estacion
      WHERE vj.id_viaje = 1 AND vj.sentido = 'IDA'$t$);

-- ---------------- Regla 18: pagos y tarjeta de acceso ----------------
SELECT transmetro_test.esperar_error('T25', 'R18 saldo insuficiente',
  'Cobrar un pasaje de Q1.00 a una tarjeta regular con Q0.50',
  $t$UPDATE tarjeta_acceso SET id_tipo_tarjeta=1, saldo=0.50, estado='ACTIVA' WHERE id_tarjeta=1;
     INSERT INTO pago (id_tarjeta,id_metodo_pago,id_estacion,tipo,monto) VALUES (1,2,1,'COBRO_PASAJE',1)$t$,
  'P0001', 'Saldo insuficiente');
SELECT transmetro_test.esperar_ok('T26', 'R18 recarga',
  'Recargar Q20.00 en efectivo suma al saldo de la tarjeta',
  $t$UPDATE tarjeta_acceso SET saldo=0, estado='ACTIVA' WHERE id_tarjeta=1;
     INSERT INTO pago (id_tarjeta,id_metodo_pago,id_estacion,tipo,monto) VALUES (1,1,1,'RECARGA',20)$t$,
  $t$SELECT saldo=20.00 FROM tarjeta_acceso WHERE id_tarjeta=1$t$);
SELECT transmetro_test.esperar_ok('T27', 'R18 cobro con tarjeta',
  'El cobro con tarjeta estudiante descuenta Q0.50 del saldo',
  $t$UPDATE tarjeta_acceso SET id_tipo_tarjeta=2, saldo=5, estado='ACTIVA' WHERE id_tarjeta=1;
     INSERT INTO pago (id_tarjeta,id_metodo_pago,id_estacion,tipo,monto) VALUES (1,2,1,'COBRO_PASAJE',99)$t$,
  $t$SELECT saldo=4.50 AND (SELECT monto FROM pago ORDER BY id_pago DESC LIMIT 1)=0.50 FROM tarjeta_acceso WHERE id_tarjeta=1$t$);
SELECT transmetro_test.esperar_error('T28', 'R18 método de pago',
  'Recargar una tarjeta usando como método la propia tarjeta de acceso',
  $t$INSERT INTO pago (id_tarjeta,id_metodo_pago,id_estacion,tipo,monto) VALUES (1,2,1,'RECARGA',10)$t$,
  'P0001', 'no sirve para recargar');

-- ---------------- Seguridad y auditoría ----------------
SELECT transmetro_test.esperar_ok('T29', 'Auditoría',
  'Cambiar una línea deja un registro en la bitácora',
  $t$UPDATE linea SET nombre = nombre || ' ' WHERE codigo='L6'$t$,
  $t$SELECT count(*)=1 FROM bitacora WHERE tabla='linea' AND operacion='UPDATE'$t$);
SELECT transmetro_test.esperar_error('T30', 'Auditoría inalterable',
  'Modificar un registro de la bitácora',
  $t$UPDATE linea SET nombre = nombre || ' ' WHERE codigo='L6'; UPDATE bitacora SET tabla='x'$t$,
  'P0001', 'no se puede modificar');
SELECT transmetro_test.esperar_error('T31', 'Privilegios mínimos',
  'El rol de consulta intenta leer el DPI de los pilotos',
  $t$SET LOCAL ROLE tm_consulta; SELECT dpi FROM piloto$t$, '42501');
SELECT transmetro_test.esperar_ok('T32', 'Privilegios mínimos',
  'El rol de consulta lee la ficha de pilotos con el DPI enmascarado',
  $t$SET LOCAL ROLE tm_consulta$t$,
  $t$SELECT count(*) > 0 AND bool_and(dpi_enmascarado LIKE '*********%') FROM vw_pilotos_ficha$t$);
SELECT transmetro_test.esperar_error('T33', 'Privilegios mínimos',
  'El rol de operador intenta borrar un bus',
  $t$SET LOCAL ROLE tm_operador; DELETE FROM bus WHERE numero_unidad='TM-001'$t$, '42501');

-- ---------------- Pruebas de integridad adicionales ----------------
SELECT transmetro_test.esperar_error('T34', 'R9 datos del piloto',
  'Registrar un piloto sin teléfono móvil (dato de comunicación obligatorio)',
  $t$INSERT INTO piloto (dpi,nombres,apellidos,fecha_nacimiento,licencia_numero,licencia_tipo,fecha_contratacion,
                         direccion_residencia,zona,id_municipalidad_residencia,correo,
                         contacto_emergencia_nombre,contacto_emergencia_telefono)
     VALUES ('9999999999999','Prueba','Sin Telefono','1990-01-01','L-TEST-1','A',current_date,'Calle 1',1,1,
             'prueba@correo.example','Contacto','5555-5555')$t$, '23502');
SELECT transmetro_test.esperar_error('T35', 'R16 una PC por estación',
  'Instalar una segunda computadora en una estación que ya tiene una',
  $t$INSERT INTO computadora (id_estacion,hostname,ip_vpn) VALUES (1,'PC-EST-DUP','10.99.0.1')$t$, '23505');
SELECT transmetro_test.esperar_error('T36', 'R3 acceso de una estación',
  'Crear un acceso que no pertenece a ninguna estación',
  $t$INSERT INTO acceso (id_estacion,numero,nombre,tipo) VALUES (NULL,1,'Acceso huérfano','PRINCIPAL')$t$, '23502');
SELECT id, regla, descripcion, estado, obtenido FROM transmetro_test.resultado ORDER BY id;
