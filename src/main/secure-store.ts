/**
 * Secure store — wrapper sobre @opensea/satellite-runtime/secure-store.
 * Service: 'OpenSea-PrintServer'.
 *
 * O runtime expõe `{ get, set, delete }` com fallback automático em-memória
 * quando `NODE_ENV=test` — Playwright/Vitest não poluem o Credential Manager
 * do Windows / Keychain do macOS entre testes. Erros de keytar são logados e
 * tratados (get retorna null; delete swallowed; set re-throws) dentro do
 * runtime.
 *
 * Esta camada apenas mapeia a única conta nominal (`deviceToken`) para a
 * API genérica e preserva a superfície pública usada por main.ts, ipc-
 * handlers.ts e store.ts (migration 1.5.0 do legacy electron-store).
 */
import { createSecureStore } from '@opensea/satellite-runtime/secure-store';

const SERVICE = 'OpenSea-PrintServer';
const TOKEN_ACCOUNT = 'deviceToken';

const inner = createSecureStore({ service: SERVICE });

export const getDeviceToken = (): Promise<string | null> => inner.get(TOKEN_ACCOUNT);
export const setDeviceToken = (token: string): Promise<void> => inner.set(TOKEN_ACCOUNT, token);
export const deleteDeviceToken = (): Promise<void> => inner.delete(TOKEN_ACCOUNT);
