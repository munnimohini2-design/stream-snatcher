import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Download, Loader2, AlertCircle, XCircle, CheckCircle2, Monitor } from 'lucide-react';
import { useClientDownloader } from '@/hooks/useClientDownloader';

interface ClientDownloadSectionProps {
  streamUrl: string;
}

export function ClientDownloadSection({ streamUrl }: ClientDownloadSectionProps) {
  const { progress, isDownloading, startDownload, cancelDownload } = useClientDownloader();

  const handleDownload = () => {
    startDownload(streamUrl);
  };

  const getPhaseText = () => {
    switch (progress.phase) {
      case 'fetching':
        return `Downloading segments (${progress.segmentsLoaded}/${progress.totalSegments})...`;
      case 'recording':
        return 'Recording video...';
      case 'finalizing':
        return 'Finalizing...';
      case 'complete':
        return 'Download complete!';
      case 'error':
        return progress.error || 'Download failed';
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

        {/* Action buttons */}
        <div className="flex gap-3">
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

        <p className="text-xs text-muted-foreground">
          Browser-based download uses MediaRecorder. The video will play at normal speed while recording.
        </p>
      </CardContent>
    </Card>
  );
}
