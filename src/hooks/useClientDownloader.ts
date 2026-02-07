import { useState, useCallback, useRef, useEffect } from 'react';

interface DownloadProgress {
  phase: 'idle' | 'loading' | 'playing' | 'recording' | 'finalizing' | 'complete' | 'error' | 'sessionProtected';
  percentage: number;
  duration: number;
  currentTime: number;
  error?: string;
}

interface UseClientDownloaderResult {
  progress: DownloadProgress;
  isDownloading: boolean;
  startDownload: (playlistUrl: string) => void;
  cancelDownload: () => void;
}

export function useClientDownloader(): UseClientDownloaderResult {
  const [progress, setProgress] = useState<DownloadProgress>({
    phase: 'idle',
    percentage: 0,
    duration: 0,
    currentTime: 0,
  });
  
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const recordedChunksRef = useRef<Uint8Array[]>([]);
  const mimeTypeRef = useRef<string>('video/webm');
  const cancelledRef = useRef(false);
  const messageHandlerRef = useRef<((event: MessageEvent) => void) | null>(null);
  
  const cleanup = useCallback(() => {
    // Remove message listener
    if (messageHandlerRef.current) {
      window.removeEventListener('message', messageHandlerRef.current);
      messageHandlerRef.current = null;
    }
    
    // Send stop command to iframe
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage({ target: 'iframe-player', command: 'stop' }, '*');
    }
    
    // Remove iframe
    if (iframeRef.current) {
      iframeRef.current.remove();
      iframeRef.current = null;
    }
    
    recordedChunksRef.current = [];
  }, []);
  
  const cancelDownload = useCallback(() => {
    cancelledRef.current = true;
    cleanup();
    setProgress({
      phase: 'idle',
      percentage: 0,
      duration: 0,
      currentTime: 0,
    });
  }, [cleanup]);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);
  
  const saveRecording = useCallback(() => {
    if (recordedChunksRef.current.length === 0) {
      setProgress(prev => ({
        ...prev,
        phase: 'error',
        error: 'No data recorded',
      }));
      return;
    }
    
    setProgress(prev => ({
      ...prev,
      phase: 'finalizing',
      percentage: 95,
    }));
    
    // Combine all chunks
    const totalLength = recordedChunksRef.current.reduce((acc, chunk) => acc + chunk.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of recordedChunksRef.current) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    
    // Create blob and download
    const mimeType = mimeTypeRef.current;
    const blob = new Blob([combined], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `video.${mimeType.includes('webm') ? 'webm' : 'mp4'}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    cleanup();
    
    setProgress(prev => ({
      ...prev,
      phase: 'complete',
      percentage: 100,
    }));
  }, [cleanup]);
  
  const startDownload = useCallback((playlistUrl: string) => {
    // Must be called from user gesture
    cancelledRef.current = false;
    recordedChunksRef.current = [];
    
    setProgress({
      phase: 'loading',
      percentage: 0,
      duration: 0,
      currentTime: 0,
    });
    
    // Create hidden iframe
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.top = '-9999px';
    iframe.style.left = '-9999px';
    iframe.style.width = '640px';
    iframe.style.height = '360px';
    iframe.style.border = 'none';
    iframe.style.opacity = '0';
    iframe.style.pointerEvents = 'none';
    iframe.allow = 'autoplay';
    iframe.src = '/iframe-player.html';
    
    document.body.appendChild(iframe);
    iframeRef.current = iframe;
    
    // Set up message handler
    const handleMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || data.source !== 'iframe-player') return;
      
      if (cancelledRef.current) return;
      
      console.log('[parent] Received from iframe:', data.type);
      
      switch (data.type) {
        case 'ready':
          // Iframe is ready, send the URL to load
          iframe.contentWindow?.postMessage({
            target: 'iframe-player',
            command: 'load',
            url: playlistUrl,
          }, '*');
          break;
          
        case 'manifest-loaded':
          setProgress(prev => ({
            ...prev,
            phase: 'playing',
            duration: data.duration || 0,
          }));
          break;
          
        case 'playback-started':
          console.log('[parent] Playback started in iframe');
          break;
          
        case 'recording-started':
          setProgress(prev => ({
            ...prev,
            phase: 'recording',
          }));
          break;
          
        case 'progress':
          if (data.duration > 0) {
            const percentage = Math.min(Math.round((data.currentTime / data.duration) * 100), 95);
            setProgress(prev => ({
              ...prev,
              percentage,
              currentTime: data.currentTime,
              duration: data.duration,
            }));
          }
          break;
          
        case 'data':
          // Receive recorded chunk from iframe
          if (data.chunk) {
            recordedChunksRef.current.push(new Uint8Array(data.chunk));
            if (data.mimeType) {
              mimeTypeRef.current = data.mimeType;
            }
          }
          break;
          
        case 'ended':
        case 'recording-stopped':
          // Video ended or recording stopped, save the file
          if (data.mimeType) {
            mimeTypeRef.current = data.mimeType;
          }
          saveRecording();
          break;
          
        case 'error':
          console.error('[parent] Iframe error:', data.message);
          // Detect session-protected streams
          if (data.sessionProtected) {
            setProgress({
              phase: 'sessionProtected',
              percentage: 0,
              duration: 0,
              currentTime: 0,
              error: 'This stream requires an authenticated session from the original website and cannot be downloaded directly. Open the video page and use browser developer tools instead.',
            });
            cleanup();
          } else {
            setProgress(prev => ({
              ...prev,
              phase: 'error',
              error: data.message || 'Playback failed',
            }));
            if (data.fatal) {
              cleanup();
            }
          }
          break;
          
        case 'stopped':
          // Cleanup already handled
          break;
      }
    };
    
    messageHandlerRef.current = handleMessage;
    window.addEventListener('message', handleMessage);
    
    // Timeout for loading
    setTimeout(() => {
      if (cancelledRef.current) return;
      if (progress.phase === 'loading') {
        setProgress(prev => {
          if (prev.phase === 'loading') {
            cleanup();
            return {
              ...prev,
              phase: 'error',
              error: 'Stream load timeout. The stream may be unavailable.',
            };
          }
          return prev;
        });
      }
    }, 30000);
    
  }, [cleanup, progress.phase, saveRecording]);
  
  return {
    progress,
    isDownloading: progress.phase !== 'idle' && progress.phase !== 'complete' && progress.phase !== 'error' && progress.phase !== 'sessionProtected',
    startDownload,
    cancelDownload,
  };
}
