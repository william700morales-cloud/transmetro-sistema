-- =====================================================================
-- Archivo 02: funciones y disparadores (triggers) que aplican las reglas del enunciado
-- =====================================================================
SET search_path TO transmetro, public;

-- Lectura de parámetros ------------------------------------------------
CREATE OR REPLACE FUNCTION fn_parametro(p_clave TEXT) RETURNS NUMERIC
LANGUAGE sql STABLE AS $$
    SELECT valor FROM parametro_sistema WHERE clave = p_clave
$$;

-- Distancia entre dos estaciones contiguas, sin importar el orden del par (regla 12)
CREATE OR REPLACE FUNCTION fn_distancia_tramo(p_a INT, p_b INT) RETURNS NUMERIC
LANGUAGE sql STABLE AS $$
    SELECT distancia_km FROM tramo
     WHERE id_estacion_a = LEAST(p_a, p_b) AND id_estacion_b = GREATEST(p_a, p_b)
$$;

-- Distancia entre dos estaciones de la misma línea: suma de los tramos intermedios (regla 12)
CREATE OR REPLACE FUNCTION fn_distancia_en_linea(p_linea INT, p_a INT, p_b INT) RETURNS NUMERIC
LANGUAGE sql STABLE AS $$
    WITH ord AS (
        SELECT id_estacion, orden,
               LAG(id_estacion) OVER (ORDER BY orden) AS anterior
          FROM linea_estacion WHERE id_linea = p_linea
    ), limites AS (
        SELECT MIN(orden) AS o1, MAX(orden) AS o2
          FROM ord WHERE id_estacion IN (p_a, p_b)
    )
    SELECT SUM(fn_distancia_tramo(o.anterior, o.id_estacion))
      FROM ord o, limites l
     WHERE o.orden > l.o1 AND o.orden <= l.o2 AND o.anterior IS NOT NULL
$$;

-- Distancia total de una línea (regla 13)
CREATE OR REPLACE FUNCTION fn_distancia_linea(p_linea INT) RETURNS NUMERIC
LANGUAGE sql STABLE AS $$
    SELECT COALESCE(SUM(fn_distancia_tramo(anterior, id_estacion)), 0)
      FROM (SELECT id_estacion,
                   LAG(id_estacion) OVER (ORDER BY orden) AS anterior
              FROM linea_estacion WHERE id_linea = p_linea) t
     WHERE anterior IS NOT NULL
$$;

-- ---------------------------------------------------------------------
-- Regla 5: buses por línea entre N y 2N (N = número de estaciones)
-- El máximo se exige siempre; el mínimo, cuando la línea está ACTIVA.
-- Se valida al final de la transacción para poder mover varios buses a la vez.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_validar_flota_linea(p_id_linea INT) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
    v_estado TEXT; v_cod TEXT; v_est INT; v_bus INT; v_min INT; v_max INT;
BEGIN
    SELECT estado, codigo INTO v_estado, v_cod FROM linea WHERE id_linea = p_id_linea;
    IF NOT FOUND THEN RETURN; END IF;
    SELECT count(*) INTO v_est FROM linea_estacion WHERE id_linea = p_id_linea;
    SELECT count(*) INTO v_bus FROM bus WHERE id_linea = p_id_linea;
    v_min := ceil(v_est * fn_parametro('FLOTA_MIN_POR_ESTACION'));
    v_max := floor(v_est * fn_parametro('FLOTA_MAX_POR_ESTACION'));
    IF v_bus > v_max THEN
        RAISE EXCEPTION 'Línea %: tiene % buses y el máximo permitido es % (el doble de sus % estaciones)',
            v_cod, v_bus, v_max, v_est USING ERRCODE = 'P0001';
    END IF;
    IF v_estado = 'ACTIVA' AND v_bus < v_min THEN
        RAISE EXCEPTION 'Línea %: una línea ACTIVA necesita al menos % buses (uno por estación) y tiene %',
            v_cod, v_min, v_bus USING ERRCODE = 'P0001';
    END IF;
END $$;

CREATE OR REPLACE FUNCTION trg_bus_flota() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP IN ('INSERT','UPDATE') AND NEW.id_linea IS NOT NULL THEN
        PERFORM fn_validar_flota_linea(NEW.id_linea);
    END IF;
    IF TG_OP IN ('UPDATE','DELETE') AND OLD.id_linea IS NOT NULL
       AND (TG_OP = 'DELETE' OR OLD.id_linea IS DISTINCT FROM NEW.id_linea) THEN
        PERFORM fn_validar_flota_linea(OLD.id_linea);
    END IF;
    RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER ct_bus_flota
    AFTER INSERT OR UPDATE OF id_linea OR DELETE ON bus
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trg_bus_flota();

