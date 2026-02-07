import { useState, useCallback, useRef } from 'react';
import Hls from 'hls.js';

interface DownloadProgress {
  phase: 'idle' | 'loading' | 'playing' | 'recording' | 'finalizing' | 'complete' | 'error';
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
  
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const cancelledRef = useRef(false);
  
  const cleanup = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch (e) {
        // Ignore
      }
    }
    mediaRecorderRef.current = null;
    
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.src = '';
      videoRef.current.remove();
      videoRef.current = null;
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
  
  const startDownload = useCallback((playlistUrl: string) => {
    // Must be called directly from user gesture for captureStream to work
    cancelledRef.current = false;
    recordedChunksRef.current = [];
    
    setProgress({
      phase: 'loading',
      percentage: 0,
      duration: 0,
      currentTime: 0,
    });
    
    // Create hidden video element
    const video = document.createElement('video');
    video.style.position = 'fixed';
    video.style.top = '-9999px';
    video.style.left = '-9999px';
    video.style.width = '1px';
    video.style.height = '1px';
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';
    document.body.appendChild(video);
    videoRef.current = video;
    
    // Determine supported MIME type for recording
    const mimeTypes = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
      'video/mp4',
    ];
    
    let selectedMimeType = 'video/webm';
    for (const mimeType of mimeTypes) {
      if (MediaRecorder.isTypeSupported(mimeType)) {
        selectedMimeType = mimeType;
        break;
      }
    }
    
    const startRecording = () => {
      if (cancelledRef.current) return;
      
      // Get the media stream from video playback
      const videoWithCapture = video as HTMLVideoElement & { 
        captureStream?: (frameRate?: number) => MediaStream;
        mozCaptureStream?: (frameRate?: number) => MediaStream;
      };
      
      let stream: MediaStream | null = null;
      
      try {
        if (videoWithCapture.captureStream) {
          stream = videoWithCapture.captureStream();
        } else if (videoWithCapture.mozCaptureStream) {
          stream = videoWithCapture.mozCaptureStream();
        }
      } catch (err) {
        console.error('Failed to capture stream:', err);
        setProgress(prev => ({
          ...prev,
          phase: 'error',
          error: 'Failed to capture video stream. This browser may not support video capture.',
        }));
        cleanup();
        return;
      }
      
      if (!stream) {
        setProgress(prev => ({
          ...prev,
          phase: 'error',
          error: 'Video capture is not supported in this browser.',
        }));
        cleanup();
        return;
      }
      
      // Create MediaRecorder
      try {
        const mediaRecorder = new MediaRecorder(stream, {
          mimeType: selectedMimeType,
          videoBitsPerSecond: 8000000,
        });
        mediaRecorderRef.current = mediaRecorder;
        
        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            recordedChunksRef.current.push(event.data);
          }
        };
        
        mediaRecorder.onstop = () => {
          if (cancelledRef.current) return;
          
          setProgress(prev => ({
            ...prev,
            phase: 'finalizing',
            percentage: 95,
          }));
          
          // Create and download the file
          const blob = new Blob(recordedChunksRef.current, { type: selectedMimeType });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `video.${selectedMimeType.includes('webm') ? 'webm' : 'mp4'}`;
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
        };
        
        mediaRecorder.onerror = () => {
          if (cancelledRef.current) return;
          setProgress(prev => ({
            ...prev,
            phase: 'error',
            error: 'Recording failed.',
          }));
          cleanup();
        };
        
        // Start recording with 100ms chunks
        mediaRecorder.start(100);
        
        setProgress(prev => ({
          ...prev,
          phase: 'recording',
        }));
        
      } catch (err) {
        console.error('MediaRecorder error:', err);
        setProgress(prev => ({
          ...prev,
          phase: 'error',
          error: `Recording not supported: ${err instanceof Error ? err.message : 'Unknown error'}`,
        }));
        cleanup();
        return;
      }
    };
    
    // Track playback progress
    video.ontimeupdate = () => {
      if (cancelledRef.current) return;
      const percentage = video.duration ? Math.round((video.currentTime / video.duration) * 100) : 0;
      setProgress(prev => ({
        ...prev,
        percentage: Math.min(percentage, 95),
        duration: video.duration || 0,
        currentTime: video.currentTime,
      }));
    };
    
    // Handle video end
    video.onended = () => {
      if (cancelledRef.current) return;
      
      // Stop recording
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
    };
    
    // Handle errors
    video.onerror = () => {
      if (cancelledRef.current) return;
      setProgress(prev => ({
        ...prev,
        phase: 'error',
        error: 'Failed to load video. The stream may be unavailable.',
      }));
      cleanup();
    };
    
    // Load stream using hls.js
    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
      });
      hlsRef.current = hls;
      
      hls.loadSource(playlistUrl);
      hls.attachMedia(video);
      
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (cancelledRef.current) return;
        
        setProgress(prev => ({
          ...prev,
          phase: 'playing',
        }));
        
        // Start playback
        video.play().then(() => {
          // Start recording after playback begins
          // Small delay to ensure video is actually playing
          setTimeout(() => {
            if (!cancelledRef.current) {
              startRecording();
            }
          }, 100);
        }).catch((err) => {
          console.error('Playback failed:', err);
          setProgress(prev => ({
            ...prev,
            phase: 'error',
            error: 'Failed to start playback. Try clicking the download button again.',
          }));
          cleanup();
        });
      });
      
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (cancelledRef.current) return;
        
        if (data.fatal) {
          console.error('HLS fatal error:', data);
          setProgress(prev => ({
            ...prev,
            phase: 'error',
            error: 'Failed to load stream. It may be unavailable or blocked.',
          }));
          cleanup();
        }
      });
      
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS support (Safari)
      video.src = playlistUrl;
      
      video.onloadedmetadata = () => {
        if (cancelledRef.current) return;
        
        setProgress(prev => ({
          ...prev,
          phase: 'playing',
        }));
        
        video.play().then(() => {
          setTimeout(() => {
            if (!cancelledRef.current) {
              startRecording();
            }
          }, 100);
        }).catch((err) => {
          console.error('Playback failed:', err);
          setProgress(prev => ({
            ...prev,
            phase: 'error',
            error: 'Failed to start playback.',
          }));
          cleanup();
        });
      };
      
    } else {
      setProgress(prev => ({
        ...prev,
        phase: 'error',
        error: 'HLS playback is not supported in this browser.',
      }));
      cleanup();
    }
  }, [cleanup]);
  
  return {
    progress,
    isDownloading: progress.phase !== 'idle' && progress.phase !== 'complete' && progress.phase !== 'error',
    startDownload,
    cancelDownload,
  };
}
