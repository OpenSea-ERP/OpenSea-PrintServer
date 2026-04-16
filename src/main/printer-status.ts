/**
 * Enum compartilhado de status de impressora.
 * Valores numéricos devem bater com o contrato frontend (Dashboard).
 */

export enum PrinterStatusCode {
  ONLINE = 0,
  OFFLINE = 1,
  ERROR = 2,
  UNKNOWN = 3,
}

export type DetectorStatus = 'ready' | 'offline' | 'error' | 'unknown';
export type BackendStatus = 'ONLINE' | 'OFFLINE' | 'ERROR' | 'UNKNOWN';

export function detectorToCode(status: DetectorStatus): PrinterStatusCode {
  switch (status) {
    case 'ready': return PrinterStatusCode.ONLINE;
    case 'offline': return PrinterStatusCode.OFFLINE;
    case 'error': return PrinterStatusCode.ERROR;
    default: return PrinterStatusCode.UNKNOWN;
  }
}

export function detectorToBackend(status: DetectorStatus): BackendStatus {
  switch (status) {
    case 'ready': return 'ONLINE';
    case 'offline': return 'OFFLINE';
    case 'error': return 'ERROR';
    default: return 'UNKNOWN';
  }
}