CREATE OR REPLACE FUNCTION trg_linea_flota() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_TABLE_NAME = 'linea' THEN
        PERFORM fn_validar_flota_linea(NEW.id_linea);
    ELSIF TG_OP = 'DELETE' THEN
        PERFORM fn_validar_flota_linea(OLD.id_linea);
    ELSE
        PERFORM fn_validar_flota_linea(NEW.id_linea);
    END IF;
    RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER ct_linea_estado
    AFTER UPDATE OF estado ON linea
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trg_linea_flota();
CREATE CONSTRAINT TRIGGER ct_linea_estacion_flota
    AFTER INSERT OR DELETE ON linea_estacion
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trg_linea_flota();

-- ---------------------------------------------------------------------
-- Regla 2: toda estación pertenece al menos a una línea
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_estacion_con_linea() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_id INT; v_nom TEXT;
BEGIN
    v_id := CASE WHEN TG_TABLE_NAME = 'estacion' THEN NEW.id_estacion ELSE OLD.id_estacion END;
    SELECT nombre INTO v_nom FROM estacion WHERE id_estacion = v_id;
    IF FOUND AND NOT EXISTS (SELECT 1 FROM linea_estacion WHERE id_estacion = v_id) THEN
        RAISE EXCEPTION 'La estación % debe pertenecer al menos a una línea', v_nom USING ERRCODE = 'P0001';
    END IF;
    RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER ct_estacion_con_linea
    AFTER INSERT ON estacion
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trg_estacion_con_linea();
CREATE CONSTRAINT TRIGGER ct_linea_estacion_borrado
    AFTER DELETE ON linea_estacion
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trg_estacion_con_linea();

-- ---------------------------------------------------------------------
-- Regla 10: al menos un guardia vigente por acceso
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_acceso_con_guardia() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_ids INT[]; v_id INT; v_nom TEXT;
BEGIN
    IF TG_TABLE_NAME = 'acceso' THEN
        v_ids := ARRAY[NEW.id_acceso];
    ELSIF TG_OP = 'DELETE' THEN
        v_ids := ARRAY[OLD.id_acceso];
    ELSE
        v_ids := ARRAY[OLD.id_acceso, NEW.id_acceso];
    END IF;
    FOREACH v_id IN ARRAY v_ids LOOP
        SELECT e.nombre || ', acceso ' || a.numero INTO v_nom
          FROM acceso a JOIN estacion e USING (id_estacion) WHERE a.id_acceso = v_id;
        IF FOUND AND NOT EXISTS (SELECT 1 FROM asignacion_guardia
                                  WHERE id_acceso = v_id AND fecha_fin IS NULL) THEN
            RAISE EXCEPTION 'El acceso % (%) debe tener al menos un guardia de seguridad vigente', v_id, v_nom
                USING ERRCODE = 'P0001';
        END IF;
    END LOOP;
    RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER ct_acceso_con_guardia
    AFTER INSERT ON acceso
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trg_acceso_con_guardia();
CREATE CONSTRAINT TRIGGER ct_guardia_retiro
    AFTER UPDATE OR DELETE ON asignacion_guardia
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trg_acceso_con_guardia();

-- ---------------------------------------------------------------------
-- Reglas 6 y 7: cada bus tiene parqueo; el parqueo no puede exceder su capacidad
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_bus_parqueo_capacidad() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_cap INT; v_uso INT; v_nom TEXT;
BEGIN
    SELECT capacidad_buses, nombre INTO v_cap, v_nom FROM parqueo WHERE id_parqueo = NEW.id_parqueo;
    SELECT count(*) INTO v_uso FROM bus WHERE id_parqueo = NEW.id_parqueo AND id_bus <> NEW.id_bus;
    IF v_uso >= v_cap THEN
        RAISE EXCEPTION 'El parqueo % está lleno (capacidad % buses)', v_nom, v_cap USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER tg_bus_parqueo_capacidad
    BEFORE INSERT OR UPDATE OF id_parqueo ON bus
    FOR EACH ROW EXECUTE FUNCTION trg_bus_parqueo_capacidad();

