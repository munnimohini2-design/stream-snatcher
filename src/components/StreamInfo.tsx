import type { StreamAnalysis } from '@/types/stream';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle2, AlertTriangle, Radio, Film, Lock, Unlock } from 'lucide-react';
import { formatBandwidth } from '@/utils/hlsParser';

interface StreamInfoProps {
  analysis: StreamAnalysis;
  isClientOnly?: boolean;
}

export function StreamInfo({ analysis, isClientOnly }: StreamInfoProps) {
  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Film className="h-5 w-5 text-primary" />
          Stream Analysis
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status Badges */}
        <div className="flex flex-wrap gap-2">
          {/* Stream Type */}
          {analysis.isLive ? (
            <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 hover:bg-amber-500/30">
              <Radio className="h-3 w-3 mr-1" />
              LIVE
            </Badge>
          ) : (
            <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/30">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              VOD
            </Badge>
          )}
          
          {/* Playlist Type */}
          <Badge variant="outline" className="border-muted-foreground/30">
            {analysis.type === 'master' ? 'Master Playlist' : 'Media Playlist'}
          </Badge>
          
          {/* Encryption Status */}
          {analysis.isEncrypted ? (
            <Badge className="bg-red-500/20 text-red-400 border-red-500/30 hover:bg-red-500/30">
              <Lock className="h-3 w-3 mr-1" />
              Encrypted
            </Badge>
          ) : (
            <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/30">
              <Unlock className="h-3 w-3 mr-1" />
              Unencrypted
            </Badge>
          )}
        </div>

        {/* Warnings */}
        {analysis.isLive && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
            <p className="text-sm text-amber-300">
              Live streams cannot be downloaded. Only VOD content is supported.
            </p>
          </div>
        )}
        
        {analysis.isEncrypted && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
            <Lock className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
            <p className="text-sm text-red-300">
              DRM/encrypted streams are not supported by this tool.
            </p>
          </div>
        )}

        {/* Quality Variants */}
        {analysis.qualities.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-muted-foreground">
              Available Qualities ({analysis.qualities.length})
            </h4>
            <div className="grid gap-2">
              {analysis.qualities.map((quality, index) => (
                <div 
                  key={index}
                  className="flex items-center justify-between p-2 rounded bg-muted/30 border border-border/50"
                >
                  <span className="font-mono text-sm text-foreground">
                    {quality.resolution || 'Unknown'}
                  </span>
                  <span className="text-xs text-muted-foreground font-mono">
                    {formatBandwidth(quality.bandwidth)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
