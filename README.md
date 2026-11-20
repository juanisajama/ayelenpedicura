# Ayelen Pedicura – sitio con reservas
Cloudflare Pages + Functions + D1 (base de datos). Sin build: se publica tal cual.

## Pasos
1. Subí esta carpeta a un repo de GitHub.
2. Instalá `npm i -g wrangler` y `wrangler login`.
3. Base de datos: `wrangler d1 create ayelen` → copiá el `database_id` en `wrangler.toml`. Luego `wrangler d1 execute ayelen --remote --file=schema.sql`.
4. Cloudflare → Workers & Pages → Create → Pages → Connect to Git → elegí el repo (build command vacío, output `public`).
5. En el proyecto → Settings → Bindings: D1 con nombre `DB` apuntando a `ayelen`. En Variables y secretos agregá:
   - `MP_ACCESS_TOKEN`: access token de producción de Mercado Pago (Tus integraciones).
   - `SESSION_SECRET`: texto largo aleatorio.
   - `ADMIN_HASH`: `node -e "console.log(require('crypto').createHash('sha256').update('SESSION_SECRET_ACA'+'TU_CLAVE').digest('hex'))"`
6. Mercado Pago → tu integración → Webhooks → URL `https://TU-DOMINIO/api/mp/webhook`, evento "Pagos".
7. Panel: `https://TU-DOMINIO/admin.html`. En **Ajustes** podés cambiar la seña, los datos de pago, WhatsApp, horarios y política de reservas; en **Precios de servicios** podés editar, activar o pausar servicios. Los cambios se guardan en D1 y se reflejan en la web pública y en las próximas reservas.
   - Desde el panel podés cargar y editar turnos. Los nuevos quedan como “Pendiente de validación”; al editar un turno con seña pagada se conserva ese importe y se recalcula el saldo/crédito.
   - Para agregar el Tratamiento Antimicótico a una base D1 ya creada: `wrangler d1 execute ayelen --remote --command "INSERT OR IGNORE INTO services (id,category,name,description,price,minutes,active) VALUES ('p5','Pedicura','Tratamiento Antimicótico','Cuidado de uñas con posibles signos compatibles con hongos. Consultá con un profesional de la salud para confirmar el diagnóstico y definir el tratamiento adecuado.',25000,60,1)"`.
   - Precio de prueba por cantidad: el primer dedo usa `services.price` ($25.000) y cada adicional suma `settings.antimicotico_extra_price` ($2.500). Para una D1 ya creada: `wrangler d1 execute ayelen --remote --command "INSERT OR IGNORE INTO settings (key,value) VALUES ('antimicotico_extra_price','2500')"`; cambiá esos dos importes cuando definas los precios reales.
8. Fotos: poné archivos en `public/img/` (ver LEEME.txt) y hacé push.

## Vista previa local
Un servidor estático simple no ejecuta las Pages Functions y por eso la disponibilidad y el panel no funcionan allí. Inicializá la D1 local con `npx wrangler d1 execute ayelen --local --file=schema.sql`, configurá `SESSION_SECRET` y `ADMIN_HASH` en `.dev.vars` (ver el paso 5) y ejecutá `npx wrangler pages dev`. El archivo `.dev.vars` no se sube a Git.

## Notas
- Seguridad: la confirmación de pago solo ocurre desde el webhook, que vuelve a consultar el pago a Mercado Pago. Agregá una regla de Rate Limiting de Cloudflare a `/api/admin/login`.
- Turnos duplicados: lo impide la clave primaria de `slots` (fecha + bloque).
- Backups: `wrangler d1 export ayelen --remote --output=backup.sql` (D1 también tiene Time Travel).
