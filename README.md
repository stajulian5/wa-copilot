# WA Copilot ✈️

A local-first WhatsApp CRM for KAMs — Kanban pipeline, chat panel, AI suggestions, and Google Sheets sync. Runs entirely on your Mac.

![Kanban screenshot](docs/kanban.png)

---

## Requirements

- **macOS** (Apple Silicon or Intel)
- **Node.js 18+** — [download](https://nodejs.org)
- **Your WhatsApp account** (personal number — scanned via QR, just like WhatsApp Web)

---

## Install & run

```bash
# 1. Clone
git clone https://github.com/stajulian5/wa-copilot.git
cd wa-copilot

# 2. Install dependencies
npm install

# 3. Start
npm run dev
```

On first launch you'll see a QR code. Open WhatsApp on your phone → **Linked Devices** → **Link a Device** → scan. Your contacts and message history sync automatically.

---

## Build a distributable (.dmg)

```bash
npm run build        # compile
npm run dist:mac     # package as .dmg / .app
```

The packaged app appears in `dist/`.

---

## Features

| Feature | Description |
|---|---|
| **Kanban pipeline** | 4 columns: New → Open Conversation → Waiting For → All Resolved |
| **Chat panel** | Full message history, send messages, voice note / image / video labels |
| **Auto-reopen** | Resolved contacts move back to New when they reply |
| **AI suggestions** | Claude Haiku drafts a reply — press ⌘↵ to send |
| **Google Sheets sync** | Pulls contact names from a broker sheet |
| **Snooze** | Hide a card until a chosen time |
| **Multi-account** | Connect multiple WhatsApp numbers simultaneously |
| **Group messages** | Sender name shown on cards and in chat bubbles |

---

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `⌘K` | Focus search |
| `Esc` | Close chat panel |
| `Enter` | Send message |
| `⌘↵` | Accept & send AI suggestion |
| `⌘,` | Open settings |

---

## Architecture

```
wa-copilot/
├── electron/
│   ├── main.ts          # Electron main process
│   ├── preload.ts       # Context bridge (IPC)
│   └── baileys.ts       # WhatsApp session (Baileys library)
├── src/
│   ├── app/             # React renderer
│   │   ├── components/  # UI components
│   │   ├── stores/      # Zustand state
│   │   ├── pages/       # Kanban, Settings, Onboarding
│   │   └── hooks/       # useWhatsApp, useSnooze
│   └── server/
│       ├── db/          # Drizzle ORM + SQLite migrations
│       ├── routes/      # Express REST API
│       └── services/    # AI, Google Sheets, sync
├── WA Copilot - Sync Contacts/    # Optional: sync contact names from WA Web
└── electron-builder.yml
```

**Stack:** Electron · React 18 · Zustand · Tailwind CSS · Baileys · better-sqlite3 · Drizzle ORM · Express · Claude API (Anthropic)

All data is stored locally in `~/Library/Application Support/WA Copilot/crm.sqlite`. Nothing leaves your machine except outgoing WhatsApp messages and optional AI API calls.

---

## First-time setup tips

- **History sync** takes 1–3 minutes on first link (depends on how many messages you have).
- The app must be **running** to receive messages in real-time. When closed, messages queue in WhatsApp and are delivered on next launch (up to ~150 messages).
- Leave your Mac in **sleep** rather than shutting it down to minimise message gaps.

---

## Optional: Chrome extension

The `WA Copilot - Sync Contacts/` folder contains a small browser extension that syncs contact names from WhatsApp Web into Copilot.

To install: Chrome → `chrome://extensions` → **Load unpacked** → select the `WA Copilot - Sync Contacts/` folder.

---

## License

Private — Mica internal use.
