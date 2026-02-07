import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Search } from 'lucide-react';

interface UrlInputProps {
  onAnalyze: (url: string) => void;
  isLoading: boolean;
}

export function UrlInput({ onAnalyze, isLoading }: UrlInputProps) {
  const [url, setUrl] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (url.trim()) {
      onAnalyze(url.trim());
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="m3u8-url" className="text-sm font-medium text-foreground">
          M3U8 Playlist URL
        </label>
        <div className="flex gap-3">
          <Input
            id="m3u8-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/stream/playlist.m3u8"
            className="flex-1 font-mono text-sm bg-muted/50 border-border focus:border-primary"
            disabled={isLoading}
          />
          <Button 
            type="submit" 
            disabled={!url.trim() || isLoading}
            className="min-w-[140px]"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Search className="h-4 w-4" />
                Analyze Stream
              </>
            )}
          </Button>
        </div>
      </div>
    </form>
  );
}