-- Historial de cambios de parqueo
CREATE OR REPLACE FUNCTION trg_bus_parqueo_historial() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO bus_parqueo_historial (id_bus, id_parqueo) VALUES (NEW.id_bus, NEW.id_parqueo);
    ELSIF NEW.id_parqueo IS DISTINCT FROM OLD.id_parqueo THEN
        UPDATE bus_parqueo_historial SET hasta = now() WHERE id_bus = NEW.id_bus AND hasta IS NULL;
        INSERT INTO bus_parqueo_historial (id_bus, id_parqueo) VALUES (NEW.id_bus, NEW.id_parqueo);
    END IF;
    RETURN NULL;
END $$;

CREATE TRIGGER tg_bus_parqueo_historial
    AFTER INSERT OR UPDATE OF id_parqueo ON bus
    FOR EACH ROW EXECUTE FUNCTION trg_bus_parqueo_historial();

-- ---------------------------------------------------------------------
-- Recorridos: el bus debe estar asignado a la línea del viaje (regla 4)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_viaje_valida() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_linea INT;
BEGIN
    SELECT id_linea INTO v_linea FROM bus WHERE id_bus = NEW.id_bus;
    IF v_linea IS DISTINCT FROM NEW.id_linea THEN
        RAISE EXCEPTION 'El bus % no está asignado a la línea del viaje', NEW.id_bus USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER tg_viaje_valida
    BEFORE INSERT OR UPDATE OF id_bus, id_linea ON viaje
    FOR EACH ROW EXECUTE FUNCTION trg_viaje_valida();

-- Genera las visitas planificadas de un viaje, en el orden de la línea (regla 1)
CREATE OR REPLACE FUNCTION fn_generar_visitas(p_id_viaje INT) RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE
    v viaje%ROWTYPE; r RECORD; t TIMESTAMP; prev_est INT; d NUMERIC; n INT := 0;
BEGIN
    SELECT * INTO v FROM viaje WHERE id_viaje = p_id_viaje;
    t := v.fecha_hora_salida;
    FOR r IN SELECT id_estacion FROM linea_estacion WHERE id_linea = v.id_linea
              ORDER BY CASE WHEN v.sentido = 'IDA' THEN orden END ASC,
                       CASE WHEN v.sentido = 'VUELTA' THEN orden END DESC
    LOOP
        IF prev_est IS NOT NULL THEN
            d := COALESCE(fn_distancia_tramo(prev_est, r.id_estacion), 1.0);
            t := t + (d / fn_parametro('VELOCIDAD_PROMEDIO_KMH') * 60) * INTERVAL '1 minute';
        END IF;
        n := n + 1;
        INSERT INTO visita (id_viaje, id_estacion, orden, hora_programada)
        VALUES (p_id_viaje, r.id_estacion, n, date_trunc('minute', t));
        t := t + fn_parametro('ESPERA_BASE_MIN') * INTERVAL '1 minute';
        prev_est := r.id_estacion;
    END LOOP;
    RETURN n;
END $$;

-- Regla 15: si el bus no llena el 25 % de su capacidad espera 5 minutos más en la estación
CREATE OR REPLACE FUNCTION trg_visita_ocupacion() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_cap INT; v_linea INT;
BEGIN
    SELECT b.capacidad_pasajeros, v.id_linea INTO v_cap, v_linea
      FROM viaje v JOIN bus b ON b.id_bus = v.id_bus WHERE v.id_viaje = NEW.id_viaje;
    IF NOT EXISTS (SELECT 1 FROM linea_estacion WHERE id_linea = v_linea AND id_estacion = NEW.id_estacion) THEN
        RAISE EXCEPTION 'La estación % no pertenece a la línea del viaje', NEW.id_estacion USING ERRCODE = 'P0001';
    END IF;
    IF NEW.pasajeros_a_bordo IS NULL THEN
        NEW.ocupacion_pct := NULL;
        NEW.espera_extra_min := 0;
    ELSE
        IF NEW.pasajeros_a_bordo > v_cap THEN
            RAISE EXCEPTION 'El bus solo admite % pasajeros y se registraron %', v_cap, NEW.pasajeros_a_bordo
                USING ERRCODE = 'P0001';
        END IF;
        NEW.ocupacion_pct := round(100.0 * NEW.pasajeros_a_bordo / v_cap, 2);
        NEW.espera_extra_min := CASE WHEN NEW.ocupacion_pct < fn_parametro('OCUPACION_MIN_PCT')
                                     THEN fn_parametro('ESPERA_EXTRA_MIN')::INT ELSE 0 END;
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER tg_visita_ocupacion
    BEFORE INSERT OR UPDATE ON visita
    FOR EACH ROW EXECUTE FUNCTION trg_visita_ocupacion();

