# Guía: jugar con amigos por internet + publicar en Steam

## A) Que tus amigos jueguen desde sus casas (PC, por internet)

La clave: tu PC corre el **servidor** y hay que hacerlo accesible desde internet.
No requiere que tus amigos descarguen nada: **entran por una URL en el navegador**.

### Opción 1 — Túnel con Cloudflare (la más fácil, recomendada) ⭐
No hace falta tocar el router. Da una URL **HTTPS** (mejor para audio y PWA).

1. En tu PC, arrancá el juego:
   ```bash
   cd D:\fps-game
   npm start
   ```
2. Descargá **cloudflared** (un solo .exe):
   https://github.com/cloudflare/cloudflared/releases
   → bajá `cloudflared-windows-amd64.exe` (renombralo a `cloudflared.exe`).
3. En otra terminal, en la carpeta donde lo bajaste:
   ```bash
   cloudflared tunnel --url http://localhost:3000
   ```
4. Te imprime una URL tipo:
   ```
   https://palabras-al-azar.trycloudflare.com
   ```
5. **Pasale esa URL a tus amigos.** La abren en el navegador (PC o celular) y a jugar.

> La URL cambia cada vez que reinicias cloudflared. Tu PC debe quedar encendida
> con `npm start` + cloudflared corriendo mientras juegan.

### Opción 2 — Reenvío de puertos (sin programas extra)
1. Arrancá el server (`npm start`).
2. En tu router, reenviá el puerto externo **3000 (TCP)** hacia la IP local de tu PC.
3. Averiguá tu **IP pública** (buscá "cuál es mi ip" en Google).
4. Tus amigos entran a `http://TU-IP-PUBLICA:3000`.

> Contras: expone el puerto a internet (menos seguro), no es HTTPS, y si tu ISP
> usa CGNAT no vas a tener IP pública directa (no funciona).

### Opción 3 — Hosting en la nube (siempre online, sin tu PC) ⭐ para "cuando quieran"
Subís el servidor a un hosting gratis de Node y queda una URL fija 24/7.
Ejemplos: **Render**, **Railway**, **Fly.io**.

Pasos (Render, resumido):
1. Subí el proyecto a un repo de **GitHub**.
2. En render.com → New → **Web Service** → conectá el repo.
3. Build command: `npm install` · Start command: `node server.js`.
4. Te da una URL `https://tujuego.onrender.com` → la comparten y juegan cuando quieran.

> El plan gratis "duerme" tras inactividad (tarda unos segundos en despertar).

---

## B) Publicar el juego en Steam

Es un proceso real (tiene costo y revisión). Resumen honesto:

1. **Cuenta de Steamworks**: registrate en https://partner.steamgames.com,
   aceptá los acuerdos y pagá la **Steam Direct fee: USD 100 por juego**
   (se recupera tras vender USD 1.000).
2. **Empaquetá el juego como app de escritorio**: ya lo tenés con Electron
   (`dist\win-unpacked\FPS Arena.exe`). Steam distribuye ejecutables; ese sirve.
   La app trae el servidor adentro (modo anfitrión + cliente).
3. **Creá la app en Steamworks**: obtenés un **App ID** y armás la **página de tienda**
   (descripción, capturas, imágenes "capsule" en tamaños específicos, tráiler,
   requisitos, precio, clasificación por edad).
4. **Subí el build con SteamPipe**: con el SDK de Steamworks (`ContentBuilder`/`steamcmd`)
   definís un **depot**, subís los archivos (la carpeta `win-unpacked`) y marcás el
   ejecutable de lanzamiento (`FPS Arena.exe`).
5. **Probá** desde Steam (rama por defecto) y **enviá a revisión**: Valve revisa el
   build y la página (tarda días). La tienda debe estar publicada ~2 semanas antes
   del lanzamiento.
6. (Opcional) **Integrar Steamworks SDK** para logros, amigos y multijugador nativo
   de Steam. Con Electron se hace con bindings como `steamworks.js`. Para multijugador
   "de verdad" en Steam conviene usar Steam Networking en vez de IP/túnel.

> Realidad: cuesta USD 100, requiere assets de tienda y pasa por revisión. Un juego
> hecho con Electron SÍ puede estar en Steam (hay muchos), pero hay que pulir y cumplir
> los requisitos de la tienda.

### Alternativa más rápida que Steam: **itch.io**
Gratis y sin revisión. Podés subir el ZIP de la app (`FPS-Arena-win-x64.zip`) o incluso
una versión web jugable. Ideal para compartir ya mismo mientras evaluás Steam.
