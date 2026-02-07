

# HLS Stream Downloader - Updated Implementation Plan

## Overview
A lightweight, stateless utility for previewing and downloading publicly accessible HLS video streams. Zero database, zero authentication, zero storage — just a pure streaming tool with robust real-world compatibility.

---

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   React SPA     │────▶│  Node.js Server  │────▶│  External FFmpeg│
│  (Vite/Tailwind)│     │  (Native modules)│     │     Worker      │
└─────────────────┘     └──────────────────┘     └─────────────────┘
     Frontend              Analyze/Proxy           Download/Convert
```

---

## Frontend (React + Tailwind)

### Single Page Interface

**1. Header**
- App title: "HLS Stream Downloader"
- Dark technical theme with monospace accents

**2. URL Input Section**
- Large input field for m3u8 URL
- "Analyze Stream" button
- Loading spinner during analysis

**3. Analysis Results Panel** *(appears after analysis)*
- Stream type badge: `VOD` (green) or `LIVE` (amber)
- Encryption status: checkmark or warning icon
- Quality variants list with resolution & bandwidth (all URLs fully resolved)
- Error messages in red alert box

**4. Preview Player**
- hls.js powered video player
- Loads stream through `/proxy` endpoint
- Quality selector in player controls

**5. Download Section**
- Quality dropdown selector
- "Download MP4" button
- Clicking redirects browser to worker URL

**6. Legal Disclaimer** *(always visible)*
> "This tool supports downloading only publicly accessible media. DRM protected streams are not supported."

---

## Node.js Backend (Zero Frameworks)

A single `server.js` file using only native Node modules:
- `http` - server
- `https` - fetch external resources
- `url` - parse and resolve URLs
- `stream` - pipe responses

### Reliability Improvements

**1. Relative URL Resolution**
- Extract base URL from original m3u8 URL
- All segment/playlist paths resolved to absolute URLs before returning or fetching
- Example: `segment0001.ts` + `https://cdn.example.com/video/playlist.m3u8` → `https://cdn.example.com/video/segment0001.ts`

**2. Header Forwarding**
- Proxy forwards these headers when present:
  - `user-agent`
  - `referer`
  - `origin`
- Improves compatibility with CDNs that check request origin

**3. Timeout Protection**
- All external requests timeout after 15 seconds
- Returns error JSON instead of hanging:
```json
{ "error": "Request timeout", "message": "Stream took too long to respond" }
```

---

### Endpoints

**GET `/analyze?url={m3u8_url}`**
- Fetches the m3u8 playlist (15s timeout)
- Parses content to detect:
  - Master vs Media playlist
  - VOD vs LIVE (`#EXT-X-ENDLIST` presence)
  - Encryption (`#EXT-X-KEY` detection)
  - Quality variants from `#EXT-X-STREAM-INF`
- **All URLs returned as fully resolved absolute URLs**
- Returns JSON:
```json
{
  "type": "master" | "media",
  "isLive": false,
  "isEncrypted": false,
  "baseUrl": "https://cdn.example.com/video/",
  "qualities": [
    { 
      "resolution": "1920x1080", 
      "bandwidth": 5000000, 
      "url": "https://cdn.example.com/video/1080p/playlist.m3u8"
    }
  ]
}
```

**GET `/proxy?url={resource_url}`**
- Proxies m3u8 playlists and .ts/.m4s segments
- **Resolves relative segment URLs** using base URL from original request
- **Forwards user-agent, referer, origin headers**
- Streams response using pipe (no buffering)
- Adds CORS headers
- Preserves Content-Type
- 15 second timeout with error response

**GET `/download-url?url={m3u8}&quality={variant_url}`**
- Validates URL format
- Blocks premium domains (Netflix, Disney+, etc.)
- Returns JSON with worker download URL:
```json
{
  "downloadUrl": "https://worker.example.com/download?url=...&quality=..."
}
```

---

## URL Resolution Logic

```javascript
function resolveUrl(baseUrl, relativePath) {
  // If already absolute, return as-is
  if (relativePath.startsWith('http://') || relativePath.startsWith('https://')) {
    return relativePath;
  }
  
  // Extract base directory from playlist URL
  const base = new URL(baseUrl);
  const basePath = base.pathname.substring(0, base.pathname.lastIndexOf('/') + 1);
  
  // Resolve relative path
  return `${base.origin}${new URL(relativePath, base.origin + basePath).pathname}`;
}
```

---

## External Worker Integration

The download button constructs and redirects to:
```
{WORKER_BASE_URL}/download?url={encoded_m3u8}&quality={encoded_variant}
```

Worker handles FFmpeg processing and streams MP4 directly to browser.

---

## Error Handling

| Condition | User Message |
|-----------|--------------|
| LIVE stream | "Live streams cannot be downloaded" |
| Encrypted | "DRM/encrypted streams are not supported" |
| Invalid URL | "Please enter a valid .m3u8 URL" |
| Premium domain | "This source is not supported" |
| Network error | "Unable to fetch stream. Check the URL." |
| Timeout | "Stream took too long to respond" |

---

## File Structure

```
src/
├── components/
│   ├── UrlInput.tsx
│   ├── StreamInfo.tsx
│   ├── VideoPreview.tsx
│   ├── DownloadSection.tsx
│   └── Disclaimer.tsx
├── services/
│   └── api.ts          # Backend API calls
├── utils/
│   └── hlsParser.ts    # M3U8 parsing helpers
├── types/
│   └── stream.ts       # TypeScript interfaces
└── pages/
    └── Index.tsx       # Main page

server/
└── server.js           # Native Node.js backend
```

---

## Design Style
- **Dark theme** - Slate/zinc background, high contrast
- **Technical feel** - Monospace fonts for URLs, terminal-like elements
- **Status indicators** - Colored badges (green/amber/red)
- **Minimal animations** - Subtle loading states
- **Mobile responsive** - Works on all screen sizes

---

## Constraints & Reliability
✅ No database  
✅ No authentication  
✅ No server storage  
✅ No frameworks (pure Node.js)  
✅ Stateless backend  
✅ Minimal dependencies  
✅ Relative URL resolution  
✅ Header forwarding for CDN compatibility  
✅ 15-second timeout protection  
✅ All returned URLs are absolute  

