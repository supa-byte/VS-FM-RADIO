export enum ListeningMode {
  NIGHT_BRAIN = 'NIGHT_BRAIN',
  SUN_DAY = 'SUN_DAY',
  SILENT_COMPANION = 'SILENT_COMPANION',
  CONTROL_FREE = 'CONTROL_FREE',
  FOCUS_DRIFT = 'FOCUS_DRIFT',
  MEMORY_RECALL = 'MEMORY_RECALL',
  BACKGROUND_LIFE = 'BACKGROUND_LIFE'
}

export interface Track {
  id: string;
  title: string;
  artist?: string;
  url: string;
  originalUrl?: string; // Critical for refreshing expired streams (YouTube/Telegram)
  duration: number; 
  fileType: 'audio' | 'video';
  file?: Blob; // Local file persistence
}

export interface Playlist {
  id: string;
  name: string;
  tracks: Track[];
  isSystemGenerated: boolean;
  associatedMode?: ListeningMode; 
}

export interface ChatEntry {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: number;
}

export interface AIState {
  isListening: boolean;
  isProcessing: boolean;
  currentThought: string;
  mode: ListeningMode;
}

export interface PendingAction {
  type: 'DELETE_PLAYLIST' | 'DELETE_TRACK' | 'CLEAR_ALL';
  data: any;
  description: string;
}

export interface NotificationState {
  text: string;
  type: 'voice' | 'gesture' | 'error' | 'success' | 'info';
  id: number;
}