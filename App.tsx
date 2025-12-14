import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as d3 from 'd3';
import { Visualizer } from './components/Visualizer';
import { LiveVoiceAgent } from './components/LiveVoiceAgent';
import { ConfirmationModal } from './components/ConfirmationModal';
import { audioService } from './services/audioService';
import { persistenceService } from './services/persistenceService';
import { Playlist, Track, ListeningMode, PendingAction, NotificationState } from './types';
import { 
  PlayIcon, PauseIcon, NextIcon, PrevIcon, ShuffleIcon, SearchIcon, 
  SkipForward5Icon, SkipBack5Icon, MicIcon, FolderIcon, FileIcon, 
  ListIcon, CloseIcon, SunIcon, MoonIcon, LinkIcon 
} from './components/Icons';

// Utils
const vibrate = (pattern: number | number[]) => { if (navigator.vibrate) navigator.vibrate(pattern); };
const formatTime = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
};

// --- MEDIA RESOLVER ---
const resolveMediaUrl = async (inputUrl: string): Promise<{ url: string, title?: string, isStream: boolean }> => {
    // Basic direct check: if it ends in mp3, wav, m4a, ogg, etc.
    if (/\.(mp3|wav|m4a|ogg|aac|m3u8|pls)$/i.test(inputUrl)) {
        return { url: inputUrl, isStream: true };
    }

    const platforms = ['youtube.com', 'youtu.be', 'instagram.com', 'tiktok.com', 'soundcloud.com', 'twitch.tv', 'twitter.com', 'x.com', 'reddit.com'];
    const isPlatform = platforms.some(p => inputUrl.includes(p));

    if (isPlatform) {
        try {
            // Cobalt API for extraction
            const response = await fetch('https://api.cobalt.tools/api/json', {
                method: 'POST',
                headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: inputUrl, aFormat: 'mp3', isAudioOnly: true })
            });
            const data = await response.json();
            
            if (data.url) return { url: data.url, title: "Imported Stream", isStream: true };
            if (data.picker && data.picker.length > 0) return { url: data.picker[0].url, isStream: true };
            
        } catch (e) {
            console.warn("Cobalt extraction failed for", inputUrl, e);
        }
    }

    // Fallback: Return original URL. 
    return { url: inputUrl, isStream: false };
};

