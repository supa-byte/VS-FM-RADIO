import React, { useEffect, useRef, useState } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { ListeningMode } from '../types';

interface LiveVoiceAgentProps {
  isActive: boolean;
  mode: ListeningMode;
  onDeactivate: () => void;
  onAIResponse: (text: string) => void;
  onUserTranscript: (text: string) => void;
  onToolCall: (name: string, args: any) => Promise<any>;
}

// Config for Personalities
const HOST_CONFIG: Record<ListeningMode, { voice: string, instruction: string }> = {
  [ListeningMode.NIGHT_BRAIN]: { 
      voice: 'Kore', 
      instruction: 'You are a late-night radio host. Your voice is deep, calm, and soothing. Keep responses brief and introspective.' 
  },
  [ListeningMode.SUN_DAY]: { 
      voice: 'Fenrir', 
      instruction: 'You are a high-energy morning DJ. Speak fast, be punchy, enthusiastic, and keep the vibe moving.' 
  },
  [ListeningMode.SILENT_COMPANION]: { 
      voice: 'Zephyr', 
      instruction: 'You are a whisper-quiet companion. Speak only when necessary, very briefly and softly.' 
  },
  [ListeningMode.CONTROL_FREE]: { 
      voice: 'Puck', 
      instruction: 'You are a helpful, neutral assistant. Execute commands efficiently with minimal chatter.' 
  },
  [ListeningMode.FOCUS_DRIFT]: { 
      voice: 'Charon', 
      instruction: 'You are a guide for deep focus. Calm, steady, and monotone.' 
  },
  [ListeningMode.MEMORY_RECALL]: { 
      voice: 'Kore', 
      instruction: 'You are a nostalgic host. Gentle, reminiscent, and warm.' 
  },
  [ListeningMode.BACKGROUND_LIFE]: { 
      voice: 'Aoede', 
      instruction: 'You are a casual background presence. Friendly but unobtrusive.' 
  },
};

// Utils (Audio Encoding/Decoding)
function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) { binary += String.fromCharCode(bytes[i]); }
  return btoa(binary);
}

function createBlob(data: Float32Array) {
    const l = data.length;
    const int16 = new Int16Array(l);
    for (let i = 0; i < l; i++) { int16[i] = data[i] * 32768; }
    return { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' };
}

function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) { bytes[i] = binaryString.charCodeAt(i); }
  return bytes;
}

async function decodeAudioData(data: Uint8Array, ctx: AudioContext, sampleRate: number, numChannels: number): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

// Tool Definitions
const tools = [{ functionDeclarations: [
  {
    name: 'control_playback',
    description: 'Control audio playback (play, pause, next, prev).',
    parameters: {
      type: 'OBJECT',
      properties: { action: { type: 'STRING', enum: ['play', 'pause', 'next', 'previous'] } },
      required: ['action']
    }
  },
  {
    name: 'seek_audio',
    description: 'Seek forward/backward by seconds.',
    parameters: {
      type: 'OBJECT',
      properties: { seconds: { type: 'NUMBER' } },
      required: ['seconds']
    }
  },
  {
    name: 'set_volume',
    description: 'Set volume (0-100).',
    parameters: {
      type: 'OBJECT',
      properties: { level: { type: 'NUMBER' } },
      required: ['level']
    }
  },
  {
    name: 'manage_playlist',
    description: 'Manage playlists (shuffle, create_mood_mix).',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: { type: 'STRING', enum: ['shuffle', 'create_mood_mix'] },
      },
      required: ['action']
    }
  },
  {
    name: 'change_mode',
    description: 'Change the app listening mode/theme.',
    parameters: {
      type: 'OBJECT',
      properties: { mode: { type: 'STRING', enum: ['NIGHT_BRAIN', 'SUN_DAY', 'SILENT_COMPANION', 'CONTROL_FREE', 'FOCUS_DRIFT', 'MEMORY_RECALL', 'BACKGROUND_LIFE'] } },
      required: ['mode']
    }
  }
] }];

