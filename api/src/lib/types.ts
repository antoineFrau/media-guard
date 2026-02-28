export interface TranscriptSegment {
  text: string;
  start: number;
  end: number;
}

export interface Alert {
  type: string;
  technique?: string;
  quote?: string;
  explanation?: string;
  severity?: string;
  start: number;
  end: number;
}

export interface FactCheck {
  claim?: string;
  verdict?: string;
  context?: string;
  sources?: string[];
  start: number;
  end: number;
}

export interface AnalysisResult {
  video_id: string;
  alerts: Alert[];
  fact_checks: FactCheck[];
}
