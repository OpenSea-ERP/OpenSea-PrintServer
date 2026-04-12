import Store from 'electron-store';

interface StoreSchema {
  agentId: string | null;
  agentName: string | null;
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
    apiUrl: {
      type: 'string',
      default: 'https://api.opensea.com.br',
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
});

export { store, StoreSchema };