export const LiveVoiceAgent: React.FC<LiveVoiceAgentProps> = ({ isActive, mode, onDeactivate, onAIResponse, onUserTranscript, onToolCall }) => {
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const sessionRef = useRef<Promise<any> | null>(null);
  const isConnectingRef = useRef(false);
  const currentModeRef = useRef(mode);

  // Audio Refs
  const inputContextRef = useRef<AudioContext | null>(null);
  const outputContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  
  // Audio Queue
  const nextStartTimeRef = useRef<number>(0);
  const audioQueueRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  // Detect mode change to restart session if needed
  useEffect(() => {
    if (isActive && mode !== currentModeRef.current) {
        currentModeRef.current = mode;
        // Ideally we would update the session config dynamically, but for personality changes (voice/system instruction), 
        // we often need a reconnect or sending a new config. 
        // For simplicity and robustness, we can just let the current session run or user can toggle to reset.
        // However, we can send a system instruction update if the API supports it via text. 
        // For now, we'll keep the session active but note that the persona might not update until reconnect.
    }
  }, [mode, isActive]);

  useEffect(() => {
    let mounted = true;

    const cleanup = () => {
      mounted = false;
      isConnectingRef.current = false;
      if (sessionRef.current) {
        sessionRef.current.then(s => s.close()).catch(() => {});
        sessionRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
      if (processorRef.current) {
        processorRef.current.disconnect();
        processorRef.current = null;
      }
      if (inputContextRef.current) {
        inputContextRef.current.close();
        inputContextRef.current = null;
      }
      if (outputContextRef.current) {
        outputContextRef.current.close();
        outputContextRef.current = null;
      }
      audioQueueRef.current.forEach(source => source.stop());
      audioQueueRef.current.clear();
      setStatus('idle');
    };

    const startSession = async () => {
      if (!process.env.API_KEY) {
        onAIResponse("Error: No API Key");
        onDeactivate();
        return;
      }

      if (isConnectingRef.current) return;
      isConnectingRef.current = true;
      setStatus('connecting');
      onAIResponse(`Connecting (${mode})...`);

      try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const persona = HOST_CONFIG[mode] || HOST_CONFIG[ListeningMode.CONTROL_FREE];
        
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;
        
        const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
        inputContextRef.current = inputCtx;
        
        const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        outputContextRef.current = outputCtx;
        
        if (inputCtx.state === 'suspended') await inputCtx.resume();
        if (outputCtx.state === 'suspended') await outputCtx.resume();

        const sessionPromise = ai.live.connect({
          model: 'gemini-2.5-flash-native-audio-preview-09-2025',
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: persona.voice || 'Puck' } }
            },
            systemInstruction: persona.instruction,
            tools: tools,
            inputAudioTranscription: {},
          },
          callbacks: {
            onopen: () => {
              if (!mounted) return;
              setStatus('connected');
              onAIResponse("VS FM Live");
              
              const source = inputCtx.createMediaStreamSource(stream);
              const processor = inputCtx.createScriptProcessor(4096, 1, 1);
              processorRef.current = processor;
              
              processor.onaudioprocess = (e) => {
                if (!mounted) return;
                const inputData = e.inputBuffer.getChannelData(0);
                sessionPromise.then(session => {
                    session.sendRealtimeInput({ media: createBlob(inputData) });
                }).catch(e => console.error("Send Error", e));
              };
              
              source.connect(processor);
              processor.connect(inputCtx.destination);
            },
            onmessage: async (msg: LiveServerMessage) => {
              if (!mounted) return;
              
              if (msg.serverContent?.inputTranscription) {
                onUserTranscript(msg.serverContent.inputTranscription.text);
              }
              
              const audioData = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
              if (audioData && outputContextRef.current) {
                 const ctx = outputContextRef.current;
                 const rawBytes = decode(audioData);
                 const buffer = await decodeAudioData(rawBytes, ctx, 24000, 1);
                 
                 nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
                 const source = ctx.createBufferSource();
                 source.buffer = buffer;
                 source.connect(ctx.destination);
                 source.onended = () => audioQueueRef.current.delete(source);
                 source.start(nextStartTimeRef.current);
                 nextStartTimeRef.current += buffer.duration;
                 audioQueueRef.current.add(source);
                 
                 onAIResponse("Speaking...");
              }
              
              if (msg.serverContent?.interrupted) {
                  audioQueueRef.current.forEach(s => s.stop());
                  audioQueueRef.current.clear();
                  nextStartTimeRef.current = 0;
                  onAIResponse("Listening...");
              }

              if (msg.toolCall) {
                for (const fc of msg.toolCall.functionCalls) {
                   onAIResponse(`Running: ${fc.name}`);
                   try {
                     const result = await onToolCall(fc.name, fc.args);
                     sessionPromise.then(s => s.sendToolResponse({
                         functionResponses: { id: fc.id, name: fc.name, response: { result: result || "done" } }
                     }));
                   } catch (e) {
                     console.error("Tool Error", e);
                   }
                }
              }
            },
            onclose: (e) => { 
                if (mounted) { setStatus('idle'); onDeactivate(); }
            },
            onerror: (e) => { 
                if (mounted) { 
                    setStatus('error'); 
                    onAIResponse("Connection Error"); 
                    setTimeout(onDeactivate, 3000); 
                }
            }
          }
        });

        sessionRef.current = sessionPromise;

      } catch (err) {
        console.error("Setup Error:", err);
        if (mounted) {
            setStatus('error');
            onAIResponse("Network Error");
            setTimeout(onDeactivate, 3000);
        }
      } finally {
         isConnectingRef.current = false;
      }
    };

    if (isActive) {
      startSession();
    } else {
      cleanup();
    }

    return cleanup;
  }, [isActive, mode]);

  if (!isActive) return null;

  return (
    <div className="absolute top-24 inset-x-0 flex justify-center pointer-events-none z-50">
       <div className={`px-4 py-1 rounded-full backdrop-blur-md text-[10px] font-bold tracking-widest uppercase shadow-lg transition-colors duration-300
         ${status === 'connected' ? 'bg-red-500/20 text-red-500 border border-red-500/50 animate-pulse' : 'bg-gray-800/80 text-gray-400'}
       `}>
          {status === 'connecting' ? 'CONNECTING...' : status === 'connected' ? `● LIVE (${mode.replace('_',' ')})` : 'OFFLINE'}
       </div>
    </div>
  );
};