-- ---------------------------------------------------------------------
-- Regla 14: alerta cuando la estación acumula 50 % más que la capacidad de un bus
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_lectura_valida() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM linea_estacion WHERE id_linea = NEW.id_linea AND id_estacion = NEW.id_estacion) THEN
        RAISE EXCEPTION 'La estación % no pertenece a la línea %', NEW.id_estacion, NEW.id_linea USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END $$;

-- La alerta se crea después de insertar la lectura, para poder enlazar su identificador
CREATE OR REPLACE FUNCTION trg_lectura_alerta_after() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_cap INT; v_umbral INT; v_est TEXT; v_lin TEXT;
BEGIN
    SELECT MIN(capacidad_pasajeros) INTO v_cap FROM bus WHERE id_linea = NEW.id_linea;
    IF v_cap IS NULL THEN RETURN NULL; END IF;
    v_umbral := ceil(v_cap * fn_parametro('ALERTA_AFORO_PCT') / 100.0);
    IF NEW.pasajeros_esperando >= v_umbral THEN
        SELECT nombre INTO v_est FROM estacion WHERE id_estacion = NEW.id_estacion;
        SELECT codigo INTO v_lin FROM linea WHERE id_linea = NEW.id_linea;
        INSERT INTO alerta (id_estacion, id_linea, id_lectura, fecha, pasajeros_esperando, umbral, mensaje)
        VALUES (NEW.id_estacion, NEW.id_linea, NEW.id_lectura, NEW.fecha, NEW.pasajeros_esperando, v_umbral,
                format('Estación %s: %s pasajeros esperando (umbral %s = %s%% de la capacidad de un bus). Enviar otro bus de la línea %s.',
                       v_est, NEW.pasajeros_esperando, v_umbral, fn_parametro('ALERTA_AFORO_PCT')::INT, v_lin));
    END IF;
    RETURN NULL;
END $$;

CREATE TRIGGER tg_lectura_valida BEFORE INSERT ON lectura_estacion
    FOR EACH ROW EXECUTE FUNCTION trg_lectura_valida();
CREATE TRIGGER tg_lectura_alerta AFTER INSERT ON lectura_estacion
    FOR EACH ROW EXECUTE FUNCTION trg_lectura_alerta_after();

-- Despacho del bus de refuerzo que atiende una alerta
CREATE OR REPLACE FUNCTION fn_atender_alerta(p_id_alerta BIGINT, p_id_bus INT) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE v_linea INT; v_bus_linea INT; v_ya BOOLEAN;
BEGIN
    SELECT id_linea, atendida INTO v_linea, v_ya FROM alerta WHERE id_alerta = p_id_alerta;
    IF NOT FOUND THEN RAISE EXCEPTION 'La alerta % no existe', p_id_alerta USING ERRCODE = 'P0001'; END IF;
    IF v_ya THEN RAISE EXCEPTION 'La alerta % ya fue atendida', p_id_alerta USING ERRCODE = 'P0001'; END IF;
    SELECT id_linea INTO v_bus_linea FROM bus WHERE id_bus = p_id_bus;
    IF NOT FOUND THEN RAISE EXCEPTION 'El bus % no existe', p_id_bus USING ERRCODE = 'P0001'; END IF;
    IF v_bus_linea IS NOT NULL AND v_bus_linea <> v_linea THEN
        RAISE EXCEPTION 'El bus % pertenece a otra línea', p_id_bus USING ERRCODE = 'P0001';
    END IF;
    UPDATE alerta SET atendida = TRUE, id_bus_refuerzo = p_id_bus, fecha_atencion = now()
     WHERE id_alerta = p_id_alerta;
END $$;

