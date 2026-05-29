import { app, BrowserWindow, ipcMain, Notification, nativeTheme, Menu } from 'electron'

app.setName('WhatsApp Copilot')
// Pin userData to a stable path so re-naming the app never loses data
app.setPath('userData', app.getPath('appData') + '/WhatsApp Copilot')
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from '../src/server/db/schema'
import { startServer } from '../src/server/index'
import { startBaileys, getWAStatus } from './baileys'

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
  migrate(db, { migrationsFolder })
}

// ─── Window ───────────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
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
