# Print Queue + Dashboard Redesign

**Goal:** Adicionar gerenciamento de fila de impressão e redesenhar o Dashboard do Print Server.

## Dashboard Layout (440x680px)

### Header
- Ícone: `Printer` (lucide) em gradiente azul→indigo
- Título: "OpenSea Print Server"
- Subtítulo: nome da máquina (computerName do agent:get-status)
- Direita: dois card-buttons — Configurações (⚙️) e Status conexão (dot + label)

### Sub-header
- "Impressoras Detectadas" + badge numérico + botão "Verificar"

### Lista de impressoras (scroll area, sem footer)
- Ícone impressora: azul se online, cinza se offline/error/unknown
- Título: printer.name
- Subtítulo: "X documento(s) na fila" / "Fila vazia" / "Offline"
- Sem badges Virtual/Local/Rede
- Double-click abre drawer da fila
- StatusDot à direita

### Footer removido
- "Desvincular" movido para Settings (após seção de atualizações)

## Drawer Fila de Impressão

- Abre por double-click na impressora
- 320px pela direita, backdrop semi-transparente, slide-in/out
- Header: nome impressora + status dot + botão "Limpar Fila"
- Lista de jobs: nome documento, status badge, páginas (X/Y), tamanho, timestamp relativo
- Ações por job: cancelar, pausar/retomar, reenviar (icon buttons)
- Empty state: "Nenhum documento na fila"
- Polling 4s enquanto aberto, limpa no unmount

## Backend

### Novo arquivo: `src/main/job-queue.ts`

```ts
interface PrintJob {
  id: number;
  documentName: string;
  userName: string;
  submittedAt: string;
  status: 'printing' | 'queued' | 'paused' | 'error' | 'deleting';
  totalPages: number;
  pagesPrinted: number;
  sizeBytes: number;
}
```

Funções: `getJobs(printerName)`, `cancelJob(printerName, jobId)`, `manageJob(printerName, jobId, action)`

### IPC (3 novos canais)

| Canal | Payload | Response |
|---|---|---|
| `printers:jobs` | `printerName: string` | `PrintJob[]` |
| `printers:cancel-job` | `printerName, jobId` | `{ success, error? }` |
| `printers:manage-job` | `printerName, jobId, action` | `{ success, error? }` |

Rate limit: jobs 2s, ações 1s.

### Settings
- Adicionar seção "Desvincular" no final da página Settings
