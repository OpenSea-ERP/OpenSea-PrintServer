import { app } from "electron";
import log from "electron-log";
import { z } from "zod";
import { createStore } from "@opensea/satellite-runtime/store";
import { setDeviceToken } from "./secure-store";

/**
 * Backend de produção (Fly.io app `opensea-api`, região gru). Espelha o
 * default do Emporion (`settings-store.ts`) — todos os satélites apontam
 * para o mesmo cluster.
 */
const PROD_API_URL = "https://opensea-api.fly.dev";

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

const schema = z.object({
  agentId: z.string().nullable(),
  agentName: z.string().nullable(),
  apiUrl: z.string(),
  pairingCode: z.string().nullable(),
  autoLaunch: z.boolean(),
  minimizeToTray: z.boolean(),
  pendingUpdateVersion: z.string().nullable(),
  /** Timestamp ms do último update que falhou — usado pelo retry 24h. */
  lastFailedUpdateAt: z.number().nullable(),
});

export type StoreSchema = z.infer<typeof schema>;

export const store = createStore({
  name: "config",
  schema,
  defaults: {
    agentId: null,
    agentName: null,
    apiUrl: PROD_API_URL,
    pairingCode: null,
    autoLaunch: true,
    minimizeToTray: true,
    pendingUpdateVersion: null,
    lastFailedUpdateAt: null,
  },
  migrations: {
    "1.4.0": (s) => {
      const current = s.get("apiUrl");
      if (current === "https://api.opensea.com.br") {
        s.set("apiUrl", "http://localhost:3333");
      }
    },
    "1.5.0": async (s) => {
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
      (s as unknown as { delete: (k: string) => void }).delete("deviceToken");
    },
  },
  onCorruption: "reset",
});

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
