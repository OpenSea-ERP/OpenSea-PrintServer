# Itens diferidos da análise técnica de 2026-04-15

Os itens abaixo requerem mudanças no backend OpenSea-API e ficam fora do escopo desta passagem client-side.

## #44 — Impressora padrão no response de pairing

**Status:** diferido
**Motivo:** O endpoint `POST /v1/sales/print-agents/pair` atualmente retorna apenas `{ deviceToken, agentId, agentName }`. Para expor a impressora padrão imediatamente após o pareamento sem precisar de uma segunda chamada, o backend precisa adicionar `defaultPrinterName?: string` no payload.
**Quando retomar:** depois que `PrintAgentsController.pair` for atualizado para incluir o campo.

## #45 — Refresh token / expiração do device token

**Status:** diferido
**Motivo:** O backend hoje emite um `deviceToken` sem TTL nem endpoint de refresh. Implementar rotação no cliente sem suporte do servidor traria complexidade sem ganho de segurança.
**Quando retomar:** após a API adicionar `deviceToken` com `exp` + endpoint `POST /v1/sales/print-agents/refresh-token`.

## #43 — Detecção de formato avançada (além de PDF/PS/RAW)

**Status:** implementado suficientemente (wave 5).
**Observação:** cobre 99% dos casos reais. Formatos adicionais (XPS, ZPL, EPL) só serão tratados se surgir demanda.

## #46 — `mode: 'cors'` e `credentials` explícitos em fetch

**Status:** implementado na wave 7 (`apiRequest` helper em `ipc-handlers.ts`).
