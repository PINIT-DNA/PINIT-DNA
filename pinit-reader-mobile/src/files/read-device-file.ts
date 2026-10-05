import { File } from 'expo-file-system';
import { readAsStringAsync } from 'expo-file-system/legacy';
import { hasPinitExtension, readPinitFile } from '../core/pinit-parser';
import type { PinitParseResult } from '../core/types';

function displayName(uri: string, name?: string | null): string {
  const given = name?.split(/[/\\]/).pop()?.trim();
  if (given && hasPinitExtension(given)) return given;
  let decoded = uri;
  try { decoded = decodeURIComponent(uri); } catch { decoded = uri; }
  const fromUri = decoded.split(/[/\\?#]/).pop() ?? '';
  if (hasPinitExtension(fromUri)) return fromUri;
  return 'opened.pinit';
}

/**
 * Read a .pinit from a normal path or an Android content URI.
 * The bytes stay in memory for parsing. The carrier is a few kilobytes.
 */
export async function readDevicePinit(uri: string, name?: string | null): Promise<PinitParseResult> {
  const fileName = displayName(uri, name);
  let text = '';
  let size = 0;
  try {
    const file = new File(uri);
    text = await file.text();
    size = file.info().size ?? text.length;
  } catch {
    try {
      text = await readAsStringAsync(uri);
      size = text.length;
    } catch {
      text = '';
      size = 0;
    }
  }
  return readPinitFile({
    name: fileName,
    size: size || text.length,
    text: async () => text,
  });
}
