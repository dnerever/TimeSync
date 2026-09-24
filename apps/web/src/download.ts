/**
 * Hand a generated file to the browser.
 *
 * Everything TimeSync produces is built locally, so a download is an object
 * URL rather than a request. Revoking straight after the click is safe: the
 * browser has already taken its own reference to the blob.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(href);
}
