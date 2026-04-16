import keytar from 'keytar';
import log from 'electron-log';

const SERVICE = 'OpenSea-PrintServer';
const TOKEN_ACCOUNT = 'deviceToken';

export async function getDeviceToken(): Promise<string | null> {
  try {
    return await keytar.getPassword(SERVICE, TOKEN_ACCOUNT);
  } catch (err) {
    log.error('[secure-store] getDeviceToken falhou:', err);
    return null;
  }
}

export async function setDeviceToken(token: string): Promise<void> {
  try {
    await keytar.setPassword(SERVICE, TOKEN_ACCOUNT, token);
  } catch (err) {
    log.error('[secure-store] setDeviceToken falhou:', err);
    throw err;
  }
}

export async function deleteDeviceToken(): Promise<void> {
  try {
    await keytar.deletePassword(SERVICE, TOKEN_ACCOUNT);
  } catch (err) {
    log.error('[secure-store] deleteDeviceToken falhou:', err);
  }
}
