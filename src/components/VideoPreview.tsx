import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Play, AlertCircle } from 'lucide-react';
import type { StreamQuality } from '@/types/stream';
import { getProxyUrl } from '@/services/api';

interface VideoPreviewProps {
  streamUrl: string;
  qualities: StreamQuality[];
}

export function VideoPreview({ streamUrl, qualities }: VideoPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [selectedQuality, setSelectedQuality] = useState<string>(streamUrl);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    setError(null);
    setIsLoading(true);

    const proxyUrl = getProxyUrl(selectedQuality);

    if (Hls.isSupported()) {
      if (hlsRef.current) {
        hlsRef.current.destroy();
      }

      const hls = new Hls({
        xhrSetup: (xhr, url) => {
          // All URLs should go through our proxy
          if (!url.includes('/proxy?')) {
            xhr.open('GET', getProxyUrl(url), true);
          }
        },
      });

      hlsRef.current = hls;

      hls.loadSource(proxyUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setIsLoading(false);
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          setError('Failed to load stream. The URL may be invalid or inaccessible.');
          setIsLoading(false);
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS support (Safari)
      video.src = proxyUrl;
      video.addEventListener('loadedmetadata', () => setIsLoading(false));
      video.addEventListener('error', () => {
        setError('Failed to load stream.');
        setIsLoading(false);
      });
    } else {
      setError('HLS playback is not supported in this browser.');
      setIsLoading(false);
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [selectedQuality]);

  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Play className="h-5 w-5 text-primary" />
            Preview
          </CardTitle>
          {qualities.length > 1 && (
            <Select value={selectedQuality} onValueChange={setSelectedQuality}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Select quality" />
              </SelectTrigger>
              <SelectContent>
                {qualities.map((q, i) => (
                  <SelectItem key={i} value={q.url}>
                    {q.resolution || `Quality ${i + 1}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50">
              <div className="animate-pulse text-muted-foreground">Loading stream...</div>
            </div>
          )}
          {error ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-red-400">
              <AlertCircle className="h-8 w-8" />
              <p className="text-sm text-center px-4">{error}</p>
            </div>
          ) : (
            <video
              ref={videoRef}
              className="w-full h-full"
              controls
              playsInline
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}
