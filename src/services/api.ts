import type { AnalyzeResponse, DownloadUrlResponse } from '@/types/stream';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

export async function analyzeStream(url: string): Promise<AnalyzeResponse> {
  try {
    const response = await fetch(`${API_BASE}/analyze?url=${encodeURIComponent(url)}`);
    const data = await response.json();
    
    if (!response.ok) {
      return { success: false, error: data.error, message: data.message };
    }
    
    return { success: true, data };
  } catch (error) {
    return { 
      success: false, 
      error: 'Network error', 
      message: 'Unable to fetch stream. Check the URL.' 
    };
  }
}

export async function getDownloadUrl(m3u8Url: string, qualityUrl?: string): Promise<DownloadUrlResponse> {
  try {
    const params = new URLSearchParams({ url: m3u8Url });
    if (qualityUrl) {
      params.append('quality', qualityUrl);
    }
    
    const response = await fetch(`${API_BASE}/download-url?${params.toString()}`);
    const data = await response.json();
    
    if (!response.ok) {
      return { success: false, error: data.error, message: data.message };
    }
    
    return { success: true, downloadUrl: data.downloadUrl };
  } catch (error) {
    return { 
      success: false, 
      error: 'Network error', 
      message: 'Unable to generate download URL.' 
    };
  }
}

export function getProxyUrl(url: string): string {
  return `${API_BASE}/proxy?url=${encodeURIComponent(url)}`;
}
