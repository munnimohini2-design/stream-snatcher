
/**
 * HLS Stream Downloader - Backend Server
 * 
 * A minimal, stateless Node.js server using only native modules.
 * Handles stream analysis, proxying, download URL generation, and background FFmpeg downloads.
 * 
 * Reliability features:
 * - Full browser header forwarding for session-protected streams
 * - Cookie forwarding for CDN session authentication
 * - Range request support for seeking
 * - No Content-Length forwarding (prevents chunked encoding issues)
 * - Proper encryption detection via METHOD parsing
 * - Client disconnect handling to prevent memory leaks
 * - Better error messages for 401/403 responses
 * - Background FFmpeg processing for downloads
 */

import http from 'http';
import https from 'https';
import { URL } from 'url';
import { spawn } from 'child_process';

// Configuration
const PORT = process.env.PORT || 3001;
const REQUEST_TIMEOUT = 15000; // 15 seconds for initial connection
const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';

// Default browser-like headers (Chrome on Windows)
const DEFAULT_BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'identity', // Don't request compression for streams
  'Connection': 'keep-alive',
};

// Headers to forward from browser requests
const FORWARD_HEADERS = [
  'user-agent',
  'referer',
  'origin',
  'accept',
  'accept-language',
  'accept-encoding',
  'connection',
  'range',
  'cookie', // Important for session-protected streams
];

// Blocked premium domains
const BLOCKED_DOMAINS = [
  'netflix.com',
  'disneyplus.com',
  'hulu.com',
  'hbomax.com',
  'max.com',
  'primevideo.com',
  'amazon.com',
  'peacocktv.com',
  'paramountplus.com',
  'appletv.apple.com',
];

/**
 * Validate URL format
 */
function isValidUrl(urlString) {
  try {
    const url = new URL(urlString);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Generate filename from URL
 */
function generateFilename(urlString) {
  try {
    const url = new URL(urlString);
    const pathParts = url.pathname.split('/');
    const baseName = pathParts[pathParts.length - 1] || 'video';
    // Remove extension and clean up
    const cleanName = baseName.replace(/\.(m3u8|m3u)$/i, '').replace(/[^a-zA-Z0-9_-]/g, '_');
    return `${cleanName || 'video'}.mp4`;
  } catch {
    return 'video.mp4';
  }
}

/**
 * Build browser-like headers from incoming request
 * Falls back to default Chrome headers if not provided
 */
function buildBrowserHeaders(incomingReq, includeRange = false) {
  const headers = { ...DEFAULT_BROWSER_HEADERS };

  // Forward browser headers if present
  for (const header of FORWARD_HEADERS) {
    if (header === 'range' && !includeRange) continue;

    const value = incomingReq.headers[header];
    if (value) {
      // Normalize header names for outgoing request
      const normalizedHeader = header.split('-').map(
        part => part.charAt(0).toUpperCase() + part.slice(1)
      ).join('-');
      headers[normalizedHeader] = value;
    }
  }

  return headers;
}

/**
 * Resolve relative URLs to absolute URLs
 */
function resolveUrl(baseUrl, relativePath) {
  if (!relativePath) return null;

  // If already absolute, return as-is
  if (relativePath.startsWith('http://') || relativePath.startsWith('https://')) {
    return relativePath;
  }

  try {
    const base = new URL(baseUrl);
    const basePath = base.pathname.substring(0, base.pathname.lastIndexOf('/') + 1);
    const resolved = new URL(relativePath, base.origin + basePath);
    return resolved.href;
  } catch {
    return null;
  }
}

/**
 * Fetch URL with timeout and browser-like headers
 * Returns { req, res } so caller can handle cleanup
 */
function fetchWithTimeout(urlString, headers = {}, timeout = REQUEST_TIMEOUT) {
  return new Promise((resolve, reject) => {
    // Preserve full URL including query parameters (tokens, signatures, etc.)
    const parsedUrl = new URL(urlString);
    const client = parsedUrl.protocol === 'https:' ? https : http;

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      // Use full path + search to preserve query parameters exactly
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: headers,
    };

    const req = client.request(options, (res) => {
      // Handle redirects - preserve headers for redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = resolveUrl(urlString, res.headers.location) || res.headers.location;
        fetchWithTimeout(redirectUrl, headers, timeout)
          .then(resolve)
          .catch(reject);
        return;
      }

      // Return both request and response for cleanup handling
      resolve({ req, res });
    });

    req.on('error', reject);

    req.setTimeout(timeout, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.end();
  });
}

/**
 * Read response body as string
 */
function readBody(res) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    res.on('data', chunk => chunks.push(chunk));
    res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    res.on('error', reject);
  });
}

/**
 * Detect encryption from M3U8 content using proper METHOD parsing
 * Returns true if encrypted (METHOD is not NONE or missing)
 */
