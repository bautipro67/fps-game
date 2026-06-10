// Proceso principal de Electron: arranca el servidor del juego y abre la ventana.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

const PORT = process.env.PORT || '3000';
let started = false;

// Inicia el servidor (server.js es ESM → import dinámico desde este CJS)
async function startServer() {
  if (started) return;
  started = true;
  process.env.PORT = PORT;
  await import(pathToFileURL(path.join(__dirname, '..', 'server.js')).href);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 740,
    backgroundColor: '#0b0e14',
    title: 'FPS Arena',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, backgroundThrottling: false },
  });
  const url = `http://localhost:${PORT}`;
  const load = () => win.loadURL(url).catch(() => {});
  // si el servidor todavía no está listo, reintenta
  win.webContents.on('did-fail-load', () => setTimeout(load, 400));
  load();
  return win;
}

app.whenReady().then(async () => {
  try { await startServer(); } catch (e) { console.error('Error al iniciar el servidor:', e); }
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
