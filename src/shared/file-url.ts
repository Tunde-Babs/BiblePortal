/**
 * Local file paths → `file://` URLs.
 *
 * String concatenation is not safe here: a media file called
 * `song #2.png` truncates at the `#`, and spaces break the URL outright.
 * Church media folders are full of both, so every path must be encoded.
 */

/**
 * Convert an absolute filesystem path to a `file://` URL.
 * Handles Windows drive letters and UNC paths as well as POSIX paths.
 */
export function fileUrl(filePath: string): string {
  if (!filePath) return '';
  // Already a URL of some kind — leave it alone.
  if (/^[a-z][a-z0-9+.-]*:/i.test(filePath)) return filePath;

  let p = filePath.replace(/\\/g, '/');

  // \\server\share → file://server/share
  if (p.startsWith('//')) {
    const [, host, ...rest] = p.split('/');
    return `file://${host}/${rest.map(encodeURIComponent).join('/')}`;
  }

  // C:/Users/... → /C:/Users/...
  if (/^[a-zA-Z]:/.test(p)) p = `/${p}`;
  if (!p.startsWith('/')) p = `/${p}`;

  // Encode each segment, leaving the separators intact. A drive-letter
  // segment keeps its colon, which encodeURIComponent would otherwise escape.
  const encoded = p
    .split('/')
    .map((segment) => (/^[a-zA-Z]:$/.test(segment) ? segment : encodeURIComponent(segment)))
    .join('/');

  return `file://${encoded}`;
}