function detectEncryption(content) {
  const keyTagRegex = /#EXT-X-KEY:([^\n]+)/g;
  let match;

  while ((match = keyTagRegex.exec(content)) !== null) {
    const attributes = match[1];

    // Parse METHOD attribute
    const methodMatch = attributes.match(/METHOD=([^,\s]+)/);
    if (methodMatch) {
      const method = methodMatch[1].toUpperCase();
      // If METHOD is anything other than NONE, it's encrypted
      if (method !== 'NONE') {
        return true;
      }
    }
  }

  return false;
}

/**
 * Parse M3U8 playlist content
 */
function parseM3u8(content, baseUrl) {
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean);

  const result = {
    type: 'media',
    isLive: true, // Assume live until we find #EXT-X-ENDLIST
    isEncrypted: false,
    baseUrl: baseUrl.substring(0, baseUrl.lastIndexOf('/') + 1),
    qualities: [],
  };

  // Check for encryption using proper METHOD parsing
  result.isEncrypted = detectEncryption(content);

  // Check for VOD (has end marker)
  if (content.includes('#EXT-X-ENDLIST')) {
    result.isLive = false;
  }

  // Check for master playlist (has stream info)
  if (content.includes('#EXT-X-STREAM-INF')) {
    result.type = 'master';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith('#EXT-X-STREAM-INF:')) {
        const attrs = line.substring(18);
        const quality = {
          resolution: null,
          bandwidth: 0,
          url: null,
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
    // Media playlist - add single quality entry with the original URL
    result.qualities.push({
      resolution: null,
      bandwidth: 0,
      url: baseUrl,
    });
  }

  return result;
}

/**
 * Check if domain is blocked
 */
function isBlockedDomain(urlString) {
  try {
    const hostname = new URL(urlString).hostname.toLowerCase();
    return BLOCKED_DOMAINS.some(domain => hostname.includes(domain));
  } catch {
    return false;
  }
}

/**
 * Send JSON response
 */
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Range',
  });
  res.end(JSON.stringify(data));
}

/**
 * Send error response
 */
function sendError(res, statusCode, error, message) {
  sendJson(res, statusCode, { error, message });
}

/**
 * Handle /analyze endpoint
 */
async function handleAnalyze(req, res, url) {
  const m3u8Url = url.searchParams.get('url');

  if (!m3u8Url) {
    return sendError(res, 400, 'Missing URL', 'Please provide a valid .m3u8 URL');
  }

  // Validate URL format
  try {
    new URL(m3u8Url);
  } catch {
    return sendError(res, 400, 'Invalid URL', 'Please enter a valid .m3u8 URL');
  }

  // Check blocked domains
  if (isBlockedDomain(m3u8Url)) {
    return sendError(res, 403, 'Blocked domain', 'This source is not supported');
  }

  try {
    // Build browser-like headers from incoming request
    const headers = buildBrowserHeaders(req, false);

    const { res: response } = await fetchWithTimeout(m3u8Url, headers);

    // Handle authentication/authorization errors (401/403)
    // Return clientOnly mode to allow browser-based download
    if (response.statusCode === 401 || response.statusCode === 403) {
      return sendJson(res, 200, {
        clientOnly: true,
        directUrl: m3u8Url,
        message: 'Stream restricted to viewer IP, use browser downloader',
      });
    }

    if (response.statusCode !== 200) {
      return sendError(res, 502, 'Fetch failed', `Unable to fetch stream (HTTP ${response.statusCode})`);
    }

    const content = await readBody(response);

    if (!content.includes('#EXTM3U')) {
      return sendError(res, 400, 'Invalid playlist', 'The URL does not contain a valid M3U8 playlist');
    }

    const analysis = parseM3u8(content, m3u8Url);
    sendJson(res, 200, analysis);

  } catch (err) {
    if (err.message === 'Request timeout') {
      return sendError(res, 504, 'Request timeout', 'Stream took too long to respond');
    }
    return sendError(res, 500, 'Network error', 'Unable to fetch stream. Check the URL.');
  }
}

/**
 * Handle /proxy endpoint with Range support and memory leak prevention
 */
