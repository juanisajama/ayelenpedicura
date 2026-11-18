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
7. Panel: `https://TU-DOMINIO/admin.html`. Datos bancarios, WhatsApp, % de seña y horarios: tabla `settings` (`wrangler d1 execute ayelen --remote --command "UPDATE settings SET value='20' WHERE key='deposit_pct'"`).
   - Para agregar el Tratamiento Antimicótico a una base D1 ya creada: `wrangler d1 execute ayelen --remote --command "INSERT OR IGNORE INTO services (id,category,name,description,price,minutes,active) VALUES ('p5','Pedicura','Tratamiento Antimicótico','Cuidado de uñas con posibles signos compatibles con hongos. Consultá con un profesional de la salud para confirmar el diagnóstico y definir el tratamiento adecuado.',25000,60,1)"`.
   - Precio de prueba por cantidad: el primer dedo usa `services.price` ($25.000) y cada adicional suma `settings.antimicotico_extra_price` ($2.500). Para una D1 ya creada: `wrangler d1 execute ayelen --remote --command "INSERT OR IGNORE INTO settings (key,value) VALUES ('antimicotico_extra_price','2500')"`; cambiá esos dos importes cuando definas los precios reales.
8. Fotos: poné archivos en `public/img/` (ver LEEME.txt) y hacé push.

## Notas
- Seguridad: la confirmación de pago solo ocurre desde el webhook, que vuelve a consultar el pago a Mercado Pago. Agregá una regla de Rate Limiting de Cloudflare a `/api/admin/login`.
- Turnos duplicados: lo impide la clave primaria de `slots` (fecha + bloque).
- Backups: `wrangler d1 export ayelen --remote --output=backup.sql` (D1 también tiene Time Travel).
