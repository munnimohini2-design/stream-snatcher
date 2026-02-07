export interface StreamQuality {
  resolution: string;
  bandwidth: number;
  url: string;
}

export interface StreamAnalysis {
  type: 'master' | 'media';
  isLive: boolean;
  isEncrypted: boolean;
  clientOnly?: boolean;
  directUrl?: string;
  baseUrl: string;
  qualities: StreamQuality[];
  message?: string;
}

export interface ClientOnlyResponse {
  clientOnly: true;
  directUrl: string;
  message: string;
}

export interface AnalyzeResponse {
  success: boolean;
  data?: StreamAnalysis;
  error?: string;
  message?: string;
}

export interface DownloadUrlResponse {
  success: boolean;
  downloadUrl?: string;
  error?: string;
  message?: string;
}
