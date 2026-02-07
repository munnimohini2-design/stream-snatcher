import type { StreamQuality, StreamAnalysis } from '@/types/stream';

/**
 * Resolve relative URL to absolute URL
 */
function resolveUrl(baseUrl: string, relativePath: string): string {
  if (relativePath.startsWith('http://') || relativePath.startsWith('https://')) {
    return relativePath;
  }
  
  try {
    const base = new URL(baseUrl);
    const basePath = base.pathname.substring(0, base.pathname.lastIndexOf('/') + 1);
    const resolved = new URL(relativePath, base.origin + basePath);
    return resolved.href;
  } catch {
    return relativePath;
  }
}

/**
 * Detect encryption from M3U8 content
 */
function detectEncryption(content: string): boolean {
  const keyTagRegex = /#EXT-X-KEY:([^\n]+)/g;
  let match;
  
  while ((match = keyTagRegex.exec(content)) !== null) {
    const attributes = match[1];
    const methodMatch = attributes.match(/METHOD=([^,\s]+)/);
    if (methodMatch) {
      const method = methodMatch[1].toUpperCase();
      if (method !== 'NONE') {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Parse M3U8 playlist content (client-side version)
 */
export function parseM3u8Client(content: string, baseUrl: string): StreamAnalysis {
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
  
  const result: StreamAnalysis = {
    type: 'media',
    isLive: true,
    isEncrypted: false,
    baseUrl: baseUrl.substring(0, baseUrl.lastIndexOf('/') + 1),
    qualities: [],
  };
  
  // Check for encryption
  result.isEncrypted = detectEncryption(content);
  
  // Check for VOD
  if (content.includes('#EXT-X-ENDLIST')) {
    result.isLive = false;
  }
  
  // Check for master playlist
  if (content.includes('#EXT-X-STREAM-INF')) {
    result.type = 'master';
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      if (line.startsWith('#EXT-X-STREAM-INF:')) {
        const attrs = line.substring(18);
        const quality: StreamQuality = {
          resolution: '',
          bandwidth: 0,
          url: '',
        };
        
        // Parse BANDWIDTH
        const bandwidthMatch = attrs.match(/BANDWIDTH=(\d+)/);
        if (bandwidthMatch) {
          quality.bandwidth = parseInt(bandwidthMatch[1], 10);
        }
        
        // Parse RESOLUTION
        const resolutionMatch = attrs.match(/RESOLUTION=(\d+x\d+)/);
        if (resolutionMatch) {
          quality.resolution = resolutionMatch[1];
        }
        
        // Next non-comment line should be the URL
        for (let j = i + 1; j < lines.length; j++) {
          if (!lines[j].startsWith('#')) {
            quality.url = resolveUrl(baseUrl, lines[j]);
            break;
          }
        }
        
        if (quality.url) {
          result.qualities.push(quality);
        }
      }
    }
    
    // Sort by bandwidth (highest first)
    result.qualities.sort((a, b) => b.bandwidth - a.bandwidth);
  } else {
    // Media playlist - add single quality entry
    result.qualities.push({
      resolution: '',
      bandwidth: 0,
      url: baseUrl,
    });
  }
  
  return result;
}

/**
 * Fetch and parse playlist from browser
 */
export async function fetchAndParsePlaylist(url: string): Promise<StreamAnalysis> {
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`Failed to fetch playlist: ${response.status}`);
  }
  
  const content = await response.text();
  
  if (!content.includes('#EXTM3U')) {
    throw new Error('Invalid M3U8 playlist');
  }
  
  const analysis = parseM3u8Client(content, url);
  analysis.clientOnly = true;
  analysis.directUrl = url;
  
  return analysis;
}
