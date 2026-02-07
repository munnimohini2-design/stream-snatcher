import { useState, useCallback, useRef } from 'react';

interface DownloadProgress {
  phase: 'idle' | 'fetching' | 'recording' | 'finalizing' | 'complete' | 'error';
  segmentsLoaded: number;
  totalSegments: number;
  percentage: number;
  error?: string;
}

interface UseClientDownloaderResult {
  progress: DownloadProgress;
  isDownloading: boolean;
  startDownload: (playlistUrl: string) => Promise<void>;
  cancelDownload: () => void;
}

/**
 * Parse M3U8 playlist and extract segment URLs
 */
function parsePlaylist(content: string, baseUrl: string): string[] {
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
  const segments: string[] = [];
  
  for (const line of lines) {
    // Skip comments and tags
    if (line.startsWith('#')) continue;
    
    // Resolve relative URLs
    let segmentUrl = line;
    if (!line.startsWith('http://') && !line.startsWith('https://')) {
      const base = baseUrl.substring(0, baseUrl.lastIndexOf('/') + 1);
      segmentUrl = base + line;
    }
    
    segments.push(segmentUrl);
  }
  
  return segments;
}

/**
 * Resolve variant playlist URL from master playlist
 */
function getVariantUrl(content: string, baseUrl: string): string | null {
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
  
  // Find highest quality variant
  let highestBandwidth = 0;
  let selectedUrl: string | null = null;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/);
      const bandwidth = bandwidthMatch ? parseInt(bandwidthMatch[1], 10) : 0;
      
      // Next non-comment line is the URL
      for (let j = i + 1; j < lines.length; j++) {
        if (!lines[j].startsWith('#')) {
          if (bandwidth > highestBandwidth) {
            highestBandwidth = bandwidth;
            let url = lines[j];
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
              const base = baseUrl.substring(0, baseUrl.lastIndexOf('/') + 1);
              url = base + url;
            }
            selectedUrl = url;
          }
          break;
        }
      }
    }
  }
  
  return selectedUrl;
}