-- ---------------------------------------------------------------------
-- Regla 18: pagos con tarjeta de acceso y otros métodos
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_pago_aplica() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE m metodo_pago%ROWTYPE; t tarjeta_acceso%ROWTYPE; v_tarifa NUMERIC;
BEGIN
    SELECT * INTO m FROM metodo_pago WHERE id_metodo_pago = NEW.id_metodo_pago;
    IF NEW.tipo = 'RECARGA' THEN
        IF NEW.id_tarjeta IS NULL THEN
            RAISE EXCEPTION 'Una recarga necesita una tarjeta de acceso' USING ERRCODE = 'P0001';
        END IF;
        IF NOT m.permite_recarga THEN
            RAISE EXCEPTION 'El método "%" no sirve para recargar', m.nombre USING ERRCODE = 'P0001';
        END IF;
        IF NEW.monto <= 0 THEN
            RAISE EXCEPTION 'El monto de la recarga debe ser mayor que cero' USING ERRCODE = 'P0001';
        END IF;
        UPDATE tarjeta_acceso SET saldo = saldo + NEW.monto
         WHERE id_tarjeta = NEW.id_tarjeta AND estado = 'ACTIVA';
        IF NOT FOUND THEN
            RAISE EXCEPTION 'La tarjeta no existe o no está activa' USING ERRCODE = 'P0001';
        END IF;
    ELSIF m.usa_saldo_tarjeta THEN
        IF NEW.id_tarjeta IS NULL THEN
            RAISE EXCEPTION 'El cobro con tarjeta de acceso necesita el número de tarjeta' USING ERRCODE = 'P0001';
        END IF;
        SELECT t2.* INTO t FROM tarjeta_acceso t2 WHERE t2.id_tarjeta = NEW.id_tarjeta;
        SELECT tarifa INTO v_tarifa FROM tipo_tarjeta WHERE id_tipo_tarjeta = t.id_tipo_tarjeta;
        IF t.estado <> 'ACTIVA' THEN
            RAISE EXCEPTION 'La tarjeta % está %', t.numero, t.estado USING ERRCODE = 'P0001';
        END IF;
        IF t.saldo < v_tarifa THEN
            RAISE EXCEPTION 'Saldo insuficiente: la tarjeta % tiene Q% y la tarifa es Q%', t.numero, t.saldo, v_tarifa
                USING ERRCODE = 'P0001';
        END IF;
        UPDATE tarjeta_acceso SET saldo = saldo - v_tarifa WHERE id_tarjeta = NEW.id_tarjeta;
        NEW.monto := v_tarifa;
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER tg_pago_aplica BEFORE INSERT ON pago
    FOR EACH ROW EXECUTE FUNCTION trg_pago_aplica();

-- ---------------------------------------------------------------------
-- Auditoría: bitácora que solo admite inserciones
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_auditar() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_fila JSONB;
BEGIN
    v_fila := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
    INSERT INTO bitacora (tabla, operacion, id_registro, detalle)
    VALUES (TG_TABLE_NAME, TG_OP, v_fila ->> TG_ARGV[0], v_fila);
    RETURN NULL;
END $$;

CREATE TRIGGER aud_linea       AFTER INSERT OR UPDATE OR DELETE ON linea
    FOR EACH ROW EXECUTE FUNCTION trg_auditar('id_linea');
CREATE TRIGGER aud_bus         AFTER INSERT OR UPDATE OR DELETE ON bus
    FOR EACH ROW EXECUTE FUNCTION trg_auditar('id_bus');
CREATE TRIGGER aud_linea_est   AFTER INSERT OR UPDATE OR DELETE ON linea_estacion
    FOR EACH ROW EXECUTE FUNCTION trg_auditar('id_linea');
CREATE TRIGGER aud_tarjeta     AFTER UPDATE OR DELETE ON tarjeta_acceso
    FOR EACH ROW EXECUTE FUNCTION trg_auditar('id_tarjeta');
CREATE TRIGGER aud_guardia_asig AFTER INSERT OR UPDATE OR DELETE ON asignacion_guardia
    FOR EACH ROW EXECUTE FUNCTION trg_auditar('id_asignacion');
CREATE TRIGGER aud_alerta      AFTER UPDATE ON alerta
    FOR EACH ROW EXECUTE FUNCTION trg_auditar('id_alerta');

CREATE OR REPLACE FUNCTION trg_bitacora_inmutable() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'La bitácora de auditoría no se puede modificar ni borrar' USING ERRCODE = 'P0001';
END $$;

CREATE TRIGGER tg_bitacora_inmutable BEFORE UPDATE OR DELETE ON bitacora
    FOR EACH ROW EXECUTE FUNCTION trg_bitacora_inmutable();
