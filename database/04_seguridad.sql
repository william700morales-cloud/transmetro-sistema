-- =====================================================================
-- Archivo 04: seguridad en la base de datos (roles, privilegios mínimos, datos sensibles)
-- =====================================================================
SET search_path TO transmetro, public;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tm_consulta') THEN CREATE ROLE tm_consulta NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tm_operador') THEN CREATE ROLE tm_operador NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tm_admin')    THEN CREATE ROLE tm_admin    NOLOGIN; END IF;
END $$;

GRANT USAGE ON SCHEMA transmetro TO tm_consulta, tm_operador, tm_admin;

-- Consulta: solo lectura, sin DPI de pilotos, guardias ni operadores (se leen enmascarados en las vistas)
GRANT SELECT ON ALL TABLES IN SCHEMA transmetro TO tm_consulta;
REVOKE SELECT ON piloto, guardia, operador, bitacora FROM tm_consulta;
GRANT SELECT (id_piloto, nombres, apellidos, licencia_tipo, activo) ON piloto TO tm_consulta;
GRANT SELECT (id_guardia, nombres, apellidos, activo) ON guardia TO tm_consulta;
GRANT SELECT (id_operador, nombres, apellidos, usuario, turno, id_computadora, activo) ON operador TO tm_consulta;

-- Operador de estación: consulta y registra lecturas, visitas y pagos; atiende alertas
GRANT SELECT ON ALL TABLES IN SCHEMA transmetro TO tm_operador;
GRANT INSERT ON lectura_estacion, pago, visita, viaje TO tm_operador;
GRANT UPDATE (hora_llegada_real, pasajeros_a_bordo) ON visita TO tm_operador;
GRANT UPDATE (atendida, id_bus_refuerzo, fecha_atencion) ON alerta TO tm_operador;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA transmetro TO tm_operador;
GRANT EXECUTE ON FUNCTION fn_atender_alerta(BIGINT, INT), fn_generar_visitas(INT) TO tm_operador;

-- Administrador: control total del esquema, pero la bitácora solo admite inserciones
GRANT ALL ON ALL TABLES IN SCHEMA transmetro TO tm_admin;
GRANT ALL ON ALL SEQUENCES IN SCHEMA transmetro TO tm_admin;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA transmetro TO tm_admin;
REVOKE UPDATE, DELETE, TRUNCATE ON bitacora FROM tm_admin, tm_operador, tm_consulta;
