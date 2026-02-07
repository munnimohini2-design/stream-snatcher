import { AlertTriangle } from 'lucide-react';

export function Disclaimer() {
  return (
    <div className="flex items-start gap-3 p-4 rounded-lg bg-muted/30 border border-border">
      <AlertTriangle className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
      <p className="text-sm text-muted-foreground leading-relaxed">
        <span className="font-medium text-foreground">Legal Notice:</span>{' '}
        This tool supports downloading only publicly accessible media. DRM protected 
        streams are not supported. Users are responsible for ensuring they have the 
        right to download any content.
      </p>
    </div>
  );
}
