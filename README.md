# FPS Arena — Multijugador Online

Shooter en primera persona multijugador con bots IA, pickups de armas, botiquines,
headshots, sistema de puntajes y partidas de 5 minutos. Funciona en **navegador**,
como **PWA instalable** y como **app de escritorio (.exe)**.

## Requisitos
[Node.js](https://nodejs.org) 18 o superior.

## Jugar en el navegador (PC)
```bash
cd fps-game
npm install
npm start
```
Abrí **http://localhost:3000**. Para varios jugadores, abrí varias pestañas o
entrá desde otros equipos por la IP de tu red.

## Jugar desde el celular (misma red Wi-Fi)
1. Al arrancar el server (`npm start`), la consola muestra la **URL del celular**
   (algo como `http://192.168.x.x:3000`). Entrá a esa dirección desde el teléfono.
2. **Si no conecta, es el firewall de Windows.** Abrí PowerShell **como Administrador** y ejecutá:
   ```powershell
   New-NetFirewallRule -DisplayName "FPS Arena 3000" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3000 -Profile Private
   ```
3. El celular debe estar en la **misma Wi-Fi** (no datos móviles ni red de invitados).

En móvil aparecen **controles táctiles**: joystick para moverse, arrastrar para mirar
y botones de disparo, apuntar, recargar, saltar, agacharse y recoger arma.
El botón **☰** abre el menú (sensibilidad de cámara y volver al lobby).

## Instalar como app (PWA)
Entrando desde el celular:
- **Android (Chrome):** menú ⋮ → *Instalar app* / *Agregar a pantalla de inicio*.
- **iPhone (Safari):** Compartir → *Agregar a inicio*.

> La instalación completa de PWA en Android requiere HTTPS. Por LAN (`http://`),
> en iPhone funciona a pantalla completa y en Android queda como acceso directo.

## App de escritorio (.exe con Electron)
La app de escritorio trae el servidor adentro: al abrirla hostea la partida y abre
el juego; otros (PC o celular) pueden unirse a esa máquina por la red.

Probar sin empaquetar:
```bash
npm run app
```
Generar el instalable/portable de Windows (queda en `dist/`):
```bash
npm run dist
```

## Controles
| Tecla / Botón | Acción |
|---------------|--------|
| `WASD` / joystick | Moverse |
| `Shift` | Correr |
| `C` | Agacharse |
| Ratón / arrastrar | Mirar |
| Clic izq. / DISPARO | Disparar |
| Clic der. / MIRA | Apuntar (precisión) |
| `Espacio` | Saltar |
| `R` | Recargar |
| `E` | Recoger arma |
| `TAB` | Marcador |
| `M` | Silenciar |
| `ESC` / `☰` | Menú (sensibilidad, volver al lobby) |

## Estructura
```
server.js            Servidor autoritativo (estado, daño, IA, puntajes, timer)
electron/main.cjs    Wrapper de escritorio (arranca server + ventana)
scripts/gen-icons.mjs Generador de íconos de la PWA
public/
  index.html         Interfaz (HUD, menús, táctil)
  manifest.json      Manifiesto PWA
  sw.js              Service worker
  css/style.css
  js/main.js         Cliente Three.js (render, controles, red)
  js/audio.js        Motor de sonido procedural
  icons/             Íconos de la app
```
