import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Download, Loader2, AlertCircle } from 'lucide-react';
import type { StreamQuality } from '@/types/stream';
import { getDownloadUrl } from '@/services/api';

interface DownloadSectionProps {
  streamUrl: string;
  qualities: StreamQuality[];
  isDisabled: boolean;
  disabledReason?: string;
}

export function DownloadSection({ 
  streamUrl, 
  qualities, 
  isDisabled,
  disabledReason 
}: DownloadSectionProps) {
  const [selectedQuality, setSelectedQuality] = useState<string>(
    qualities[0]?.url || streamUrl
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDownload = async () => {
    setIsLoading(true);
    setError(null);

    const result = await getDownloadUrl(streamUrl, selectedQuality);
    
    if (result.success && result.downloadUrl) {
      // Redirect to worker download URL
      window.location.href = result.downloadUrl;
    } else {
      setError(result.message || 'Failed to generate download URL');
    }
    
    setIsLoading(false);
  };

  const selectedQualityInfo = qualities.find(q => q.url === selectedQuality);

  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Download className="h-5 w-5 text-primary" />
          Download
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isDisabled && disabledReason && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
            <AlertCircle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
            <p className="text-sm text-red-300">{disabledReason}</p>
          </div>
        )}

        <div className="flex gap-3">
          {qualities.length > 1 && (
            <Select 
              value={selectedQuality} 
              onValueChange={setSelectedQuality}
              disabled={isDisabled}
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
          
          <Button 
            onClick={handleDownload}
            disabled={isDisabled || isLoading}
            className="min-w-[160px]"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Preparing...
              </>
            ) : (
              <>
                <Download className="h-4 w-4" />
                Download MP4
              </>
            )}
          </Button>
        </div>

        {selectedQualityInfo && !isDisabled && (
          <p className="text-xs text-muted-foreground">
            Selected: {selectedQualityInfo.resolution || 'Default quality'}
          </p>
        )}

        {error && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
            <AlertCircle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
            <p className="text-sm text-red-300">{error}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
