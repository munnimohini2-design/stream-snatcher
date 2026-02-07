export function resolveUrl(baseUrl: string, relativePath: string): string {
  // If already absolute, return as-is
  if (relativePath.startsWith('http://') || relativePath.startsWith('https://')) {
    return relativePath;
  }
  
  try {
    // Extract base directory from playlist URL
    const base = new URL(baseUrl);
    const basePath = base.pathname.substring(0, base.pathname.lastIndexOf('/') + 1);
    
    // Resolve relative path
    const resolved = new URL(relativePath, base.origin + basePath);
    return resolved.href;
  } catch {
    return relativePath;
  }
}

export function formatBandwidth(bandwidth: number): string {
  if (bandwidth >= 1000000) {
    return `${(bandwidth / 1000000).toFixed(1)} Mbps`;
  }
  if (bandwidth >= 1000) {
    return `${(bandwidth / 1000).toFixed(0)} Kbps`;
  }
  return `${bandwidth} bps`;
}

export function isValidM3u8Url(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      (parsed.pathname.endsWith('.m3u8') || parsed.pathname.includes('.m3u8'))
    );
  } catch {
    return false;
  }
}
