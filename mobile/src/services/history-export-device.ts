import { Platform } from 'react-native';

/**
 * Hand the finished CSV to the person, by whatever route this platform offers.
 *
 * Kept apart from `history-export.ts` so the rules about what goes in the file stay loadable in
 * the test runner — importing `react-native` at module scope makes a file unparseable there.
 * Everything worth testing is on the other side of this one; all this does is deliver bytes.
 *
 * The platform deps are imported lazily rather than at the top, so a web bundle never evaluates
 * the native file APIs it will not use.
 */
export type Delivery = 'shared' | 'downloaded';

export async function deliverCsv(filename: string, csv: string): Promise<Delivery> {
  if (Platform.OS === 'web') return downloadInBrowser(filename, csv);
  return shareFromFile(filename, csv);
}

/**
 * A browser download.
 *
 * Not the Web Share API, although expo-sharing supports it: that cannot share a local file
 * URI, and a download is what someone on a laptop expects anyway.
 */
function downloadInBrowser(filename: string, csv: string): Delivery {
  // The BOM is for Excel on Windows, which otherwise reads a UTF-8 CSV as the system codepage
  // and mangles any non-ASCII in it. Every other reader ignores it.
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Freed on the next tick: revoking synchronously races the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'downloaded';
}

async function shareFromFile(filename: string, csv: string): Promise<Delivery> {
  const { File, Paths } = await import('expo-file-system');
  const Sharing = await import('expo-sharing');

  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('This phone has no way to share a file, so the export cannot be handed anywhere.');
  }

  // The cache directory, not documents. This file is someone's whole transaction history and
  // it exists only to be passed to the share sheet; leaving copies in a directory the system
  // never clears would quietly accumulate that. A fixed name means a repeat export overwrites
  // rather than adding another.
  const file = new File(Paths.cache, filename);
  file.create({ overwrite: true, intermediates: true });
  file.write('﻿' + csv);

  await Sharing.shareAsync(file.uri, {
    mimeType: 'text/csv',
    UTI: 'public.comma-separated-values-text',
    dialogTitle: 'Your Wally transaction history',
  });
  return 'shared';
}
