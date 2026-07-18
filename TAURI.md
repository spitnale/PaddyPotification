# 📱 Paddy Potification — native iOS app (Tauri)

This wraps the dashboard in a real native iOS app. The app is a **thin native shell**: it
shows a connect screen, then loads the live dashboard served by your Mac. Because the UI
comes from your Mac, **editing the dashboard (`app/page.js`) shows up instantly in the app —
no rebuild needed.** Only changes to the native shell or config require a rebuild.

```
iPhone (Tauri app / WKWebView)  ──http──▶  your Mac (npm run dev, port 4747)
        launcher → connects to http://<your-mac>.local:4747
```

The Mac server must be running and both devices on the **same Wi-Fi**.

---

## ✅ Already done for you

- Rust + iOS targets (`aarch64-apple-ios`, `-sim`, `x86_64-apple-ios`)
- CocoaPods, Tauri CLI (`@tauri-apps/cli`)
- Tauri project scaffolded in `src-tauri/` (identifier `com.spitnale.paddy`)
- App icons generated from the bell logo
- Launcher shell in `tauri-shell/` (asks for your Mac's address on first launch, then auto-connects)
- iOS network-permission patch script (`npm run patch-ios`)

## ⛔ The one thing you must do: install Xcode

iOS builds require the **full Xcode** (the Command Line Tools alone aren't enough).

1. Install **Xcode** from the Mac App Store (large download).
2. Point the toolchain at it and accept the license:
   ```bash
   sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
   sudo xcodebuild -license accept
   xcodebuild -runFirstLaunch
   ```

---

## ▶️ Run it in the iOS Simulator (no Apple account needed)

```bash
# Terminal 1 — the data source (leave running)
npm run dev

# Terminal 2 — build the iOS project once, then launch the simulator
npm run ios:init      # generates the Xcode project + patches network permissions
npm run ios:dev       # pick a simulator; the app builds & opens
```

On the simulator, `*.local` resolves through your Mac, so it connects automatically.

## 📲 Run it on your actual iPhone

1. Add your Apple ID in **Xcode → Settings → Accounts** (a free Apple ID works).
2. Set the signing team, either via Xcode or an env var:
   ```bash
   open src-tauri/gen/apple/*.xcodeproj
   # Target → Signing & Capabilities → "Automatically manage signing" → choose your Team
   ```
   …or grab your Team ID and:
   ```bash
   export APPLE_DEVELOPMENT_TEAM=XXXXXXXXXX
   ```
3. Plug in the iPhone (or use the same Wi-Fi), then:
   ```bash
   npm run ios:dev      # select your iPhone from the device list
   ```
4. First launch on the phone:
   - **Settings → General → VPN & Device Management** → trust your developer cert.
   - When the app asks to **find devices on your local network**, tap **Allow**.

**Signing note:** a *free* Apple ID re-signs for ~7 days (just re-run when it expires). The
**$99/yr Apple Developer Program** gives ~1-year signing + TestFlight for hands-off installs.

## 📦 Build an installable app (release)

```bash
npm run ios:build       # needs a signing team; outputs an .ipa under src-tauri/gen/apple/build
```

---

## Changing which Mac / address it connects to

- First launch asks for your Mac's address (e.g. `http://your-mac.local:4747`, or its
  LAN IP) — it's remembered on the device. To switch later, tap **Change address** on the
  connect screen.
- To bake in a default, edit `DEFAULT_URL` in `tauri-shell/index.html`.

## Troubleshooting

- **Blank / can't connect:** is `npm run dev` running on the Mac? Same Wi-Fi? Try the LAN IP
  (`ipconfig getifaddr en0`) instead of the `.local` name via "Change address".
- **"could not find team":** set `APPLE_DEVELOPMENT_TEAM` or pick a team in Xcode signing.
- **Re-ran `ios:init` and lost the ATS keys:** run `npm run patch-ios` again.