export function useClientDownloader(): UseClientDownloaderResult {
  const [progress, setProgress] = useState<DownloadProgress>({
    phase: 'idle',
    segmentsLoaded: 0,
    totalSegments: 0,
    percentage: 0,
  });
  
  const abortControllerRef = useRef<AbortController | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  
  const cancelDownload = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }
    setProgress({
      phase: 'idle',
      segmentsLoaded: 0,
      totalSegments: 0,
      percentage: 0,
    });
  }, []);
  
  const startDownload = useCallback(async (playlistUrl: string) => {
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;
    
    try {
      setProgress({
        phase: 'fetching',
        segmentsLoaded: 0,
        totalSegments: 0,
        percentage: 0,
      });
      
      // Fetch the playlist directly from browser
      let playlistContent: string;
      try {
        const response = await fetch(playlistUrl, { signal });
        if (!response.ok) {
          throw new Error(`Failed to fetch playlist: ${response.status}`);
        }
        playlistContent = await response.text();
      } catch (err) {
        throw new Error('Failed to fetch playlist. The stream may be unavailable.');
      }
      
      // Check if this is a master playlist
      let segmentPlaylistUrl = playlistUrl;
      let segmentPlaylistContent = playlistContent;
      
      if (playlistContent.includes('#EXT-X-STREAM-INF')) {
        const variantUrl = getVariantUrl(playlistContent, playlistUrl);
        if (!variantUrl) {
          throw new Error('No playable variant found in master playlist');
        }
        
        const variantResponse = await fetch(variantUrl, { signal });
        if (!variantResponse.ok) {
          throw new Error(`Failed to fetch variant playlist: ${variantResponse.status}`);
        }
        segmentPlaylistUrl = variantUrl;
        segmentPlaylistContent = await variantResponse.text();
      }
      
      // Parse segment URLs
      const segmentUrls = parsePlaylist(segmentPlaylistContent, segmentPlaylistUrl);
      
      if (segmentUrls.length === 0) {
        throw new Error('No segments found in playlist');
      }
      
      setProgress({
        phase: 'fetching',
        segmentsLoaded: 0,
        totalSegments: segmentUrls.length,
        percentage: 0,
      });
      
      // Create video element and MediaSource
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      
      const mediaSource = new MediaSource();
      video.src = URL.createObjectURL(mediaSource);
      
      // Wait for MediaSource to open
      await new Promise<void>((resolve, reject) => {
        mediaSource.addEventListener('sourceopen', () => resolve());
        mediaSource.addEventListener('error', () => reject(new Error('MediaSource error')));
        setTimeout(() => reject(new Error('MediaSource timeout')), 10000);
      });
      
      // Determine codec by fetching first segment
      const firstSegmentResponse = await fetch(segmentUrls[0], { signal });
      const firstSegmentBuffer = await firstSegmentResponse.arrayBuffer();
      
      // Try common codecs
      const codecs = [
        'video/mp4; codecs="avc1.42E01E, mp4a.40.2"',
        'video/mp4; codecs="avc1.64001F, mp4a.40.2"',
        'video/mp2t',
      ];
      
      let sourceBuffer: SourceBuffer | null = null;
      for (const codec of codecs) {
        if (MediaSource.isTypeSupported(codec)) {
          try {
            sourceBuffer = mediaSource.addSourceBuffer(codec);
            break;
          } catch {
            continue;
          }
        }
      }
      
      if (!sourceBuffer) {
        throw new Error('No supported codec found for this stream');
      }
      
      // Append first segment
      await new Promise<void>((resolve, reject) => {
        sourceBuffer!.addEventListener('updateend', () => resolve(), { once: true });
        sourceBuffer!.addEventListener('error', () => reject(new Error('SourceBuffer error')), { once: true });
        sourceBuffer!.appendBuffer(firstSegmentBuffer);
      });
      
      setProgress({
        phase: 'fetching',
        segmentsLoaded: 1,
        totalSegments: segmentUrls.length,
        percentage: Math.round((1 / segmentUrls.length) * 50),
      });
      
      // Fetch and append remaining segments
      for (let i = 1; i < segmentUrls.length; i++) {
        if (signal.aborted) break;
        
        const segmentResponse = await fetch(segmentUrls[i], { signal });
        const segmentBuffer = await segmentResponse.arrayBuffer();
        
        // Wait for buffer to be ready
        while (sourceBuffer.updating) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        
        await new Promise<void>((resolve, reject) => {
          sourceBuffer!.addEventListener('updateend', () => resolve(), { once: true });
          sourceBuffer!.addEventListener('error', () => reject(new Error('SourceBuffer error')), { once: true });
          sourceBuffer!.appendBuffer(segmentBuffer);
        });
        
        setProgress({
          phase: 'fetching',
          segmentsLoaded: i + 1,
          totalSegments: segmentUrls.length,
          percentage: Math.round(((i + 1) / segmentUrls.length) * 50),
        });
      }
      
      if (signal.aborted) return;
      
      // End the stream
      while (sourceBuffer.updating) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      mediaSource.endOfStream();
      
      setProgress({
        phase: 'recording',
        segmentsLoaded: segmentUrls.length,
        totalSegments: segmentUrls.length,
        percentage: 50,
      });
      
      // Set up canvas for recording
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      
      // Wait for video metadata
      await new Promise<void>((resolve) => {
        video.addEventListener('loadedmetadata', () => resolve());
        if (video.readyState >= 1) resolve();
      });
      
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      
      // Create MediaRecorder from canvas stream
      const canvasStream = canvas.captureStream(30);
      
      // Add audio track if available
      const videoElement = video as HTMLVideoElement & { captureStream?: () => MediaStream };
      if (videoElement.captureStream) {
        const videoStream = videoElement.captureStream();
        const audioTracks = videoStream.getAudioTracks();
        audioTracks.forEach(track => canvasStream.addTrack(track));
      }
      
      const recordedChunks: Blob[] = [];
      
      // Try WebM first, then MP4
      let mimeType = 'video/webm;codecs=vp9,opus';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm;codecs=vp8,opus';
      }
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm';
      }
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/mp4';
      }
      
      const mediaRecorder = new MediaRecorder(canvasStream, {
        mimeType,
        videoBitsPerSecond: 8000000,
      });
      mediaRecorderRef.current = mediaRecorder;
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunks.push(event.data);
        }
      };
      
      const recordingPromise = new Promise<Blob>((resolve, reject) => {
        mediaRecorder.onstop = () => {
          const blob = new Blob(recordedChunks, { type: mimeType });
          resolve(blob);
        };
        mediaRecorder.onerror = () => reject(new Error('Recording error'));
      });
      
      // Start recording and playback
      mediaRecorder.start(100);
      video.currentTime = 0;
      
      // Draw video frames to canvas
      let lastTime = -1;
      const drawFrame = () => {
        if (video.paused || video.ended || signal.aborted) return;
        
        if (video.currentTime !== lastTime) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          lastTime = video.currentTime;
          
          const recordingProgress = Math.min(video.currentTime / video.duration, 1);
          setProgress({
            phase: 'recording',
            segmentsLoaded: segmentUrls.length,
            totalSegments: segmentUrls.length,
            percentage: 50 + Math.round(recordingProgress * 45),
          });
        }
        
        requestAnimationFrame(drawFrame);
      };
      
      // Play and record
      await video.play();
      drawFrame();
      
      // Wait for video to end
      await new Promise<void>((resolve) => {
        video.addEventListener('ended', () => resolve());
      });
      
      if (signal.aborted) return;
      
      setProgress({
        phase: 'finalizing',
        segmentsLoaded: segmentUrls.length,
        totalSegments: segmentUrls.length,
        percentage: 95,
      });
      
      // Stop recording and get blob
      mediaRecorder.stop();
      const blob = await recordingPromise;
      
      // Clean up MediaSource
      URL.revokeObjectURL(video.src);
      
      // Download the file
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `video.${mimeType.includes('webm') ? 'webm' : 'mp4'}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);
      
      setProgress({
        phase: 'complete',
        segmentsLoaded: segmentUrls.length,
        totalSegments: segmentUrls.length,
        percentage: 100,
      });
      
    } catch (err) {
      if (signal.aborted) return;
      
      setProgress({
        phase: 'error',
        segmentsLoaded: 0,
        totalSegments: 0,
        percentage: 0,
        error: err instanceof Error ? err.message : 'Download failed',
      });
    }
  }, []);
  
  return {
    progress,
    isDownloading: progress.phase !== 'idle' && progress.phase !== 'complete' && progress.phase !== 'error',
    startDownload,
    cancelDownload,
  };
}
