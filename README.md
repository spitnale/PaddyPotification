# 🔔 Paddy Potification

A live status board for all your Claude Code sessions — open it on your iPhone (or any
browser) and see every Claude window at a glance, each with a colored **light** and a
**sound** when its status changes.

| Status | Light | Meaning | Claude Code event |
|--------|-------|---------|-------------------|
| **Alert** | 🔴 red | Needs your attention / permission | `Notification` |
| **Waiting** | 🟡 amber | Finished — waiting for your next prompt | `Stop` |
| **Working** | 🔵 blue | Actively running | `UserPromptSubmit`, `PreToolUse` |
| **Active** | 🟢 green | Open & idle | `SessionStart` |
| **Nothing** | ⚪ grey | Session ended | `SessionEnd` |

## How it works

```
Claude Code session ──(hook)──▶ hooks/notify.mjs ──HTTP──▶ /api/status ──▶ in-memory store
                                                                              │
   your iPhone / browser ◀── Server-Sent Events (/api/events) ◀──────────────┘
```

Hooks in `~/.claude/settings.json` fire on every session's lifecycle events and POST a
status to this app. The dashboard streams updates live over SSE and plays a sound + flashes
a light whenever a session changes state.

## Run it

```bash
npm install          # once
npm run dev          # starts on http://0.0.0.0:4747 (reachable over your LAN)
```

- **On the Mac:** http://localhost:4747
- **On your iPhone (same WiFi):** `http://<your-mac-ip>:4747`
  *(Find your Mac's IP with `ipconfig getifaddr en0`.)*

The first time you launch, macOS may ask to **allow incoming network connections** for
Node — click **Allow** so your phone can reach it.

### Install it as an iOS app (PWA)

1. Open `http://<your-mac-ip>:4747` in **Safari** on your iPhone.
2. Tap the **Share** button → **Add to Home Screen**.
3. Launch it from the home-screen icon — it runs full-screen like a native app.
4. Tap **🔊 Enable** once (iOS only allows sound after a tap). It'll chime + flash on
   alerts while the app is open.

### Desktop & native apps (Tauri)

The dashboard also ships as a native shell (`src-tauri/` + `tauri-shell/`): a small
always-on desktop window with native notifications, always-on-top, launch-at-login, and a
collapsible rail view. Run it with `npm run tauri dev`. The same shell builds a thin iOS
app — see [TAURI.md](TAURI.md).

## Hooks

```bash
npm run install-hooks     # register status hooks in ~/.claude/settings.json (backs up first)
npm run uninstall-hooks   # remove them cleanly (backs up first)
```

Hooks only affect **new** Claude Code sessions — restart a window to start reporting.
Each install/uninstall writes a timestamped `settings.json.paddy-backup-*` next to it.

## Notes & customization

- **Status settings** (⚙︎ in the app): recolor any light and toggle its sound. Saved in
  your browser (`localStorage`). Defaults: sound on for **Alert** + **Waiting** only.
- **Your own sounds:** drop audio files into `public/sounds/<pack name>/`, one file per
  status (e.g. `alert_input.mp3`), and the pack shows up in the **Sound pack** picker
  under "Your sounds". Any status without a file falls back to the built-in beep. See
  [`public/sounds/README.md`](public/sounds/README.md) for the filename list.
- **State is in-memory** — restarting the dev server clears the board; sessions repopulate
  as hooks fire again.
- **Custom port / host:** the hook reporter posts to `http://127.0.0.1:4747` by default.
  Override with the `PADDY_URL` env var if you change the port.
- **Keep it always-on:** `npm run build && npm start` runs the production server; add it to
  a login item or a `pm2`/`launchd` service if you want it running in the background.

## Next steps (ideas)

- **Background push** even when the app is closed: pipe alerts to the free
  [ntfy.sh](https://ntfy.sh) app (add a POST to `ntfy.sh/<your-topic>` in `notify.mjs`).
- Tap a card to reveal the full path / last message.
- Auto-expire stale sessions after N minutes of silence.
