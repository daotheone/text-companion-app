import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppData } from '../types/index.ts';
import { parseAppData } from './storage.ts';

export async function loadCloud(client: SupabaseClient, userId: string, today: string) {
  const { data, error } = await client.from('companion_data').select('data, version').eq('user_id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  if (data === null) return { data: { dailyTasks: [], todos: [], notes: {} } satisfies AppData, version: 0 };
  if (!Number.isSafeInteger(data.version) || data.version < 1) throw new Error('Invalid cloud version');
  return { data: parseAppData(data.data, today), version: data.version as number };
}

export async function saveCloud(client: SupabaseClient, userId: string, data: AppData, version: number, writeId: string) {
  parseAppData(data, '0001-01-01');
  const { data: savedVersion, error } = await client.rpc('save_companion_data', {
    expected_user: userId, payload: data, expected_version: version, request_id: writeId,
  });
  if (error) throw new Error(error.message);
  if (!Number.isSafeInteger(savedVersion) || savedVersion !== version + 1) throw new Error('Invalid save acknowledgement');
  return savedVersion as number;
}

type Write = { data: AppData; id: string };

// ponytail: one versioned snapshot per user; normalize tables when partial sync or larger datasets are needed.
// Retry remembers only the latest server write; intervening writes stop with a conflict, never overwrite.
export class CloudWriter {
  version: number;
  pending: AppData | null = null;
  active: Write | null = null;
  running = false;
  error = '';
  disposed = false;
  private save: (data: AppData, version: number, id: string) => Promise<number>;
  private changed: () => void;
  constructor(version: number, save: (data: AppData, version: number, id: string) => Promise<number>, changed: () => void) {
    this.version = version;
    this.save = save;
    this.changed = changed;
  }
  get dirty() { return this.pending !== null || this.active !== null; }
  queue(data: AppData) {
    this.pending = data;
    this.changed();
    void this.drain();
  }
  retry() { this.error = ''; void this.drain(); }
  async drain() {
    if (this.running || this.error || this.disposed) return;
    this.running = true;
    try {
      while ((this.active || this.pending) && !this.disposed) {
        if (!this.active) {
          this.active = { data: this.pending!, id: crypto.randomUUID() };
          this.pending = null;
        }
        this.changed();
        this.version = await this.save(this.active.data, this.version, this.active.id);
        this.active = null;
      }
    } catch (cause) {
      this.error = cause instanceof Error ? cause.message : 'Cloud unavailable';
    } finally {
      this.running = false;
      if (!this.disposed) this.changed();
    }
  }
}
