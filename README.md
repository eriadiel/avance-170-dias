# Avance 170 días

Sistema web de seguimiento académico basado en el manual **SC08D Science.pdf**.

## Arquitectura de producción

- Node.js + Express
- PostgreSQL administrado
- Sesiones persistentes en PostgreSQL
- Frontend HTML/CSS/JS
- Despliegue recomendado: Railway

## Ejecutar localmente

Requiere Node.js 20+ y PostgreSQL.

1. Copia `.env.example` a `.env`.
2. Configura `DATABASE_URL` y `SESSION_SECRET`.
3. Ejecuta:

```bash
npm install
npm start
```

Abre `http://localhost:3000`.

### Usuarios demo

- Tutor: `tutor@example.com` / `tutor123`
- Estudiante: `student@example.com` / `student123`

Cambia estas credenciales antes de entregar el sistema a usuarios reales.

## Despliegue en Railway

1. Sube este proyecto a un repositorio privado de GitHub.
2. En Railway crea un proyecto nuevo desde ese repositorio.
3. Añade un servicio PostgreSQL dentro del mismo proyecto.
4. En el servicio de la aplicación configura:
   - `NODE_ENV=production`
   - `SESSION_SECRET=<clave aleatoria larga>`
   - `DATABASE_URL=<referencia a la URL privada de PostgreSQL de Railway>`
5. Railway ejecutará `npm start` y usará `/health` como health check.
6. Genera el dominio público de Railway.
7. Comprueba `/health`, inicio de sesión de tutor y estudiante y el flujo de verificación.

## Seguridad antes de producción

- Cambiar/eliminar las cuentas demo.
- Usar una `SESSION_SECRET` aleatoria y privada.
- No subir `.env` a GitHub.
- Mantener HTTPS habilitado.
- Crear relación tutor-estudiante antes de tener varios tutores.
- Añadir recuperación de contraseña y límites contra intentos de inicio de sesión.
- Configurar copias de seguridad de PostgreSQL según el plan contratado.