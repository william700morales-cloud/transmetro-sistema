# Transmetro Guatemala: sistema de control de líneas, estaciones y flota

Propuesta de consultoría con aplicación web, base de datos PostgreSQL, diagramas y documentos.
Todo el material está en este repositorio.

## Qué contiene

| Carpeta | Contenido |
| --- | --- |
| `database/` | Scripts SQL en orden (01 estructuras, 02 reglas, 03 vistas, 04 seguridad, 05 datos, 06 reportes, 07 pruebas) y el generador de datos |
| `src/` | Aplicación web (React 18, Vite 6, Tailwind 4) |
| `docs/diagramas/` | Fuentes `.mmd` y imágenes de los diagramas ER, UML y Gantt |
| `docs/capturas/` | Capturas de la aplicación |
| `docs/entregables/` | Documento unificado (PDF), resumen ejecutivo (PPTX), presentación y guion del video |

## Cómo ejecutar la aplicación

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # genera dist/ para publicar
```

La base de datos PostgreSQL se ejecuta dentro del navegador con PGlite (PostgreSQL en WebAssembly)
y se carga con los mismos scripts de `database/`. Los datos se guardan en el navegador;
el botón **Restablecer datos** de la pestaña *Base de datos* vuelve al estado inicial.

## Cómo crear la base de datos en un servidor PostgreSQL

```bash
createdb transmetro
for f in 01_schema 02_funciones_triggers 03_vistas 04_seguridad 05_seed 07_pruebas; do
  psql -d transmetro -f database/$f.sql
done
```

El archivo `07_pruebas.sql` ejecuta 36 pruebas automáticas de las reglas del caso y muestra el resultado.

## Pestañas de la aplicación

* **Líneas y flota**: líneas, estaciones en orden, distancias, flota por línea (entre N y 2N buses), parqueos.
* **Estación del operador**: PC y operadores, pasajeros en espera y alertas (150 % de la capacidad de un bus), visitas y espera adicional (menos de 25 %), accesos y guardias, recargas y cobros.
* **Reportes SQL**: 17 reportes con su consulta, exportación a CSV e impresión.
* **Base de datos**: estado del motor, pruebas de reglas, consola SQL.
* **Centro de control C5 (simulación)**: flota, molinete, seguridad, pasajeros y operadores simulados en memoria.

## Publicación

Cada cambio en la rama `main` ejecuta `.github/workflows/publicar.yml`, que compila la aplicación y la publica en GitHub Pages.
En *Settings → Pages* hay que elegir **GitHub Actions** como origen.

## Datos

Los nombres, documentos, teléfonos y correos son ficticios. Los nombres de estaciones son referenciales y las
distancias son ilustrativas; deben sustituirse por datos reales de cada municipalidad.

## Credenciales de prueba del módulo de operadores (simulación)

PIN de operadores: OP-01 = 1111, OP-02 = 2222, OP-03 = 3333, OP-04 = 4444.
