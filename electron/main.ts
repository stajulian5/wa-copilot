import { app, BrowserWindow, ipcMain, Notification, nativeTheme, Menu, shell, dialog } from 'electron'

app.setName('WhatsApp Copilot')
// Pin userData to a stable path so re-naming the app never loses data
app.setPath('userData', app.getPath('appData') + '/WhatsApp Copilot')

// ── Single-instance lock ───────────────────────────────────────────────────────
// Prevents two copies of the app running simultaneously, which would cause WA
// connection conflicts (error 440: connectionReplaced) and data races.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from '../src/server/db/schema'
import { startServer, serverEvents } from '../src/server/index'
import { startBaileys, getWAStatus } from './baileys'
import { googleAuthEvents } from '../src/server/googleAuth'

// ─── Paths ────────────────────────────────────────────────────────────────────

export const userData = app.getPath('userData')
export const dbPath = join(userData, 'crm.sqlite')
export const authPath = join(userData, 'baileys_auth')
export const configPath = join(userData, 'config.json')

if (!existsSync(authPath)) mkdirSync(authPath, { recursive: true })

// ─── DB ───────────────────────────────────────────────────────────────────────

const sqlite = new Database(dbPath)
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('foreign_keys = ON')

export const db = drizzle(sqlite, { schema })

const migrationsFolder = join(__dirname, '../../src/server/db/migrations')
if (existsSync(migrationsFolder)) {
  // Disable FK enforcement before migrate so Drizzle's internal transaction can
  // DROP and recreate tables that are referenced by other tables (e.g. contacts → messages).
  // PRAGMA foreign_keys cannot be changed inside a transaction, so it must be set here.
  sqlite.pragma('foreign_keys = OFF')
  migrate(db, { migrationsFolder })
  sqlite.pragma('foreign_keys = ON')
}

// ─── Window ───────────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'WhatsApp Copilot',
    titleBarStyle: 'hiddenInset',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1a1a1a' : '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  // Request notification permission (macOS)
  if (process.platform === 'darwin') {
    // Electron handles this via Notification.isSupported()
  }

  const port = await startServer(db, userData)

  // Respond synchronously to preload's port request
  ipcMain.on('server:port-sync', (e) => { e.returnValue = port })

  // Google OAuth: open system browser → Express callback fires → notify renderer
  ipcMain.handle('google:openAuth', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/oauth/google/start`)
    const data = await r.json() as any
    if (data.error) throw new Error(data.error)
    shell.openExternal(data.url)
  })

  googleAuthEvents.on('connected', () => {
    mainWindow?.webContents.send('google:authComplete')
  })

  // Chrome extension synced contact names → tell renderer to reload contacts
  serverEvents.on('contactsUpdated', () => {
    mainWindow?.webContents.send('wa:historySynced')
  })

  // Set custom menu so macOS menu bar shows "WhatsApp Copilot" instead of "Electron"
  const appMenu = Menu.buildFromTemplate([
    {
      label: app.getName(),
      submenu: [
        { role: 'about' as const },
        { type: 'separator' as const },
        { role: 'services' as const },
        { type: 'separator' as const },
        { role: 'hide' as const },
        { role: 'hideOthers' as const },
        { role: 'unhide' as const },
        { type: 'separator' as const },
        { role: 'quit' as const }
      ]
    },
    { role: 'editMenu' as const },
    { role: 'viewMenu' as const },
    { role: 'windowMenu' as const }
  ])
  Menu.setApplicationMenu(appMenu)

  createWindow()
  await startBaileys(db, mainWindow!, port)

  // Check for updates on launch (delayed 10 s so the app finishes booting first)
  // then repeat every 24 hours.
  setTimeout(checkForUpdates, 10_000)
  setInterval(checkForUpdates, 24 * 60 * 60 * 1000)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ─── IPC: notifications ───────────────────────────────────────────────────────

ipcMain.handle('notify', (_e, title: string, body: string) => {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show()
  }
})

ipcMain.handle('set-badge', (_e, count: number) => {
  if (process.platform === 'darwin') {
    app.dock.setBadge(count > 0 ? String(count) : '')
  }
})

ipcMain.handle('get-user-data-path', () => userData)

// ─── File picker (#4 send media) ─────────────────────────────────────────────

ipcMain.handle('app:pickFile', async () => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Imágenes',   extensions: ['jpg','jpeg','png','gif','webp'] },
      { name: 'Videos',     extensions: ['mp4','mov','avi','mkv'] },
      { name: 'Audio',      extensions: ['mp3','ogg','wav','m4a','opus'] },
      { name: 'Documentos', extensions: ['pdf','doc','docx','xlsx','xls','pptx','ppt','csv','txt'] },
      { name: 'Todos',      extensions: ['*'] },
    ]
  })
  if (result.canceled || !result.filePaths.length) return null
  return result.filePaths[0]
})

// ─── Chrome extension helpers ─────────────────────────────────────────────────

// Return the bundled chrome-extension folder path.
// In packaged app: inside .app/Contents/Resources/chrome-extension
// In dev: project root chrome-extension/
const extensionDir = app.isPackaged
  ? join(process.resourcesPath, 'chrome-extension')
  : join(__dirname, '../../chrome-extension')

ipcMain.handle('app:getExtensionPath', () => extensionDir)

// Open the extension folder in Finder so the user can drag-select it
ipcMain.handle('app:openExtensionInFinder', () => {
  shell.openPath(extensionDir)
})

// Open Chrome directly to the extensions management page
ipcMain.handle('app:openChromeExtensions', () => {
  // macOS: `open -a "Google Chrome"` honours chrome:// URLs
  const { exec } = require('child_process')
  exec('open -a "Google Chrome" "chrome://extensions/"', (err: any) => {
    if (err) {
      // Fallback: open browser to a plain help URL
      shell.openExternal('https://support.google.com/chrome/answer/2664769')
    }
  })
})

// ─── Update checker ───────────────────────────────────────────────────────────

const GITHUB_REPO = 'stajulian5/wa-copilot'
const CURRENT_VERSION = app.getVersion()          // from package.json

async function checkForUpdates() {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      { headers: { 'User-Agent': 'WhatsApp-Copilot-Updater' } }
    )
    if (!res.ok) return
    const data = await res.json() as { tag_name?: string; html_url?: string }
    const latest = (data.tag_name ?? '').replace(/^v/, '')
    if (latest && isNewerVersion(latest, CURRENT_VERSION)) {
      console.log(`[updater] new version available: ${latest} (current: ${CURRENT_VERSION})`)
      mainWindow?.webContents.send('app:updateAvailable', {
        version: latest,
        url: data.html_url ?? `https://github.com/${GITHUB_REPO}/releases/latest`
      })
    }
  } catch (e) {
    // Network error — silently ignore
  }
}

/** Returns true if `a` is strictly newer than `b` using semver-ish comparison. */
function isNewerVersion(a: string, b: string): boolean {
  const parse = (v: string) => v.split('.').map(n => parseInt(n, 10) || 0)
  const [aMaj, aMin, aPat] = parse(a)
  const [bMaj, bMin, bPat] = parse(b)
  if (aMaj !== bMaj) return aMaj > bMaj
  if (aMin !== bMin) return aMin > bMin
  return aPat > bPat
}

ipcMain.handle('app:openReleasePage', (_e, url: string) => {
  shell.openExternal(url)
})