async function handleProxy(req, res, url) {
  const resourceUrl = url.searchParams.get('url');

  if (!resourceUrl) {
    return sendError(res, 400, 'Missing URL', 'Please provide a resource URL');
  }

  let upstreamReq = null;

  try {
    // Build browser-like headers including Range for seeking support
    const headers = buildBrowserHeaders(req, true);

    const { req: upstream, res: response } = await fetchWithTimeout(resourceUrl, headers);
    upstreamReq = upstream;

    // Handle authentication/authorization errors
    if (response.statusCode === 401 || response.statusCode === 403) {
      return sendError(
        res,
        response.statusCode,
        'Access denied',
        'Stream requires browser session headers. The session may have expired.'
      );
    }

    // Prevent memory leak: abort upstream if client disconnects
    res.on('close', () => {
      if (upstreamReq) {
        upstreamReq.destroy();
      }
    });

    // Determine content type
    let contentType = response.headers['content-type'] || 'application/octet-stream';

    // For m3u8 files, rewrite relative URLs to absolute
    if (resourceUrl.includes('.m3u8') || contentType.includes('mpegurl')) {
      const content = await readBody(response);
      const baseUrl = resourceUrl;

      // Rewrite relative URLs in the playlist
      const rewritten = content.split('\n').map(line => {
        const trimmed = line.trim();
        // Handle URI= in tags like #EXT-X-KEY
        if (trimmed.includes('URI="')) {
          return trimmed.replace(/URI="([^"]+)"/g, (match, uri) => {
            const resolved = resolveUrl(baseUrl, uri);
            return resolved ? `URI="${resolved}"` : match;
          });
        }
        // Skip empty lines and other comments
        if (!trimmed || trimmed.startsWith('#')) {
          return line;
        }
        // Resolve non-comment lines (segment URLs)
        const resolved = resolveUrl(baseUrl, trimmed);
        return resolved || line;
      }).join('\n');

      res.writeHead(200, {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Range',
        'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges',
        'Cache-Control': 'no-cache',
      });
      res.end(rewritten);
      return;
    }

    // For segments (.ts, .m4s, etc.), stream directly
    // DO NOT forward Content-Length - some CDNs use chunked encoding
    // which causes playback freezing when length is forwarded
    const responseHeaders = {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Range',
      'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges',
      'Cache-Control': 'no-cache',
    };

    // Forward range-related headers for seeking support
    if (response.headers['content-range']) {
      responseHeaders['Content-Range'] = response.headers['content-range'];
    }
    if (response.headers['accept-ranges']) {
      responseHeaders['Accept-Ranges'] = response.headers['accept-ranges'];
    }

    // Use 206 for partial content, 200 otherwise
    const statusCode = response.statusCode === 206 ? 206 : 200;

    res.writeHead(statusCode, responseHeaders);

    // Pipe with error handling
    response.pipe(res);

    response.on('error', () => {
      res.end();
    });

  } catch (err) {
    if (upstreamReq) {
      upstreamReq.destroy();
    }
    if (err.message === 'Request timeout') {
      return sendError(res, 504, 'Request timeout', 'Resource took too long to respond');
    }
    return sendError(res, 500, 'Proxy error', 'Unable to fetch resource');
  }
}

/**
 * Handle /download (Worker Logic)
 */
