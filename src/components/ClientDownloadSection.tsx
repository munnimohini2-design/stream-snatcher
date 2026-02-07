import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Download, AlertCircle, XCircle, CheckCircle2, Monitor, ShieldAlert } from 'lucide-react';
import { useClientDownloader } from '@/hooks/useClientDownloader';
import type { StreamQuality } from '@/types/stream';

interface ClientDownloadSectionProps {
  streamUrl: string;
  qualities: StreamQuality[];
}

export function ClientDownloadSection({ streamUrl, qualities }: ClientDownloadSectionProps) {
  const [selectedQuality, setSelectedQuality] = useState<string>(
    qualities[0]?.url || streamUrl
  );
  const { progress, isDownloading, startDownload, cancelDownload } = useClientDownloader();

  const handleDownload = () => {
    startDownload(selectedQuality);
  };

  const selectedQualityInfo = qualities.find(q => q.url === selectedQuality);

  const getPhaseText = () => {
    switch (progress.phase) {
      case 'loading':
        return 'Loading stream...';
      case 'playing':
        return 'Starting playback...';
      case 'recording':
        const timeText = progress.duration > 0 
          ? ` (${Math.floor(progress.currentTime)}s / ${Math.floor(progress.duration)}s)`
          : '';
        return `Recording video${timeText}...`;
      case 'finalizing':
        return 'Finalizing...';
      case 'complete':
        return 'Download complete!';
      case 'error':
        return progress.error || 'Download failed';
      case 'sessionProtected':
        return progress.error || 'Session-protected stream';
      default:
        return 'Ready to download';
    }
  };

  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Monitor className="h-5 w-5 text-primary" />
          Browser Download
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Info banner */}
        <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
          <AlertCircle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
          <div className="text-sm text-amber-300">
            <p className="font-medium">IP-Restricted Stream</p>
            <p className="text-amber-300/80 mt-1">
              This stream only works from your IP. Downloading directly in the browser.
            </p>
          </div>
        </div>

        {/* Progress */}
        {isDownloading && (
          <div className="space-y-2">
            <Progress value={progress.percentage} className="h-2" />
            <p className="text-sm text-muted-foreground">{getPhaseText()}</p>
          </div>
        )}

        {/* Complete status */}
        {progress.phase === 'complete' && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
            <CheckCircle2 className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
            <p className="text-sm text-emerald-300">{getPhaseText()}</p>
          </div>
        )}

        {/* Error status */}
        {progress.phase === 'error' && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
            <XCircle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
            <p className="text-sm text-red-300">{getPhaseText()}</p>
          </div>
        )}

        {/* Session-protected status */}
        {progress.phase === 'sessionProtected' && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-purple-500/10 border border-purple-500/20">
            <ShieldAlert className="h-4 w-4 text-purple-400 mt-0.5 shrink-0" />
            <div className="text-sm text-purple-300">
              <p className="font-medium mb-1">Session-Protected Stream</p>
              <p className="text-purple-300/80">{getPhaseText()}</p>
            </div>
          </div>
        )}

        {/* Quality selector and action buttons */}
        {progress.phase !== 'sessionProtected' && (
          <div className="flex gap-3">
            {qualities.length > 1 && !isDownloading && (
              <Select 
                value={selectedQuality} 
                onValueChange={setSelectedQuality}
                disabled={progress.phase === 'complete'}
              >
                <SelectTrigger className="flex-1">
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
          
            {isDownloading ? (
              <Button 
                variant="destructive" 
                onClick={cancelDownload}
                className="min-w-[160px]"
              >
                <XCircle className="h-4 w-4" />
                Cancel
              </Button>
            ) : (
              <Button 
                onClick={handleDownload}
                disabled={progress.phase === 'complete'}
                className="min-w-[160px]"
              >
                {progress.phase === 'complete' ? (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    Downloaded
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4" />
                    Download WebM
                  </>
                )}
              </Button>
            )}
          </div>
        )}

        {selectedQualityInfo && selectedQualityInfo.resolution && progress.phase !== 'sessionProtected' && (
          <p className="text-xs text-muted-foreground">
            Selected: {selectedQualityInfo.resolution}
          </p>
        )}

        {progress.phase !== 'sessionProtected' && (
          <p className="text-xs text-muted-foreground">
            Browser-based download uses MediaRecorder. The video will play at normal speed while recording.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
