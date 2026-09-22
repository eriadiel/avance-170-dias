# Avance 170 días

Seguimiento independiente de Science, English 8, Pre-Algebra, U.S. History 8 y Bible 8 (Acts; Proverbs). Cada materia contiene los 170 Daily Guides extraídos de los PDF proporcionados por el propietario.

## Contenido y procedencia

`data/curriculum.json.gz` contiene 850 lecciones. Cada una conserva texto completo, secciones del manual, menciones de evaluaciones/proyectos y páginas PDF de origen. `data/source-manifest.json` identifica los PDF por nombre y SHA-256. Se mantienen el idioma y las referencias del manual; no se añaden instrucciones ni materiales a días que no los especifican. Los bloques opcionales Level Up de Pre-Algebra permanecen con la lección que los introduce. Las menciones de evaluaciones no se convierten en eventos inventados.

Para repetir la extracción con los mismos cinco archivos y Python + pdfplumber:

```
python scripts/extract_manuals.py DIRECTORIO_PDF DIRECTORIO_SALIDA
```

El resultado está en `DIRECTORIO_SALIDA/manuals/curriculum.json`. Comprimir su JSON como gzip para sustituir el archivo de datos. El extractor usa posiciones y orden de columnas; reconoce correcciones superpuestas de números de lección y excluye pies de página y el mensaje de despedida.

## Progreso y roles

La clave de `class_progress` es `(student_id, class_id, day)`. Un día global está completo si y solo si sus cinco materias están completas para ese estudiante. La verificación global requiere además cinco estados `verified`. Una devolución del tutor conserva la declaración del estudiante, pero elimina la verificación; el estudiante puede corregir o desmarcar su trabajo.

Los estudiantes solo consultan y modifican su propio avance. Los tutores seleccionan estudiantes y verifican o devuelven lecciones ya completadas. Cambiar el trabajo o la evidencia vuelve la revisión a `pending` únicamente para esa materia y día. Guardar sin cambios conserva la revisión.

## Base de datos y despliegue

`database/upgrade.sql` es el SQL de la actualización aplicada mediante la herramienta de migraciones de Supabase (`five_class_progress_preserve_science`). Ejecutarlo una sola vez sobre el esquema original. Copia Science sin cambiar notas, fechas o verificaciones, conserva `progress` y sincroniza escrituras de la versión antigua durante el despliegue. Comprueba la igualdad de los datos dentro de la transacción.

La aplicación accede a PostgreSQL desde Express mediante `DATABASE_URL`. No usa Supabase Auth ni expone directamente tablas a clientes. RLS está habilitado y se revocan permisos de `anon` y `authenticated`; la conexión del servidor debe conservar sus permisos privados. Las sesiones se almacenan en `user_sessions`, con clave primaria `sid`.

Configurar `DATABASE_URL`, `SESSION_SECRET` y `NODE_ENV=production` en el gestor de variables de Vercel. No guardar sus valores en el repositorio. Las cuentas existentes se conservan; no se crean cuentas demo al arrancar.

```
pnpm install --frozen-lockfile
pnpm test
pnpm start
```

La integración GitHub–Vercel despliega `main`. `/health` comprueba la tabla nueva y devuelve `version: 2` y `classes: 5`. Las APIs requieren una sesión, usan `Cache-Control: no-store` y rechazan escrituras de otros orígenes. El inicio de sesión regenera y guarda la sesión antes de responder; el cierre la elimina de PostgreSQL.

## Pruebas

Las pruebas ejecutan PostgreSQL local embebido (PGlite), la migración real, Express y el almacén real de sesiones. Cubren preservación de Science, sincronización durante el despliegue, claves independientes, regla global 5/5, roles, aislamiento entre estudiantes, entradas inválidas, verificación, devolución, reinicio del servidor y cierre de sesión. El catálogo se verifica contra 5 × 170 lecciones numeradas y con procedencia.

La validación en navegador cubre inicio de sesión, guardado de cinco materias, recarga, vista de 170 días, lección 170, pantalla móvil y revisión del tutor. Las pruebas de producción usan cuentas temporales y las eliminan al terminar.
