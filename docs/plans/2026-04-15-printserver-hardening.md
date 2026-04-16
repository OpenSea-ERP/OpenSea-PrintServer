# Print Server Hardening Plan (46 issues)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Track progress with checkboxes.

**Goal:** Corrigir os 46 problemas identificados na análise técnica do OpenSea-PrintServer (segurança, robustez WS, print real, lifecycle, build).

**Architecture:** Refatoração incremental agrupada por arquivo para localizar mudanças, commit por wave. Sem testes automatizados no projeto — verificação via `npm run build` + revisão manual.

**Tech Stack:** Electron 33, TypeScript 5.7, React 19, ws, electron-store, electron-updater, keytar.

**Execution order:** waves 1→2→3→4→5→6 sequencial. Dentro de cada wave, commits atômicos por arquivo. Paralelização desnecessária dado volume sequencial de edits em arquivos adjacentes.

---

## Wave 1 — Build config & deps (quick wins, base) [Commit 1]

**Files:** `tsconfig.main.json`, `package.json`

- [ ] Adicionar `"asar": true` em `build` (#31)
- [ ] `"sourceMap": false` em `tsconfig.main.json` (#40)
- [ ] Instalar `keytar` como dep (para wave 2) (#36, #1)
- [ ] Build: `npm install && npm run build:main`

## Wave 2 — Secret storage via keytar + store hardening [Commit 2]

**File:** `src/main/store.ts`

- [ ] Criar helper `secureToken` em novo arquivo `src/main/secure-store.ts` usando `keytar.setPassword/getPassword/deletePassword` para `deviceToken`
- [ ] Em `store.ts`: remover `deviceToken` do schema; manter apenas `agentId/agentName/apiUrl/autoLaunch/minimizeToTray/pairingCode`
- [ ] Adicionar try/catch de recuperação: se `new Store()` lançar, deletar arquivo corrompido e recriar (#27)
- [ ] Migração 1.5.0: se existir `deviceToken` legacy na store, mover para keytar e apagar da store
- [ ] Atualizar todos os call-sites de `store.get('deviceToken')` → `getDeviceToken()` async e `store.set('deviceToken', ...)` → `setDeviceToken()` async
  Arquivos: `main.ts:29`, `ipc-handlers.ts:75,105`

Fixes: #1, #27, #42

## Wave 3 — Preload channel whitelist + IPC timeout [Commit 3]

**Files:** `src/main/preload.ts`, `src/renderer/hooks/useIpc.ts`, `src/renderer/preload.d.ts`

- [ ] `preload.ts`: whitelist de canais permitidos (invoke + on). Rejeitar canais fora da lista.
- [ ] `useIpc.ts`: `invokeIpc` com `Promise.race` timeout 30s (#24)
- [ ] `useIpc.ts`: `useIpcEvent` usar `useRef` para handler estável (#20)
- [ ] Build verificar

Fixes: #2, #20, #24

## Wave 4 — WebSocket hardening [Commit 4]

**File:** `src/main/ws-client.ts`, `src/main/main.ts`

- [ ] Mover token de query string para header `Authorization: Bearer` via opções do `new WebSocket(url, { headers })` (#5)
- [ ] `maxPayload: 10 * 1024 * 1024` na opção do WebSocket (#21)
- [ ] Validação `isValidIncomingMessage(obj)`: checar `type`, tipos de campos, `copies` em [1,999], `jobId` string, `printerId` string non-empty, `data` base64 válido (#3)
- [ ] Heartbeat: enviar `ping` WebSocket nativo (não JSON) e setar `pong` handler + timeout de 10s pra reconectar se não receber pong (#8)
- [ ] `doConnect()`: se `this.ws` existe, `removeAllListeners()` + close antes de `null` (#13, #22)
- [ ] Adicionar `protocolVersion: '1.0'` em mensagem inicial após open (#30)
- [ ] `maxMessageSize` validation defensiva no handler de 'message'
- [ ] Build verificar

Fixes: #3, #5, #8, #13, #21, #22, #30

## Wave 5 — Print handler safe + completo [Commit 5]

**File:** `src/main/print-handler.ts`

- [ ] Substituir `exec` + string por `spawn(cmd, [args])` para PowerShell e `lp` — argumentos como array, sem escape manual (#4)
- [ ] Validar `copies` 1-999 (#28)
- [ ] Detectar formato: PDF/PS/RAW via magic bytes (#34)
- [ ] Verificar se impressora existe antes (import detectPrinters + find) (#15)
- [ ] Kill forçado no spawn ao estourar timeout (#10)
- [ ] Build verificar

Fixes: #4, #10, #15, #28, #34

## Wave 6 — Implementar handler do comando `print` em main.ts + lifecycle [Commit 6]

**File:** `src/main/main.ts`

- [ ] No `onMessage`: quando `type === 'print'`, decodificar base64 → Buffer, chamar `executePrint`, enviar `print-result` via `wsClient.send` (#7)
- [ ] Mapear `printerId` para `printerName`: usar nome direto (convenção atual é nome) — documentar em comentário
- [ ] Notification OS no sucesso/falha (#39) (opt-in leve: console+log, Notification só se store.get('notifications') futuro)
- [ ] Enum consistente: criar `src/main/printer-status.ts` com enum `PrinterStatus` e mapper (#18)
- [ ] Remover `as any` (#11)
- [ ] `before-quit`: async — wsClient.disconnect() + aguardar 500ms (#38)
- [ ] Build verificar

Fixes: #7, #11, #18, #39, #38

## Wave 7 — IPC handlers hardening [Commit 7]

**File:** `src/main/ipc-handlers.ts`

- [ ] Rate limiter simples in-memory (Map<channel, lastTime>): `printers:list` 5s, `agent:pair` 10s, `updater:check` 30s (#6)
- [ ] Validação `isValidApiUrl`: URL válida, protocolo http(s), em prod apenas https (#12)
- [ ] `fetch` com `mode: 'cors', credentials: 'omit'` e `signal: AbortSignal.timeout(15_000)` (#35)
- [ ] Sanitizar `agentName/agentId` em log (#16)
- [ ] Audit log de pairing (prefixo do código, hostname, timestamp) (#26)
- [ ] `agent:unpair`: `disconnectWebSocket()` ANTES do fetch (#19)
- [ ] Suporte proxy via env `HTTPS_PROXY` usando Electron built-in `net.fetch` ou agente via `undici`/`https-proxy-agent` quando disponível (#33)
- [ ] Build verificar

Fixes: #6, #12, #16, #19, #26, #33, #35

## Wave 8 — Printer detector robustez [Commit 8]

**File:** `src/main/printer-detector.ts`

- [ ] Validar estrutura JSON PowerShell: itens devem ter `Name: string`. Se inválido, fallback wmic com log claro (#14)
- [ ] Expor `refreshPrinterCache()` e plug-and-play basic: ao receber `request-printers`, forçar `clearPrinterCache()` antes de detectar (#25)
- [ ] Build verificar

Fixes: #14, #25

## Wave 9 — Updater + logs + single-instance feedback [Commit 9]

**Files:** `src/main/updater.ts`, `src/main/main.ts`, `src/main/store.ts`

- [ ] Log rotation: `log.transports.file.maxSize = 10MB` em `main.ts` (#29)
- [ ] Updater error surface: não engolir com `.catch(log.error)` silencioso — propagar para renderer via `updater:status { status: 'error', message }` (#17)
- [ ] Persistir `updateDownloadedVersion` na store; no boot se existir, enviar status 'downloaded' pro renderer (#23)
- [ ] Second instance: mostrar dialog "Já está em execução" em vez de só quit (#41)
- [ ] Build verificar

Fixes: #17, #23, #29, #41

## Wave 10 — Deferidos (necessitam backend ou out-of-scope)

Documentar como **não implementado** em `feedback/` com motivo:
- #44 Default printer no pair response → requer backend retornar `defaultPrinterName`
- #45 Refresh token → backend não suporta refresh tokens no endpoint atual
- #43 Format detection avançada além de PDF/PS/RAW → cobre 99% casos; feito em wave 5
- #46 CORS mode explicit → feito em wave 7

---

## Verification checklist (após cada commit)

- [ ] `npm run build:main` sem erros
- [ ] `npm run build:renderer` sem erros (quando tocar renderer)
- [ ] Git diff focado (sem arquivos alheios)
- [ ] Commit com mensagem clara (`fix(print-server): ...`)

## Final verification

- [ ] `npm run build` full
- [ ] `npm run pack` gera `.exe` sem erro
- [ ] Revisar todos os 46 IDs marcados como corrigidos
