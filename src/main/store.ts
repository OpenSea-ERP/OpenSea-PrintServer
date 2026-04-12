import Store from 'electron-store';

interface StoreSchema {
  agentId: string | null;
  agentName: string | null;
  deviceToken: string | null;
  apiUrl: string;
  pairingCode: string | null;
  autoLaunch: boolean;
  minimizeToTray: boolean;
}

const store = new Store<StoreSchema>({
  schema: {
    agentId: {
      type: ['string', 'null'],
      default: null,
    },
    agentName: {
      type: ['string', 'null'],
      default: null,
    },
    deviceToken: {
      type: ['string', 'null'],
      default: null,
    },
    apiUrl: {
      type: 'string',
      default: 'http://localhost:3333',
    },
    pairingCode: {
      type: ['string', 'null'],
      default: null,
    },
    autoLaunch: {
      type: 'boolean',
      default: true,
    },
    minimizeToTray: {
      type: 'boolean',
      default: true,
    },
  },
  migrations: {
    '1.4.0': (s) => {
      // Fix apiUrl from old default
      if (s.get('apiUrl') === 'https://api.opensea.com.br') {
        s.set('apiUrl', 'http://localhost:3333');
      }
    },
  },
});

export { store, StoreSchema };
