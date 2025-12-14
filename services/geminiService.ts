import { GoogleGenAI, Type } from "@google/genai";
import { Playlist, ListeningMode } from "../types";

// Helper to get AI instance safely
const getAI = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    console.error("API Key missing");
    return null;
  }
  return new GoogleGenAI({ apiKey });
};

export const analyzeUserIntent = async (
  transcript: string, 
  currentContext: { mode: ListeningMode; playlistName?: string }
) => {
  const ai = getAI();
  if (!ai) return null;

  const prompt = `
    You are VS FM Radio, an AI audio companion. 
    Analyze the user's voice command: "${transcript}".
    Current Context: Mode=${currentContext.mode}, Playlist=${currentContext.playlistName || 'None'}.
    
    Determine if the user wants to:
    1. Manage a playlist (create, rename, delete)
    2. Change listening mode
    3. Control playback (play, pause, skip)
    4. Ask a question (chat)

    Return JSON.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            actionType: { type: Type.STRING, enum: ["PLAYLIST", "MODE", "PLAYBACK", "CHAT", "UNKNOWN"] },
            playlistAction: { type: Type.STRING, enum: ["CREATE", "RENAME", "DELETE", "MERGE", "NONE"] },
            targetName: { type: Type.STRING },
            mode: { type: Type.STRING },
            replyToUser: { type: Type.STRING },
          }
        }
      }
    });

    return JSON.parse(response.text || "{}");
  } catch (e) {
    console.error("AI Analysis failed", e);
    return { actionType: "UNKNOWN", replyToUser: "I couldn't quite catch that." };
  }
};

export const suggestNextTrack = async (history: string[], mood: string) => {
    // Placeholder for smarter sequencing logic using Flash Lite for speed
    // Ideally this would take the list of available local tracks and pick one.
    return true;
}