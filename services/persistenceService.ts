import { Playlist, Track } from '../types';

const DB_NAME = 'VS_FM_DB';
const DB_VERSION = 1;
const STORE_PLAYLISTS = 'playlists';
const STORE_STATE = 'app_state';

export class PersistenceService {
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = (event) => {
        console.error("IDB error", event);
        reject("Database error");
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_PLAYLISTS)) {
          db.createObjectStore(STORE_PLAYLISTS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_STATE)) {
          db.createObjectStore(STORE_STATE, { keyPath: 'key' });
        }
      };

      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        resolve();
      };
    });
  }

  async savePlaylists(playlists: Playlist[]): Promise<void> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_PLAYLISTS], 'readwrite');
      const store = transaction.objectStore(STORE_PLAYLISTS);
      
      // Clear old
      store.clear();

      playlists.forEach(p => {
        // We must store the File/Blob objects in the DB
        store.put(p);
      });

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  async loadPlaylists(): Promise<Playlist[]> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_PLAYLISTS], 'readonly');
      const store = transaction.objectStore(STORE_PLAYLISTS);
      const request = store.getAll();

      request.onsuccess = () => {
        const playlists = request.result as Playlist[];
        // Re-create URLs for blobs
        playlists.forEach(p => {
          p.tracks.forEach(t => {
            if (t.file) {
              t.url = URL.createObjectURL(t.file);
            }
          });
        });
        resolve(playlists);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async saveState(key: string, value: any): Promise<void> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_STATE], 'readwrite');
      const store = transaction.objectStore(STORE_STATE);
      store.put({ key, value });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  async loadState(key: string): Promise<any> {
    if (!this.db) await this.init();
    return new Promise((resolve) => {
      const transaction = this.db!.transaction([STORE_STATE], 'readonly');
      const store = transaction.objectStore(STORE_STATE);
      const request = store.get(key);
      request.onsuccess = () => {
        resolve(request.result?.value || null);
      };
      request.onerror = () => resolve(null);
    });
  }
}

export const persistenceService = new PersistenceService();