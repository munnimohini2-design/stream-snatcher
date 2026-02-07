/**
 * HLS to MP4 Worker - FFmpeg Streaming Service
 * 
 * A minimal Node.js server that converts HLS streams to MP4
 * and pipes output directly to the browser (no disk storage).
 * 
 * Features:
 * - No temp files - streams directly from FFmpeg stdout
 * - Auto-reconnect for unstable streams
 * - Copy codecs (no re-encoding for speed)
 * - Client disconnect kills FFmpeg immediately
 * - Progressive download while processing
 */

const http = require('http');
const { URL } = require('url');
const { spawn } = require('child_process');

// Configuration
const PORT = process.env.PORT || 3002;
const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';
const REQUEST_TIMEOUT = 30000; // 30 seconds to start receiving data

// Blocked premium domains (same as main server)
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
 * Send JSON error response
 */
function sendError(res, statusCode, error, message) {
  if (res.headersSent) return;
  
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify({ error, message }));
}

/**
 * Handle download request
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
  
  // FFmpeg arguments for HLS to MP4 conversion
  // - protocol whitelist for broad compatibility
  // - browser-like user agent for CDN compatibility
  // - reconnect flags for unstable streams
  // - copy codecs (no re-encoding)
  // - fragmented MP4 for streaming output (default_base_moof for stdout piping)
  // - optional audio mapping for video-only streams
  const ffmpegArgs = [
    // Protocol whitelist - allows more HLS playlists to load
    '-protocol_whitelist', 'file,http,https,tcp,tls,crypto,data',
    
    // Browser-like user agent for CDN compatibility
    '-user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    
    // Input options - reconnect for unstable streams
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '5',
    '-timeout', '15000000', // 15 seconds in microseconds
    '-i', streamUrl,
    
    // Stream mapping - handle video-only streams (no audio)
    '-map', '0:v:0',      // Map first video stream
    '-map', '0:a?',       // Map audio if present (? = optional)
    
    // Codec options - copy without re-encoding
    '-c:v', 'copy',
    '-c:a', 'copy',
    
    // Audio bitstream filter for AAC in MP4 (ignore if no audio)
    '-bsf:a', 'aac_adtstoasc',
    
    // MP4 options for streaming output
    // default_base_moof is required for correct stdout piping (faststart doesn't work with pipes)
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    
    // Output format
    '-f', 'mp4',
    
    // Output to stdout
    '-'
  ];
  
  console.log(`[${new Date().toISOString()}] Starting download: ${streamUrl}`);
  
  // Send response headers IMMEDIATELY to prevent browser timeout
  // Headers are sent before FFmpeg outputs any data
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
  
  // Timeout for initial data (after headers are sent)
  const startTimeout = setTimeout(() => {
    if (!hasStarted && !hasError) {
      hasError = true;
      console.error(`[${new Date().toISOString()}] Timeout waiting for FFmpeg output`);
      ffmpeg.kill('SIGKILL');
      // Headers already sent, just end the response
      if (!res.writableEnded) {
        res.end();
      }
    }
  }, REQUEST_TIMEOUT);
  
  // Handle FFmpeg stdout - pipe to response
  ffmpeg.stdout.on('data', (chunk) => {
    if (!hasStarted) {
      hasStarted = true;
      clearTimeout(startTimeout);
      console.log(`[${new Date().toISOString()}] Streaming started: ${filename}`);
    }
    
    // Write chunk to response
    if (!res.writableEnded) {
      res.write(chunk);
    }
  });
  
  // Collect stderr for error messages
  ffmpeg.stderr.on('data', (data) => {
    stderrBuffer += data.toString();
    // Keep only last 2000 chars to prevent memory issues
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
      
      if (!hasStarted) {
        // Extract error message from stderr
        const errorMatch = stderrBuffer.match(/\[error\].*|Error.*|Invalid.*/i);
        const errorMsg = errorMatch ? errorMatch[0].trim() : 'Failed to process stream';
        sendError(res, 500, 'FFmpeg error', errorMsg);
      }
    }
    
    // End response if not already ended
    if (!res.writableEnded) {
      res.end();
    }
  });
  
  // Handle FFmpeg errors
  ffmpeg.on('error', (err) => {
    clearTimeout(startTimeout);
    hasError = true;
    
    console.error(`[${new Date().toISOString()}] FFmpeg spawn error: ${err.message}`);
    
    if (!hasStarted) {
      if (err.code === 'ENOENT') {
        sendError(res, 500, 'FFmpeg not found', 'FFmpeg is not installed or not in PATH');
      } else {
        sendError(res, 500, 'Process error', 'Failed to start FFmpeg process');
      }
    }
    
    if (!res.writableEnded) {
      res.end();
    }
  });
  
  // CRITICAL: Kill FFmpeg if client disconnects
  res.on('close', () => {
    if (!ffmpeg.killed) {
      console.log(`[${new Date().toISOString()}] Client disconnected, killing FFmpeg`);
      ffmpeg.kill('SIGKILL');
    }
  });
  
  // Handle request abort
  req.on('aborted', () => {
    if (!ffmpeg.killed) {
      console.log(`[${new Date().toISOString()}] Request aborted, killing FFmpeg`);
      ffmpeg.kill('SIGKILL');
    }
  });
}

/**
 * Main request handler
 */
function handleRequest(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
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
    case '/download':
      return handleDownload(req, res, url);
    case '/health':
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', timestamp: Date.now() }));
      return;
    default:
      return sendError(res, 404, 'Not found', 'Endpoint not found');
  }
}

// Create and start server
const server = http.createServer(handleRequest);

server.listen(PORT, () => {
  console.log(`FFmpeg Worker running on port ${PORT}`);
  console.log(`FFmpeg path: ${FFMPEG_PATH}`);
  console.log(`Download endpoint: GET /download?url={m3u8_url}&quality={optional_variant}`);
});

// Graceful shutdown - kill all FFmpeg processes
const activeProcesses = new Set();

process.on('SIGTERM', () => {
  console.log('Shutting down worker...');
  
  // Kill any active FFmpeg processes
  activeProcesses.forEach(proc => {
    if (!proc.killed) {
      proc.kill('SIGKILL');
    }
  });
  
  server.close(() => {
    console.log('Worker closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down...');
  process.emit('SIGTERM');
});
