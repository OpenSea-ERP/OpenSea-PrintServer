# Satellite Runtime Migration — Manual UAT

**Migration commit:** `fa258ff` (PrintServer adopts `@opensea/satellite-runtime@v0.2.0`)
**Date:** 2026-05-03
**Tested by:** _to be filled by Guilherme_

This checklist covers the smoke validation of PrintServer after migrating to
the runtime. Run on a real Windows installation (`npm run dist:win`), not in
dev mode (auto-launch is no-op in dev by design).

## Pre-conditions

- Build with `npm run dist:win`
- Install the resulting NSIS installer on a Windows machine
- Pair the device against production (`https://opensea-api.fly.dev`)

## Smoke checklist

### Boot & lifecycle

- [ ] App launches without the Electron welcome screen (`electron.exe path-to-app`)
- [ ] Log file `%APPDATA%/opensea-print-server/logs/main.log` contains the
      runtime initialization line: `[satellite-runtime/log] initialized (scope=print-server, level=info)`
- [ ] Tray icon appears in system tray with tooltip "OpenSea Print Server"

### Single-instance

- [ ] Launch the app again while it is already running
- [ ] Second launch terminates immediately
- [ ] Original window is focused (or shown if minimized to tray)

### Auto-launch

- [ ] Settings → Auto-launch toggle is OFF (matches default)
- [ ] Toggle ON; restart Windows
- [ ] After login, the app auto-starts hidden (only tray icon visible)
- [ ] Registry entry `HKCU\Software\Microsoft\Windows\CurrentVersion\Run\OpenSea Print Server` points to the installed `.exe` (NOT `node_modules\electron`)
- [ ] Toggle OFF; verify registry entry is removed
- [ ] No stray `electron` entry in the Run key (the bug from commit `266ab07` does not return)

### Tray menu

- [ ] Right-click tray → menu shows: Abrir / Status / Versão / Verificar Atualizações / Mostrar OpenSea Print Server / Sair
- [ ] Status flips between "Online"/"Offline" as WS connects/disconnects
- [ ] Versão shows `1.6.3` (or current)
- [ ] "Verificar Atualizações" opens the main window and triggers manual check
- [ ] Double-clicking tray icon focuses main window
- [ ] "Sair" terminates the app cleanly (no zombie process in Task Manager)

### Window-state persistence

- [ ] Open main window
- [ ] Move it to a different position
- [ ] Close to tray
- [ ] Re-open via tray "Abrir"
- [ ] Window appears in the same position as before

### Graceful shutdown

- [ ] Trigger Sair from tray
- [ ] Log shows `[satellite-runtime/shutdown] running 2 handlers` then
      `[satellite-runtime/shutdown] all handlers completed`
- [ ] No timeout warnings appear
- [ ] App process exits within ~2s

### Store / migrations

- [ ] First-run defaults: `apiUrl=https://opensea-api.fly.dev`, `autoLaunch=true`, `minimizeToTray=true`
- [ ] If upgrading from a 1.6.x install, existing settings (paired device, apiUrl) are preserved
- [ ] If a stale `apiUrl` is set (e.g., `http://localhost:3333` in a packaged build),
      it is auto-rewritten to `https://opensea-api.fly.dev` on next boot

### Print flow (regression check)

- [ ] Pair the device
- [ ] Trigger a test print from the OpenSea ERP web UI
- [ ] Job arrives, prints successfully, ack returns to backend
- [ ] Tray Notification appears: "Impressão concluída"

## Deferred follow-ups

Not implemented in this migration; tracked separately:

- **Splash window** — boot is fast (~1s), a splash adds visual noise. Add only if a slow-boot scenario emerges.
- **Quit-prompt dialog** — current PrintServer has a `minimizeToTray` boolean
  in store. A future change can replace it with `showQuitPrompt` from runtime
  to give the user a per-close choice with "remember me".

## Sign-off

- [ ] All checks above pass on Windows 10/11 packaged build
- [ ] Date of UAT: ****\_\_\_****
- [ ] Tested by: ****\_\_\_****
- [ ] Notes: ****\_\_\_****
