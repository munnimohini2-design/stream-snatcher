import { useState } from 'react';
import { UrlInput } from '@/components/UrlInput';
import { StreamInfo } from '@/components/StreamInfo';
import { VideoPreview } from '@/components/VideoPreview';
import { DownloadSection } from '@/components/DownloadSection';
import { ClientDownloadSection } from '@/components/ClientDownloadSection';
import { Disclaimer } from '@/components/Disclaimer';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle, Download, Loader2 } from 'lucide-react';
import { analyzeStream } from '@/services/api';
import { fetchAndParsePlaylist } from '@/utils/clientPlaylistParser';
import type { StreamAnalysis, ClientOnlyResponse } from '@/types/stream';

const Index = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [analysis, setAnalysis] = useState<StreamAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [streamUrl, setStreamUrl] = useState<string>('');
  const [isClientOnly, setIsClientOnly] = useState(false);

  const handleAnalyze = async (url: string) => {
    setIsLoading(true);
    setError(null);
    setAnalysis(null);
    setStreamUrl(url);
    setIsClientOnly(false);

    const result = await analyzeStream(url);

    if (result.success && result.data) {
      // Check if server returned clientOnly mode
      const data = result.data as StreamAnalysis | ClientOnlyResponse;
      
      if ('clientOnly' in data && data.clientOnly && 'directUrl' in data) {
        // Server can't access stream - fetch and parse client-side
        setIsClientOnly(true);
        try {
          const clientAnalysis = await fetchAndParsePlaylist(data.directUrl);
          setAnalysis(clientAnalysis);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to fetch playlist from browser');
        }
      } else {
        setAnalysis(data as StreamAnalysis);
      }
    } else {
      setError(result.message || 'Failed to analyze stream');
    }

    setIsLoading(false);
  };

  const getDisabledReason = (): string | undefined => {
    if (!analysis) return undefined;
    if (analysis.isLive) return 'Live streams cannot be downloaded';
    if (analysis.isEncrypted) return 'DRM/encrypted streams are not supported';
    return undefined;
  };

  const isDownloadDisabled = !analysis || analysis.isLive || analysis.isEncrypted;
  
  // Force client-only mode when analysis indicates it
  const useClientDownload = isClientOnly || analysis?.clientOnly;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Download className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground font-mono">
                HLS Stream Downloader
              </h1>
              <p className="text-sm text-muted-foreground">
                Preview and download .m3u8 video streams
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8 space-y-6">
        {/* URL Input */}
        <section>
          <UrlInput onAnalyze={handleAnalyze} isLoading={isLoading} />
        </section>

        {/* Error Alert */}
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Analysis Results */}
        {analysis && (
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Left Column */}
            <div className="space-y-6">
              <StreamInfo analysis={analysis} isClientOnly={useClientDownload} />
              {useClientDownload ? (
                <ClientDownloadSection 
                  streamUrl={analysis.directUrl || streamUrl} 
                  qualities={analysis.qualities}
                />
              ) : (
                <DownloadSection
                  streamUrl={streamUrl}
                  qualities={analysis.qualities}
                  isDisabled={isDownloadDisabled}
                  disabledReason={getDisabledReason()}
                />
              )}
            </div>

            {/* Right Column - Video Preview */}
            <div>
              <VideoPreview
                streamUrl={analysis.qualities[0]?.url || streamUrl}
                qualities={analysis.qualities}
              />
            </div>
          </div>
        )}

        {/* Disclaimer */}
        <section className="pt-4">
          <Disclaimer />
        </section>
      </main>
    </div>
  );
};

export default Index;
