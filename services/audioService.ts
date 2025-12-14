export type AudioCallbacks = {
  onTimeUpdate?: (time: number) => void;
  onDurationChange?: (duration: number) => void;
  onPlay?: () => void;
  onPause?: () => void;
  onEnded?: () => void;
  onVolumeChange?: (volume: number) => void;
  onError?: (e: any) => void;
};

export class AudioService {
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private audioElement: HTMLAudioElement;
  private callbacks: AudioCallbacks = {};
  private isCorsRestricted = false;
  private playPromise: Promise<void> | null = null;

  constructor() {
    this.audioElement = new Audio();
    this.audioElement.crossOrigin = "anonymous";
    this.audioElement.preload = "auto";
    this.bindEvents();
  }

  private bindEvents() {
    this.audioElement.ontimeupdate = () => {
      this.callbacks.onTimeUpdate?.(this.audioElement.currentTime);
    };
    this.audioElement.onloadedmetadata = () => {
      this.callbacks.onDurationChange?.(this.audioElement.duration);
    };
    this.audioElement.onplay = () => this.callbacks.onPlay?.();
    this.audioElement.onpause = () => this.callbacks.onPause?.();
    this.audioElement.onended = () => this.callbacks.onEnded?.();
    this.audioElement.onvolumechange = () => this.callbacks.onVolumeChange?.(this.audioElement.volume);
    
    this.audioElement.onerror = (e) => {
        const err = this.audioElement.error;
        console.warn("Audio Error:", err?.code, err?.message, this.audioElement.src);

        // Attempt recovery for CORS or loading errors
        if (this.audioElement.src && this.audioElement.crossOrigin === "anonymous") {
            console.log("Attempting CORS recovery (disabling visualizer context)...");
            this.audioElement.crossOrigin = null; 
            this.isCorsRestricted = true;
            // Re-assign src to trigger reload without CORS
            const currentSrc = this.audioElement.src;
            this.audioElement.src = "";
            this.audioElement.src = currentSrc;
            this.safePlay();
        } else {
            console.error("Playback failed completely.");
            this.callbacks.onError?.(err);
        }
    };
  }

  setCallbacks(c: AudioCallbacks) {
    this.callbacks = c;
    // Trigger initial state if already loaded
    if (this.audioElement.duration) c.onDurationChange?.(this.audioElement.duration);
    if (this.audioElement.currentTime) c.onTimeUpdate?.(this.audioElement.currentTime);
    c.onVolumeChange?.(this.audioElement.volume);
  }

  init() {
    // Initialize AudioContext on user interaction
    if (!this.audioContext) {
      const AudioCtor = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtor) {
          this.audioContext = new AudioCtor();
          this.analyser = this.audioContext.createAnalyser();
          this.analyser.fftSize = 256;
      }
    }

    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume().catch(e => console.warn("Context resume failed", e));
    }

    // Connect source if not restricted and contexts exist
    if (!this.source && !this.isCorsRestricted && this.audioContext && this.analyser) {
        try {
            this.source = this.audioContext.createMediaElementSource(this.audioElement);
            this.source.connect(this.analyser);
            this.analyser.connect(this.audioContext.destination);
        } catch (e) {
            console.warn("MediaElementSource connection failed (CORS?)", e);
            this.isCorsRestricted = true;
        }
    }
  }

  async play(url: string, startTime?: number) {
    if (!url) return;

    // Determine CORS policy based on URL type
    // Blob URLs are safe. External links default to anonymous for Viz, fallback later if needed.
    if (url.startsWith('blob:')) {
        this.audioElement.crossOrigin = null;
    } else {
        this.audioElement.crossOrigin = "anonymous";
        this.isCorsRestricted = false; 
    }
    
    this.init();
    
    // Prevent reloading if it's the same track and just paused? 
    // No, we want to ensure fresh state or handling new URL.
    if (this.audioElement.src !== url) {
        this.audioElement.src = url;
        this.audioElement.load();
    }

    if (startTime && startTime > 0) {
        this.audioElement.currentTime = startTime;
    }

    this.safePlay();
  }

  private safePlay() {
      this.playPromise = this.audioElement.play();
      if (this.playPromise !== undefined) {
          this.playPromise.catch(error => {
              if (error.name === 'NotAllowedError') {
                  console.warn("Autoplay prevented. Interaction needed.");
              } else if (error.name !== 'AbortError') {
                  console.error("Play Promise Error:", error);
                  // Manually trigger error callback if not handled by onerror
                  this.callbacks.onError?.(error);
              }
          });
      }
  }

  togglePlay() {
    if (this.audioElement.paused) {
      this.init();
      this.safePlay();
    } else {
      this.audioElement.pause();
    }
  }

  seek(time: number) {
    if (!Number.isFinite(time)) return;
    // Check if seekable
    if (this.audioElement.readyState > 0) {
        this.audioElement.currentTime = time;
    } else {
        // Queue seek? For now just try setting it, browsers handle this if metadata known
        try { this.audioElement.currentTime = time; } catch(e) {}
    }
  }

  skip(seconds: number) {
    this.seek(this.audioElement.currentTime + seconds);
  }

  setVolume(val: number) {
    this.audioElement.volume = Math.max(0, Math.min(1, val));
  }

  getFrequencyData(): Uint8Array {
    if (!this.analyser || this.isCorsRestricted) return new Uint8Array(0);
    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    this.analyser.getByteFrequencyData(dataArray);
    return dataArray;
  }

  get isPaused() {
    return this.audioElement.paused;
  }

  get duration() {
    return this.audioElement.duration || 0;
  }

  get currentTime() {
    return this.audioElement.currentTime || 0;
  }
}

export const audioService = new AudioService();
