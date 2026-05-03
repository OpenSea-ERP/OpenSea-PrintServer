import Store from "electron-store";
import log from "electron-log";
import { app } from "electron";
import fs from "fs";
import { setDeviceToken } from "./secure-store";

interface StoreSchema {
  agentId: string | null;
  agentName: string | null;
  apiUrl: string;
  pairingCode: string | null;
  autoLaunch: boolean;
  minimizeToTray: boolean;
  pendingUpdateVersion: string | null;
  /** Timestamp ms do último update que falhou — usado pelo retry 24h. */
  lastFailedUpdateAt: number | null;
}

/**
 * Backend de produção (Fly.io app `opensea-api`, região gru). Espelha o
 * default do Emporion (`settings-store.ts`) — todos os satélites apontam
 * para o mesmo cluster.
 */
const PROD_API_URL = "https://opensea-api.fly.dev";

const schema = {
  agentId: { type: ["string", "null"], default: null },
  agentName: { type: ["string", "null"], default: null },
  // Default `https://opensea-api.fly.dev` para builds empacotados.
  // Em dev (`!app.isPackaged`) o usuário continua livre para manter
  // localhost manualmente; o boot de migrateStaleApiUrl() não toca o
  // valor fora de produção.
  apiUrl: { type: "string", default: PROD_API_URL },
  pairingCode: { type: ["string", "null"], default: null },
  autoLaunch: { type: "boolean", default: true },
  minimizeToTray: { type: "boolean", default: true },
  pendingUpdateVersion: { type: ["string", "null"], default: null },
  lastFailedUpdateAt: { type: ["number", "null"], default: null },
} as const;

/**
 * URLs que ficaram persistidas em instalações que tomaram um default
 * errado em algum momento (a v1.4.0 forçou `http://localhost:3333` em
 * produção via migration; v1.6.1 reverte). Mirrors `STALE_BACKEND_URLS`
 * no Emporion.
 *
 * Só reescreve em builds empacotados — desenvolvedores rodando
 * `npm run dev` continuam podendo manter localhost manualmente.
 */
const STALE_API_URLS = new Set<string>([
  "http://localhost:3333",
  "https://api.opensea.com.br",
  "https://opensea-api-8tv2.onrender.com",
]);

export function migrateStaleApiUrl(): void {
  if (!app.isPackaged) return;
  try {
    const current = store.get("apiUrl");
    if (STALE_API_URLS.has(current)) {
      log.warn(
        `[store] apiUrl obsoleto (${current}); revertendo ao default Fly.`,
      );
      store.set("apiUrl", PROD_API_URL);
    }
  } catch (err) {
    log.error("[store] Falha ao migrar apiUrl obsoleto:", err);
  }
}

function createStore(): Store<StoreSchema> {
  try {
    return new Store<StoreSchema>({
      schema: schema as never,
      migrations: {
        "1.4.0": (s) => {
          if (s.get("apiUrl") === "https://api.opensea.com.br") {
            s.set("apiUrl", "http://localhost:3333");
          }
        },
        "1.5.0": async (s) => {
          // Migrar deviceToken legacy do disco para keytar e apagar
          const legacy = (s as unknown as { get: (k: string) => unknown }).get(
            "deviceToken",
          );
          if (typeof legacy === "string" && legacy.length > 0) {
            try {
              await setDeviceToken(legacy);
              log.info("[store] deviceToken migrado para keytar");
            } catch (err) {
              log.error("[store] Falha ao migrar deviceToken:", err);
            }
          }
          (s as unknown as { delete: (k: string) => void }).delete(
            "deviceToken",
          );
        },
      },
    });
  } catch (err) {
    log.error("[store] Store corrompida, recriando do zero:", err);
    try {
      // electron-store usa app.getPath('userData'). Deletar arquivo e recriar.
      const fallbackPath = (err as { path?: string }).path;
      if (fallbackPath && fs.existsSync(fallbackPath)) {
        fs.unlinkSync(fallbackPath);
      }
    } catch (cleanupErr) {
      log.error("[store] Falha ao limpar store corrompida:", cleanupErr);
    }
    return new Store<StoreSchema>({ schema: schema as never });
  }
}

const store = createStore();

export { store, StoreSchema };
