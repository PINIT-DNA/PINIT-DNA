import { readPinitFile } from '../core/pinit-parser';
import type { PinitFileInput, PinitParseResult } from '../core/types';
import { readerLog } from '../log';

export async function readCarrier(file: PinitFileInput): Promise<PinitParseResult> {
  readerLog('Reading file...');
  const result = await readPinitFile(file);
  if (!result.ok) return result;
  readerLog(`PINIT version: ${result.document.version}`);
  readerLog('Token extracted successfully');
  return result;
}
