import Store from 'electron-store';
import log from 'electron-log';
import fs from 'fs';
import { setDeviceToken } from './secure-store';

interface StoreSchema {
  agentId: string | null;
  agentName: string | null;
  apiUrl: string;
  pairingCode: string | null;
  autoLaunch: boolean;
  minimizeToTray: boolean;
  pendingUpdateVersion: string | null;
}

const schema = {
  agentId: { type: ['string', 'null'], default: null },
  agentName: { type: ['string', 'null'], default: null },
  apiUrl: { type: 'string', default: 'http://localhost:3333' },
  pairingCode: { type: ['string', 'null'], default: null },
  autoLaunch: { type: 'boolean', default: true },
  minimizeToTray: { type: 'boolean', default: true },
  pendingUpdateVersion: { type: ['string', 'null'], default: null },
} as const;

function createStore(): Store<StoreSchema> {
  try {
    return new Store<StoreSchema>({
      schema: schema as never,
      migrations: {
        '1.4.0': (s) => {
          if (s.get('apiUrl') === 'https://api.opensea.com.br') {
            s.set('apiUrl', 'http://localhost:3333');
          }
        },
        '1.5.0': async (s) => {
          // Migrar deviceToken legacy do disco para keytar e apagar
          const legacy = (s as unknown as { get: (k: string) => unknown }).get('deviceToken');
          if (typeof legacy === 'string' && legacy.length > 0) {
            try {
              await setDeviceToken(legacy);
              log.info('[store] deviceToken migrado para keytar');
            } catch (err) {
              log.error('[store] Falha ao migrar deviceToken:', err);
            }
          }
          (s as unknown as { delete: (k: string) => void }).delete('deviceToken');
        },
      },
    });
  } catch (err) {
    log.error('[store] Store corrompida, recriando do zero:', err);
    try {
      // electron-store usa app.getPath('userData'). Deletar arquivo e recriar.
      const fallbackPath = (err as { path?: string }).path;
      if (fallbackPath && fs.existsSync(fallbackPath)) {
        fs.unlinkSync(fallbackPath);
      }
    } catch (cleanupErr) {
      log.error('[store] Falha ao limpar store corrompida:', cleanupErr);
    }
    return new Store<StoreSchema>({ schema: schema as never });
  }
}

const store = createStore();

export { store, StoreSchema };