function handleDownload(req, res, url) {
  const m3u8Url = url.searchParams.get('url');
  const qualityUrl = url.searchParams.get('quality');

  // Use quality URL if provided, otherwise use main URL
  const streamUrl = qualityUrl || m3u8Url;

  if (!streamUrl) {
    return sendError(res, 400, 'Missing URL', 'Please provide a valid .m3u8 URL');
  }

  // Validate URL
  if (!isValidUrl(streamUrl)) {
    return sendError(res, 400, 'Invalid URL', 'Please provide a valid HTTP(S) URL');
  }

  // Check blocked domains
  if (isBlockedDomain(streamUrl)) {
    return sendError(res, 403, 'Blocked domain', 'This source is not supported');
  }

  // Generate download filename
  const filename = generateFilename(streamUrl);

  // Build headers for FFmpeg
  let headersArg = '';
  const userAgent = req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  if (req.headers['cookie']) {
    headersArg += `Cookie: ${req.headers['cookie']}\r\n`;
  }
  if (req.headers['referer']) {
    headersArg += `Referer: ${req.headers['referer']}\r\n`;
  }
  if (req.headers['origin']) {
    headersArg += `Origin: ${req.headers['origin']}\r\n`;
  }

  // FFmpeg arguments
  const ffmpegArgs = [
    '-protocol_whitelist', 'file,http,https,tcp,tls,crypto,data',
    '-user_agent', userAgent,
  ];

  if (headersArg) {
    ffmpegArgs.push('-headers', headersArg);
  }

  ffmpegArgs.push(
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '5',
    '-timeout', '15000000', // 15 seconds
    '-i', streamUrl,
    '-map', '0:v:0',      // Map first video stream
    '-map', '0:a?',       // Map audio if present
    '-c:v', 'copy',
    '-c:a', 'copy',
    '-bsf:a', 'aac_adtstoasc',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    '-f', 'mp4',
    '-'
  );

  console.log(`[${new Date().toISOString()}] Starting download: ${streamUrl}`);

  res.writeHead(200, {
    'Content-Type': 'video/mp4',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Transfer-Encoding': 'chunked',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });

  // Spawn FFmpeg process
  const ffmpeg = spawn(FFMPEG_PATH, ffmpegArgs, {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let hasStarted = false;
  let hasError = false;
  let stderrBuffer = '';

  // Timeout for initial data
  const startTimeout = setTimeout(() => {
    if (!hasStarted && !hasError) {
      hasError = true;
      console.error(`[${new Date().toISOString()}] Timeout waiting for FFmpeg output`);
      ffmpeg.kill('SIGKILL');
      if (!res.writableEnded) {
        res.end();
      }
    }
  }, 30000); // 30s timeout for download start

  // Handle FFmpeg stdout
  ffmpeg.stdout.on('data', (chunk) => {
    if (!hasStarted) {
      hasStarted = true;
      clearTimeout(startTimeout);
      console.log(`[${new Date().toISOString()}] Streaming started: ${filename}`);
    }

    if (!res.writableEnded) {
      res.write(chunk);
    }
  });

  // Collect stderr
  ffmpeg.stderr.on('data', (data) => {
    stderrBuffer += data.toString();
    if (stderrBuffer.length > 2000) {
      stderrBuffer = stderrBuffer.slice(-2000);
    }
  });

  // Handle FFmpeg exit
  ffmpeg.on('close', (code) => {
    clearTimeout(startTimeout);

    if (code === 0) {
      console.log(`[${new Date().toISOString()}] Download completed: ${filename}`);
    } else if (!hasError) {
      console.error(`[${new Date().toISOString()}] FFmpeg exited with code ${code}`);
    }

    if (!res.writableEnded) {
      res.end();
    }
  });

  // Handle FFmpeg errors
  ffmpeg.on('error', (err) => {
    clearTimeout(startTimeout);
    hasError = true;
    console.error(`[${new Date().toISOString()}] FFmpeg spawn error: ${err.message}`);

    if (!res.headersSent) {
      if (err.code === 'ENOENT') {
        sendError(res, 500, 'FFmpeg not found', 'FFmpeg is not installed or not in PATH');
      } else {
        sendError(res, 500, 'Process error', 'Failed to start FFmpeg process');
      }
    } else if (!res.writableEnded) {
      res.end();
    }
  });

  // Kill FFmpeg if client disconnects
  res.on('close', () => {
    if (!ffmpeg.killed) {
      console.log(`[${new Date().toISOString()}] Client disconnected, killing FFmpeg`);
      ffmpeg.kill('SIGKILL');
    }
  });
}

/**
 * Handle /download-url endpoint with proper URL encoding
 */
function handleDownloadUrl(req, res, url) {
  const m3u8Url = url.searchParams.get('url');
  const quality = url.searchParams.get('quality');

  if (!m3u8Url) {
    return sendError(res, 400, 'Missing URL', 'Please provide a valid .m3u8 URL');
  }

  // Validate URL format
  try {
    new URL(m3u8Url);
  } catch {
    return sendError(res, 400, 'Invalid URL', 'Please enter a valid .m3u8 URL');
  }

  // Check blocked domains
  if (isBlockedDomain(m3u8Url)) {
    return sendError(res, 403, 'Blocked domain', 'This source is not supported');
  }

  // Generate download URL using the current server host
  // This allows the server to work anywhere without manual config
  const protocol = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers['host'];
  const baseUrl = `${protocol}://${host}`;

  let downloadUrl = `${baseUrl}/download?url=${encodeURIComponent(m3u8Url)}`;

  if (quality) {
    downloadUrl += `&quality=${encodeURIComponent(quality)}`;
  }

  sendJson(res, 200, { downloadUrl });
}

/**
 * Main request handler
 */
function handleRequest(req, res) {
  // Handle CORS preflight - include Range header support
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Range',
      'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges',
    });
    res.end();
    return;
  }

  // Only allow GET requests
  if (req.method !== 'GET') {
    return sendError(res, 405, 'Method not allowed', 'Only GET requests are supported');
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // Route requests
  switch (pathname) {
    case '/analyze':
      return handleAnalyze(req, res, url);
    case '/proxy':
      return handleProxy(req, res, url);
    case '/download-url':
      return handleDownloadUrl(req, res, url);
    case '/download':
      return handleDownload(req, res, url);
    case '/health':
      return sendJson(res, 200, { status: 'ok', timestamp: Date.now() });
    default:
      return sendError(res, 404, 'Not found', 'Endpoint not found');
  }
}

// Create and start server
const server = http.createServer(handleRequest);

server.listen(PORT, () => {
  console.log(`Stream Snatcher server running on port ${PORT}`);
  console.log(`Serving API and Download Worker (Merged)`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down server...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
