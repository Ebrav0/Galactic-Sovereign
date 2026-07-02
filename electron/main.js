const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

// Slot whitelist enforced here — never trust the renderer.
const VALID_SLOTS = ['autosave', 'slot-1', 'slot-2', 'slot-3', 'exit-save'];

let mainWindow = null;

function saveDir() {
  return path.join(app.getPath('documents'), 'Galactic Sovereign', 'saves');
}

function slotPath(slot) {
  if (!VALID_SLOTS.includes(slot)) {
    throw new Error(`Invalid save slot: ${slot}`);
  }
  return path.join(saveDir(), `${slot}.json`);
}

async function ensureSaveDir() {
  await fsp.mkdir(saveDir(), { recursive: true });
}

function registerSaveIpc() {
  ipcMain.handle('save:write', async (_event, slot, envelopeJson) => {
    try {
      if (typeof envelopeJson !== 'string') throw new Error('Payload must be a string');
      await ensureSaveDir();
      // Write to a temp file then rename so a crash never corrupts an existing save.
      const target = slotPath(slot);
      const tmp = `${target}.tmp`;
      await fsp.writeFile(tmp, envelopeJson, 'utf8');
      await fsp.rename(tmp, target);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  });

  ipcMain.handle('save:read', async (_event, slot) => {
    try {
      const data = await fsp.readFile(slotPath(slot), 'utf8');
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  });

  ipcMain.handle('save:list', async () => {
    try {
      await ensureSaveDir();
      const saves = [];
      for (const slot of VALID_SLOTS) {
        try {
          const raw = await fsp.readFile(slotPath(slot), 'utf8');
          const stat = await fsp.stat(slotPath(slot));
          let savedAt = null;
          let saveVersion = null;
          try {
            const parsed = JSON.parse(raw);
            savedAt = parsed.savedAt ?? null;
            saveVersion = parsed.saveVersion ?? null;
          } catch {
            // Unreadable JSON still gets listed so the player knows the file exists.
          }
          saves.push({ slot, savedAt, saveVersion, sizeBytes: stat.size });
        } catch {
          // Slot file doesn't exist — skip.
        }
      }
      return { ok: true, saves };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  });

  ipcMain.handle('save:delete', async (_event, slot) => {
    try {
      await fsp.unlink(slotPath(slot));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: 'Galactic Sovereign',
    backgroundColor: '#05070f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (DEV_SERVER_URL) {
    mainWindow.loadURL(DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  // Ask the renderer to write an exit-save before the window closes.
  let exitSaveDone = false;
  mainWindow.on('close', (event) => {
    if (exitSaveDone || mainWindow.webContents.isDestroyed()) return;
    event.preventDefault();
    const finish = () => {
      exitSaveDone = true;
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
    };
    // Give the renderer up to 2s to persist, then close regardless.
    const timeout = setTimeout(finish, 2000);
    ipcMain.once('exit-save:done', () => {
      clearTimeout(timeout);
      finish();
    });
    mainWindow.webContents.send('exit-save:request');
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  await ensureSaveDir();
  registerSaveIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Single-window game: closing the window quits the app on every platform.
app.on('window-all-closed', () => {
  app.quit();
});