export default function App() {
  // --- STATE ---
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [currentPlaylistId, setCurrentPlaylistId] = useState<string | null>(null);
  const [currentTrackIndex, setCurrentTrackIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  
  // Notification System
  const [notification, setNotification] = useState<NotificationState | null>(null);

  const [mode, setMode] = useState<ListeningMode>(ListeningMode.NIGHT_BRAIN);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [showPlaylist, setShowPlaylist] = useState(false);
  const [renamingTrackId, setRenamingTrackId] = useState<string | null>(null);
  
  // Controls
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  
  // Link Modal
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [linkInput, setLinkInput] = useState("");

  // --- REFS ---
  const playButtonRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const touchStartRef = useRef<{x: number, y: number} | null>(null);
  const savedProgressRef = useRef<number>(0);
  const retryCountRef = useRef<number>(0);

  // --- DERIVED ---
  const isDay = mode === ListeningMode.SUN_DAY;
  const currentPlaylist = playlists.find(p => p.id === currentPlaylistId);
  const currentTrack = currentPlaylist?.tracks[currentTrackIndex];
  const displayTracks = currentPlaylist?.tracks.filter(t => t.title.toLowerCase().includes(searchQuery.toLowerCase())) || [];

  // --- THEME ---
  const theme = isDay ? {
    bg: 'bg-slate-50', text: 'text-slate-900', accent: 'text-blue-600', sub: 'text-slate-500',
    panel: 'bg-white/60 border-white/60 shadow-xl shadow-blue-900/5', 
    activeItem: 'bg-blue-100 text-blue-700',
    buttonBase: 'bg-white/40 border-blue-200 text-slate-700',
    iconBase: 'text-slate-700',
    barBg: 'bg-slate-200', barFill: 'bg-blue-500'
  } : {
    bg: 'bg-black', text: 'text-white', accent: 'text-red-500', sub: 'text-zinc-500',
    panel: 'bg-zinc-900/60 border-zinc-800/60 shadow-xl shadow-black/80', 
    activeItem: 'bg-red-900/20 text-red-300',
    buttonBase: 'bg-zinc-900/40 border-red-900/30 text-zinc-300',
    iconBase: 'text-zinc-300',
    barBg: 'bg-zinc-800', barFill: 'bg-red-600'
  };

  // --- NOTIFICATION HANDLER ---
  const showToast = useCallback((text: string, type: 'voice' | 'gesture' | 'error' | 'success' | 'info' = 'info') => {
    setNotification({ text, type, id: Date.now() });
    
    // Haptic Feedback Patterns
    if (type === 'gesture') vibrate(15);
    if (type === 'error') vibrate([50, 50, 50]);
    if (type === 'success') vibrate([10, 30]);
    if (type === 'voice') vibrate(10);
    
    // Auto-dismiss logic is handled by animation or effect, but here we just update state
    // The key update forces re-render of the popup
  }, []);

  // --- INIT & PERSISTENCE ---
  useEffect(() => {
    const load = async () => {
      try {
        await persistenceService.init();
        const savedPls = await persistenceService.loadPlaylists();
        if (savedPls.length) setPlaylists(savedPls);
        
        const state = await persistenceService.loadState('last_session');
        if (state) {
          if(state.mode) setMode(state.mode);
          if(state.plId) setCurrentPlaylistId(state.plId);
          if(state.trIdx !== undefined) setCurrentTrackIndex(state.trIdx);
          if(state.volume !== undefined) {
             setVolume(state.volume);
             audioService.setVolume(state.volume);
          }
          if (state.currentTime) {
             savedProgressRef.current = state.currentTime;
             setProgress(state.currentTime);
          }
          if (state.isVoiceActive) setIsVoiceActive(true);
        }
        
        if(!state && savedPls.length === 0) showToast("Tap Center to Start", "info");
      } catch (e) { console.error("Persistence Load Error", e); }
    };
    load();
  }, [showToast]);

  // Save State
  useEffect(() => {
    if(playlists.length) persistenceService.savePlaylists(playlists);
    
    const timeout = setTimeout(() => {
       persistenceService.saveState('last_session', { 
           mode, 
           plId: currentPlaylistId, 
           trIdx: currentTrackIndex, 
           volume,
           currentTime: progress,
           isVoiceActive
       });
    }, 1000);
    return () => clearTimeout(timeout);
  }, [playlists, mode, currentPlaylistId, currentTrackIndex, volume, progress, isVoiceActive]);

  // --- AUDIO CALLBACKS ---
  useEffect(() => {
    audioService.setCallbacks({
      onEnded: nextTrack,
      onPlay: () => { 
        setIsPlaying(true); 
        retryCountRef.current = 0; 
      },
      onPause: () => setIsPlaying(false),
      onTimeUpdate: (t) => setProgress(t),
      onDurationChange: (d) => {
          setDuration(d);
          if (savedProgressRef.current > 0) {
              audioService.seek(savedProgressRef.current);
              savedProgressRef.current = 0;
          }
      },
      onVolumeChange: (v) => setVolume(v),
      onError: (e) => {
          console.error("Track Error", e);
          if (retryCountRef.current < 2) {
              retryCountRef.current++;
              showToast("Retrying Source...", "error");
              playTrack(currentTrack);
          } else {
              showToast("Source Unavailable - Skipping", "error");
              retryCountRef.current = 0;
              setTimeout(nextTrack, 1000);
          }
      }
    });
  }, [currentPlaylistId, currentTrackIndex, showToast]); 

  // --- VISUAL LOOP ---
  useEffect(() => {
    let rafId: number;
    const loop = () => {
      const data = audioService.getFrequencyData();
      const bass = d3.mean(data.slice(0, 10)) || 0;
      const mids = d3.mean(data.slice(40, 100)) || 0;

      if (playButtonRef.current) {
        const targetScale = 1 + (bass / 255) * 0.25; 
        let colorString, glowColorString;
        if (isDay) {
           const hue = 210 + (bass * 0.1); 
           colorString = `hsl(${hue}, 90%, 60%)`;
           glowColorString = `hsl(${hue}, 90%, 60%, 0.6)`;
        } else {
           const hue = (bass > 150 ? 10 + (bass/10) : 0) - (mids / 5);
           colorString = `hsl(${hue}, 100%, ${50 + bass/10}%)`;
           glowColorString = `hsl(${hue}, 100%, 50%, ${0.3 + (bass/400)})`;
        }
        playButtonRef.current.style.transform = `scale(${targetScale})`;
        playButtonRef.current.style.boxShadow = `
            0 0 ${20 + bass * 0.3}px ${5 + mids * 0.1}px ${glowColorString}, 
            inset 0 0 20px ${glowColorString}
        `;
        playButtonRef.current.style.borderColor = colorString;
      }
      rafId = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(rafId);
  }, [isDay, isPlaying]);

  // --- PLAYBACK CONTROLS ---
  const playTrack = useCallback(async (t: Track | undefined) => {
    if (!t) return;
    
    let playUrl = t.url;
    // Don't toast here to avoid spamming, rely on button clicks or resolving toasts
    
    // LAZY REFRESH
    if (t.originalUrl && !t.file) {
       const isRefreshable = ['youtube.com', 'youtu.be', 'instagram.com', 'tiktok.com', 'soundcloud.com'].some(p => t.originalUrl!.includes(p));
       
       if (isRefreshable && (playUrl.includes("googlevideo") || playUrl.includes("fbcdn") || playUrl.includes("cdn"))) {
           try {
               const { url } = await resolveMediaUrl(t.originalUrl);
               if (url && url !== t.url) {
                   playUrl = url;
                   setPlaylists(prev => prev.map(p => ({
                       ...p,
                       tracks: p.tracks.map(tr => tr.id === t.id ? { ...tr, url } : tr)
                   })));
               }
           } catch(e) { console.warn("Refresh failed"); }
       }
    }

    const startAt = (t.id === currentTrack?.id && savedProgressRef.current > 0) ? savedProgressRef.current : 0;
    audioService.play(playUrl, startAt);
    setIsPlaying(true);
    showToast(`Playing: ${t.title}`, "info");
  }, [currentTrack, showToast]); 

  const nextTrack = useCallback(() => {
    setPlaylists(currentPlaylists => {
       const plId = currentPlaylistId; 
       if (!plId) return currentPlaylists;
       const pl = currentPlaylists.find(p => p.id === plId);
       if (!pl || !pl.tracks.length) return currentPlaylists;
       const nextIdx = (currentTrackIndex + 1) % pl.tracks.length;
       setCurrentTrackIndex(nextIdx);
       setTimeout(() => playTrack(pl.tracks[nextIdx]), 0);
       return currentPlaylists;
    });
  }, [currentPlaylistId, currentTrackIndex, playTrack]); 

  // --- BUTTON HANDLERS ---
  const handleNextBtn = () => {
      showToast("Next Track", "gesture");
      if (!currentPlaylist || !currentPlaylist.tracks.length) return;
      const nextIdx = (currentTrackIndex + 1) % currentPlaylist.tracks.length;
      setCurrentTrackIndex(nextIdx);
      playTrack(currentPlaylist.tracks[nextIdx]);
  };

  const handlePrevBtn = () => {
      showToast("Previous Track", "gesture");
      if (!currentPlaylist || !currentPlaylist.tracks.length) return;
      const prevIdx = (currentTrackIndex - 1 + currentPlaylist.tracks.length) % currentPlaylist.tracks.length;
      setCurrentTrackIndex(prevIdx);
      playTrack(currentPlaylist.tracks[prevIdx]);
  };

  const shufflePlaylist = () => {
    if (!currentPlaylist) return;
    const shuffled = [...currentPlaylist.tracks].sort(() => Math.random() - 0.5);
    setPlaylists(prev => prev.map(p => p.id === currentPlaylistId ? { ...p, tracks: shuffled } : p));
    setCurrentTrackIndex(0);
    playTrack(shuffled[0]);
    showToast("Playlist Shuffled", "gesture");
  };

  // --- AI PLAYLIST GEN ---
  const generateMoodPlaylist = () => {
      const allTracks = playlists.flatMap(p => p.tracks);
      if (allTracks.length === 0) { showToast("No tracks to mix", "error"); return; }
      
      const keywords = {
          [ListeningMode.SUN_DAY]: ['feat', 'remix', 'up', 'dance', 'pop', 'rock', 'high'],
          [ListeningMode.NIGHT_BRAIN]: ['lofi', 'chill', 'slow', 'ambient', 'dark', 'night'],
          [ListeningMode.SILENT_COMPANION]: ['piano', 'instrumental', 'soft'],
      };
      
      const targetKeywords = keywords[mode as keyof typeof keywords] || [];
      let selected = allTracks.filter(t => targetKeywords.some(k => t.title.toLowerCase().includes(k)));
      
      if (selected.length < 5) {
          const remaining = allTracks.filter(t => !selected.includes(t));
          const randomFill = remaining.sort(() => Math.random() - 0.5).slice(0, 10 - selected.length);
          selected = [...selected, ...randomFill];
      }
      
      selected = selected.sort(() => Math.random() - 0.5);

      const newPlId = Math.random().toString(36).substr(2, 9);
      const newPl: Playlist = {
          id: newPlId,
          name: `AI Mix: ${mode.replace('_', ' ')}`,
          tracks: selected,
          isSystemGenerated: true
      };
      
      setPlaylists(prev => [...prev, newPl]);
      setCurrentPlaylistId(newPlId);
      setCurrentTrackIndex(0);
      playTrack(selected[0]);
      showToast(`AI Mix Created`, "voice");
  };

  // --- HANDLERS ---
  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = Number(e.target.value);
    audioService.seek(time);
    setProgress(time);
  };
  const handleVolume = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    audioService.setVolume(v);
    setVolume(v);
  };
  const skip = (seconds: number) => { 
      audioService.skip(seconds); 
      showToast(seconds > 0 ? "+5s" : "-5s", "gesture");
  };

  // --- GESTURES ---
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStartRef.current) return;
    const deltaX = e.changedTouches[0].clientX - touchStartRef.current.x;
    const deltaY = e.changedTouches[0].clientY - touchStartRef.current.y;
    
    // Quick Swipe Logic
    if (Math.abs(deltaX) > 50 && Math.abs(deltaY) < 50) {
      if (deltaX > 0) handlePrevBtn(); else handleNextBtn();
    }
    // Volume Swipe
    if (Math.abs(deltaY) > 50 && Math.abs(deltaX) < 50) {
        const volChange = deltaY > 0 ? -0.1 : 0.1; 
        const newVol = Math.max(0, Math.min(1, volume + volChange));
        audioService.setVolume(newVol);
        setVolume(newVol);
        showToast(`Volume: ${Math.round(newVol * 100)}%`, "gesture");
    }
    touchStartRef.current = null;
  };

  // --- LINK IMPORT ---
  const processLinkImport = async () => {
    const url = linkInput.trim();
    if (!url) { setShowLinkModal(false); return; }

    setShowLinkModal(false);
    showToast("Resolving URL...", "info");
    setLinkInput("");
    
    try {
        const { url: playableUrl, title: resolvedTitle, isStream } = await resolveMediaUrl(url);
        
        let title = resolvedTitle || "Radio Stream";
        if (!resolvedTitle) {
            try {
               const urlObj = new URL(url);
               const path = urlObj.pathname.split('/').pop();
               if(path && path.length > 2) title = decodeURIComponent(path).replace(/\.[^/.]+$/, "");
            } catch(e) { }
        }

        const newTrack: Track = {
            id: Math.random().toString(36).substr(2, 9),
            title: title.substring(0, 50),
            url: playableUrl,
            originalUrl: url,
            duration: 0,
            fileType: 'audio'
        };

        // TARGET PLAYLIST: "Radio Streams"
        const plName = "Radio Streams";
        let targetPl = playlists.find(p => p.name === plName);
        
        if (!targetPl) {
            targetPl = { id: Math.random().toString(36), name: plName, tracks: [newTrack], isSystemGenerated: false };
            setPlaylists(prev => [...prev, targetPl!]);
            setCurrentPlaylistId(targetPl.id);
            setCurrentTrackIndex(0);
        } else {
             setPlaylists(prev => prev.map(p => p.id === targetPl!.id ? { ...p, tracks: [...p.tracks, newTrack] } : p));
             if(currentPlaylistId !== targetPl.id) setCurrentPlaylistId(targetPl.id);
             setCurrentTrackIndex(targetPl.tracks.length);
        }
        
        playTrack(newTrack);
        showToast("Stream Added", "success");

    } catch (e) {
        console.error(e);
        showToast("Invalid Link", "error");
    }
  };

  const handleRename = (id: string, newName: string) => {
    if (!newName.trim()) return;
    setPlaylists(prev => prev.map(p => p.id === currentPlaylistId ? {
      ...p, tracks: p.tracks.map(t => t.id === id ? { ...t, title: newName } : t)
    } : p));
    setRenamingTrackId(null);
  };
  
  const handleFiles = (files: FileList | null, isFolder = false) => {
     if (!files || files.length === 0) return;
     const newTracks: Track[] = Array.from(files)
      .filter(f => f.type.startsWith('audio/') || f.type.startsWith('video/'))
      .map(f => ({
        id: Math.random().toString(36).substr(2, 9),
        title: f.name.replace(/\.[^/.]+$/, ""),
        url: URL.createObjectURL(f),
        duration: 0,
        fileType: 'audio',
        file: f
      }));
      if(!newTracks.length) { showToast("No audio found", "error"); return; }
      
      if(isFolder) {
         const folderName = files[0].webkitRelativePath.split('/')[0] || "New Folder";
         const newPl: Playlist = { id: Math.random().toString(36), name: folderName, tracks: newTracks, isSystemGenerated: false };
         setPlaylists(p => [...p, newPl]);
         setCurrentPlaylistId(newPl.id);
         setCurrentTrackIndex(0);
         playTrack(newTracks[0]);
         showToast(`Imported ${folderName}`, "success");
      } else {
         if(!currentPlaylist) {
             const newPl = { id: '1', name: 'My Uploads', tracks: newTracks, isSystemGenerated: false };
             setPlaylists([newPl]);
             setCurrentPlaylistId('1');
             playTrack(newTracks[0]);
         } else {
             setPlaylists(p => p.map(pl => pl.id === currentPlaylistId ? {...pl, tracks: [...pl.tracks, ...newTracks]} : pl));
             showToast(`Added ${newTracks.length} tracks`, "success");
         }
      }
  };

  // --- TOOL HANDLER ---
  const handleToolCall = async (name: string, args: any) => {
    if (name === 'change_mode') { setMode(args.mode); showToast(`Mode: ${args.mode}`, "voice"); return `Mode changed`; }
    if (name === 'control_playback') {
       if(args.action === 'play') { if(audioService.isPaused && currentTrack) audioService.play(currentTrack.url); showToast("Playing", "voice"); }
       if(args.action === 'pause') { audioService.togglePlay(); showToast("Paused", "voice"); }
       if(args.action === 'next') handleNextBtn();
       if(args.action === 'previous') handlePrevBtn();
       return "Done";
    }
    if (name === 'seek_audio') { skip(args.seconds); return `Seeked ${args.seconds}s`; }
    if (name === 'set_volume') { 
        const v = args.level / 100; 
        audioService.setVolume(v); 
        setVolume(v); 
        showToast(`Volume ${args.level}%`, "voice");
        return `Vol ${args.level}%`; 
    }
    if (name === 'manage_playlist') {
        if (args.action === 'shuffle') { shufflePlaylist(); return "Shuffled"; }
        if (args.action === 'create_mood_mix') { generateMoodPlaylist(); return "Mix Created"; }
    }
    return "OK";
  };

  return (
    <div 
        className={`relative w-full h-[100dvh] ${theme.bg} ${theme.text} font-sans overflow-hidden transition-colors duration-1000 select-none flex flex-col`}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
    >
      <Visualizer isListening={isVoiceActive} mode={mode} />

      {/* --- NOTIFICATION POPUP --- */}
      {notification && (
          <div key={notification.id} className="absolute top-28 inset-x-0 flex justify-center z-50 animate-in fade-in slide-in-from-top-4 duration-300 pointer-events-none">
              <div className={`
                  px-6 py-3 rounded-2xl shadow-2xl backdrop-blur-xl border border-white/10
                  flex items-center gap-3 text-sm font-bold tracking-wide uppercase
                  ${notification.type === 'voice' ? 'bg-indigo-900/80 text-indigo-100 shadow-indigo-500/20' : 
                    notification.type === 'gesture' ? 'bg-emerald-900/80 text-emerald-100 shadow-emerald-500/20' :
                    notification.type === 'error' ? 'bg-rose-900/80 text-rose-100 shadow-rose-500/20' :
                    notification.type === 'success' ? 'bg-cyan-900/80 text-cyan-100 shadow-cyan-500/20' :
                    'bg-zinc-800/80 text-zinc-200'}
              `}>
                  {notification.type === 'voice' && <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse"/>}
                  {notification.type === 'gesture' && <span className="w-2 h-2 rounded-full bg-emerald-400"/>}
                  {notification.type === 'error' && <span className="w-2 h-2 rounded-full bg-rose-400"/>}
                  {notification.text}
              </div>
          </div>
      )}

      {/* Delete Confirmation */}
      <ConfirmationModal 
        isOpen={!!pendingAction}
        title="CONFIRM"
        description={pendingAction?.description || ""}
        mode={mode}
        onCancel={() => setPendingAction(null)}
        onConfirm={() => {
           if (pendingAction?.type === 'DELETE_TRACK') {
              setPlaylists(prev => prev.map(p => p.id === currentPlaylistId ? {
                 ...p, tracks: p.tracks.filter(t => t.id !== pendingAction.data.id)
              } : p));
              showToast("Track Deleted", "success");
           }
           if (pendingAction?.type === 'DELETE_PLAYLIST') {
              setPlaylists(prev => prev.filter(p => p.id !== pendingAction.data));
              setCurrentPlaylistId(playlists[0]?.id || null);
           }
           setPendingAction(null);
        }}
      />

      <LiveVoiceAgent 
        isActive={isVoiceActive}
        mode={mode}
        onDeactivate={() => setIsVoiceActive(false)}
        onAIResponse={(msg) => showToast(msg, "voice")}
        onUserTranscript={() => {}}
        onToolCall={handleToolCall}
      />
      
      {/* Link Import Modal */}
      {showLinkModal && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-6 animate-in fade-in duration-200">
           <div className={`w-full max-w-sm rounded-3xl p-6 shadow-2xl border ${theme.panel}`}>
              <h3 className={`text-lg font-bold mb-4 ${theme.text}`}>ADD RADIO STREAM / URL</h3>
              <input 
                 type="url" 
                 placeholder="Paste stream URL..."
                 value={linkInput}
                 onChange={e => setLinkInput(e.target.value)}
                 className={`w-full p-3 rounded-xl bg-black/10 border ${isDay?'border-slate-300':'border-zinc-700'} mb-4 outline-none ${theme.text}`}
                 autoFocus
              />
              <div className="flex gap-3">
                 <button onClick={() => setShowLinkModal(false)} className={`flex-1 py-3 rounded-xl font-bold uppercase border ${theme.buttonBase}`}>Cancel</button>
                 <button onClick={processLinkImport} className={`flex-1 py-3 rounded-xl font-bold uppercase ${isDay?'bg-blue-500 text-white':'bg-cyan-600 text-white'}`}>Add Station</button>
              </div>
           </div>
        </div>
      )}

      {/* --- HEADER --- */}
      <div className="shrink-0 h-24 pt-safe px-6 z-30 flex flex-col pointer-events-none justify-center">
         <div className="flex justify-between items-center w-full">
             <h1 className={`text-xs font-bold tracking-[0.4em] uppercase opacity-60 ${theme.text}`}>VS FM</h1>
             <button 
               onClick={() => { setMode(isDay ? ListeningMode.NIGHT_BRAIN : ListeningMode.SUN_DAY); vibrate(10); }} 
               className={`pointer-events-auto p-2 rounded-full transition-all ${theme.buttonBase} bg-opacity-20 active:scale-90`}
             >
                {isDay ? <MoonIcon className="w-4 h-4" /> : <SunIcon className="w-4 h-4" />}
             </button>
         </div>
      </div>

      {/* --- CENTER STAGE --- */}
      <div className="flex-1 flex flex-col items-center justify-center z-10 pointer-events-none w-full min-h-0 overflow-y-auto">
         {/* Play Button */}
         <button
            ref={playButtonRef}
            onClick={() => {
               if(!currentTrack) { showToast("Load Music First", "info"); return; }
               audioService.togglePlay();
               setIsPlaying(!audioService.isPaused);
               vibrate(20);
            }}
            className={`pointer-events-auto w-32 h-32 md:w-56 md:h-56 rounded-full backdrop-blur-md flex items-center justify-center border-2 transition-all duration-75 will-change-transform ${isDay ? 'bg-white/10' : 'bg-black/40'} shrink-0 mb-4 md:mb-8`}
         >
            {isPlaying ? (
               <PauseIcon className={`w-10 h-10 md:w-16 md:h-16 ${isDay ? 'text-blue-600' : 'text-white'}`} fill />
            ) : (
               <PlayIcon className={`w-10 h-10 md:w-16 md:h-16 ml-1 ${isDay ? 'text-blue-600' : 'text-white'}`} fill />
            )}
         </button>

         {/* --- CONTROLS --- */}
         <div className="pointer-events-auto w-full max-w-md px-6 flex flex-col gap-3 md:gap-5 pb-4">
             {/* Progress */}
             <div className="w-full flex items-center gap-3">
                 <span className={`text-[10px] font-mono opacity-60 w-8 ${theme.text}`}>{formatTime(progress)}</span>
                 <input 
                    type="range" 
                    min="0" 
                    max={duration || 100} 
                    value={progress} 
                    onChange={handleSeek}
                    className="flex-1 h-3 rounded-full appearance-none cursor-pointer"
                    style={{ background: `linear-gradient(to right, ${isDay?'#3b82f6':'#dc2626'} ${(progress/(duration||1))*100}%, ${isDay?'#e2e8f0':'#3f3f46'} ${(progress/(duration||1))*100}%)` }}
                 />
                 <span className={`text-[10px] font-mono opacity-60 w-8 text-right ${theme.text}`}>{formatTime(duration)}</span>
             </div>

             {/* Buttons */}
             <div className="flex justify-between items-center px-1">
                 <button onClick={() => skip(-5)} className={`p-3 rounded-full ${theme.buttonBase} active:scale-90 transition-transform`} title="-5s"><SkipBack5Icon className="w-5 h-5" /></button>
                 <button onClick={handlePrevBtn} className={`p-3 rounded-full ${theme.buttonBase} active:scale-90 transition-transform`} title="Prev"><PrevIcon className="w-6 h-6" /></button>
                 <button onClick={() => { setShowSearch(!showSearch); vibrate(20); }} className={`p-3 rounded-full ${theme.buttonBase} active:scale-90 transition-transform`} title="Search"><SearchIcon className="w-5 h-5" /></button>
                 <button onClick={shufflePlaylist} className={`p-3 rounded-full ${theme.buttonBase} active:scale-90 transition-transform`} title="Shuffle"><ShuffleIcon className="w-5 h-5" /></button>
                 <button onClick={handleNextBtn} className={`p-3 rounded-full ${theme.buttonBase} active:scale-90 transition-transform`} title="Next"><NextIcon className="w-6 h-6" /></button>
                 <button onClick={() => skip(5)} className={`p-3 rounded-full ${theme.buttonBase} active:scale-90 transition-transform`} title="+5s"><SkipForward5Icon className="w-5 h-5" /></button>
             </div>
             
             {/* Search */}
             <div className={`overflow-hidden transition-all duration-300 ${showSearch ? 'h-10 opacity-100' : 'h-0 opacity-0'}`}>
                <input 
                   type="text" 
                   placeholder="Search playlist..." 
                   value={searchQuery}
                   onChange={(e) => setSearchQuery(e.target.value)}
                   className={`w-full bg-transparent border-b ${theme.text} ${isDay?'border-blue-400':'border-red-500'} text-center outline-none py-1 text-sm`}
                />
             </div>

             {/* Volume */}
             <div className="flex items-center gap-3 px-2">
                 <span className={`text-[9px] uppercase font-bold opacity-50 ${theme.text}`}>Vol</span>
                 <input 
                    type="range" 
                    min="0" 
                    max="1" 
                    step="0.01" 
                    value={volume} 
                    onChange={handleVolume}
                    className="flex-1 h-2 rounded-full appearance-none cursor-pointer"
                    style={{ background: `linear-gradient(to right, ${isDay?'#3b82f6':'#dc2626'} ${volume*100}%, ${isDay?'#e2e8f0':'#3f3f46'} ${volume*100}%)` }}
                 />
             </div>
         </div>
      </div>

      {/* --- FOOTER --- */}
      <div className="shrink-0 pb-safe pt-2 px-6 flex flex-col gap-3 z-20 pointer-events-auto bg-gradient-to-t from-black/80 to-transparent">
         <div className="text-center flex flex-col justify-center h-12">
             {renamingTrackId === currentTrack?.id ? (
               <input 
                 ref={renameInputRef}
                 autoFocus
                 defaultValue={currentTrack?.title}
                 className={`bg-transparent text-xl font-bold text-center outline-none border-b w-full pb-1 ${theme.text} ${isDay ? 'border-blue-500' : 'border-red-500'}`}
                 onBlur={(e) => handleRename(currentTrack.id, e.target.value)}
                 onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
               />
             ) : (
               <h2 
                 className={`text-lg md:text-xl font-bold truncate cursor-pointer active:scale-95 transition-transform ${theme.text}`}
                 onTouchStart={() => {
                    longPressRef.current = setTimeout(() => {
                        if (currentTrack) { setRenamingTrackId(currentTrack.id); vibrate(50); }
                    }, 600);
                 }}
                 onTouchEnd={() => { if(longPressRef.current) clearTimeout(longPressRef.current); }}
                 onContextMenu={(e) => { e.preventDefault(); if(currentTrack) setRenamingTrackId(currentTrack.id); }}
               >
                  {currentTrack?.title || "No Track Loaded"}
               </h2>
             )}
             <p className={`text-[10px] uppercase tracking-widest opacity-60 ${theme.sub}`}>
               {currentPlaylist?.name || "Library Empty"}
             </p>
         </div>

         <div className={`glass-panel p-3 md:p-4 rounded-3xl border flex justify-around items-center ${theme.panel}`}>
            <button onClick={() => { setIsVoiceActive(!isVoiceActive); vibrate(10); }} className="flex flex-col items-center gap-1 group w-12 md:w-14 active:scale-95 transition-transform">
               <div className={`w-9 h-9 md:w-10 md:h-10 rounded-full flex items-center justify-center transition-all ${isVoiceActive ? (isDay?'bg-blue-500 text-white animate-pulse':'bg-red-600 text-white animate-pulse') : theme.buttonBase}`}>
                  <MicIcon className="w-5 h-5" fill={isVoiceActive} />
               </div>
               <span className="text-[9px] font-bold uppercase tracking-wider opacity-60">AI</span>
            </button>
            <button onClick={() => { fileInputRef.current?.click(); vibrate(10); }} className="flex flex-col items-center gap-1 w-12 md:w-14 active:scale-95 transition-transform">
               <div className={`w-9 h-9 md:w-10 md:h-10 rounded-full flex items-center justify-center ${theme.buttonBase}`}>
                  <FileIcon className="w-5 h-5" />
               </div>
               <span className="text-[9px] font-bold uppercase tracking-wider opacity-60">File</span>
            </button>
            <button onClick={() => { setShowLinkModal(true); vibrate(10); }} className="flex flex-col items-center gap-1 w-12 md:w-14 active:scale-95 transition-transform">
               <div className={`w-9 h-9 md:w-10 md:h-10 rounded-full flex items-center justify-center ${theme.buttonBase}`}>
                  <LinkIcon className="w-5 h-5" />
               </div>
               <span className="text-[9px] font-bold uppercase tracking-wider opacity-60">Link</span>
            </button>
            <button onClick={() => { folderInputRef.current?.click(); vibrate(10); }} className="flex flex-col items-center gap-1 w-12 md:w-14 active:scale-95 transition-transform">
               <div className={`w-9 h-9 md:w-10 md:h-10 rounded-full flex items-center justify-center ${theme.buttonBase}`}>
                   <FolderIcon className="w-5 h-5" />
               </div>
               <span className="text-[9px] font-bold uppercase tracking-wider opacity-60">Dir</span>
            </button>
            <button onClick={() => { setShowPlaylist(true); vibrate(10); }} className="flex flex-col items-center gap-1 w-12 md:w-14 active:scale-95 transition-transform">
               <div className={`w-9 h-9 md:w-10 md:h-10 rounded-full flex items-center justify-center ${theme.buttonBase}`}>
                  <ListIcon className="w-5 h-5" />
               </div>
               <span className="text-[9px] font-bold uppercase tracking-wider opacity-60">List</span>
            </button>
         </div>
      </div>

      {/* --- PLAYLIST --- */}
      <div className={`absolute inset-0 z-40 backdrop-blur-3xl transition-transform duration-500 pt-safe px-6 pb-6 overflow-hidden flex flex-col ${showPlaylist ? 'translate-y-0' : 'translate-y-full'} ${isDay ? 'bg-white/95' : 'bg-black/95'}`}>
         <div className="flex justify-between items-center mb-6 shrink-0 pt-4">
             <h2 className={`text-xl tracking-widest font-bold ${theme.text}`}>LIBRARY</h2>
             <button onClick={() => setShowPlaylist(false)} className={`p-2 rounded-full border ${theme.panel} active:scale-90`}>
                <CloseIcon className="w-5 h-5" />
             </button>
         </div>
         <div className="flex overflow-x-auto gap-3 mb-6 pb-2 shrink-0 scrollbar-hide">
            {playlists.map(p => (
               <button 
                  key={p.id}
                  onClick={() => { setCurrentPlaylistId(p.id); setCurrentTrackIndex(0); vibrate(5); }}
                  className={`px-5 py-2.5 rounded-full text-[10px] font-bold uppercase whitespace-nowrap border transition-all ${p.id === currentPlaylistId ? theme.activeItem + ' border-transparent shadow-lg' : 'border-zinc-700 opacity-40'}`}
               >
                  {p.name}
               </button>
            ))}
         </div>
         <div className="flex-1 overflow-y-auto space-y-2 pb-10">
            {displayTracks.map((t, i) => (
                <div key={t.id} onClick={() => { setCurrentTrackIndex(currentPlaylist!.tracks.indexOf(t)); playTrack(t); vibrate(5); }} className={`p-4 rounded-2xl flex justify-between items-center transition-all cursor-pointer ${currentTrack?.id === t.id ? theme.activeItem : 'hover:bg-gray-800/10'}`}>
                   <div className="flex items-center gap-4 overflow-hidden">
                      <span className="text-[10px] font-mono opacity-40 w-4">{i+1}</span>
                      <span className={`truncate text-sm font-medium ${theme.text}`}>{t.title}</span>
                   </div>
                   {currentTrack?.id === t.id && <div className="w-2 h-2 rounded-full bg-current animate-pulse" />}
                </div>
            ))}
         </div>
      </div>

      <input type="file" ref={fileInputRef} multiple accept="audio/*,video/mp4" className="hidden" onChange={e => handleFiles(e.target.files)} />
      <input type="file" ref={folderInputRef} multiple {...({ webkitdirectory: "", directory: "" } as any)} className="hidden" onChange={e => handleFiles(e.target.files, true)} />
    </div>
  );
}