import type { AppData, DailyTask, TodoItem } from '../types/index.ts';
import { formatDate, parseDate } from '../utils/calendar.ts';
import { STORAGE_KEYS } from './storageKeys.ts';

type LocalStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid stored data');
  return value as Record<string, unknown>;
}

function items(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error('Invalid stored items');
  const seen = new Set<string>();
  return value.map(item => {
    const entry = record(item);
    if (typeof entry.id !== 'string' || !entry.id.trim() || seen.has(entry.id) || typeof entry.title !== 'string' || !entry.title.trim() || typeof entry.isCompleted !== 'boolean') {
      throw new Error('Invalid stored item');
    }
    seen.add(entry.id);
    return entry;
  });
}

function dailyTasksFrom(value: unknown, today: string): DailyTask[] {
  return items(value).map(task => {
    if (task.lastCompletedDate !== null && task.lastCompletedDate !== '') {
      if (typeof task.lastCompletedDate !== 'string') throw new Error('Invalid habit date');
      parseDate(task.lastCompletedDate);
    }
    const history = task.completionHistory === undefined ? (task.lastCompletedDate ? [task.lastCompletedDate] : []) : task.completionHistory;
    if (!Array.isArray(history)) throw new Error('Invalid completion history');
    for (const date of history) {
      if (typeof date !== 'string') throw new Error('Invalid history date');
      parseDate(date);
    }
    const completionHistory = [...new Set<string>(history)].sort();
    return { id: task.id as string, title: task.title as string, completionHistory, isCompleted: completionHistory.includes(today), lastCompletedDate: completionHistory[completionHistory.length - 1] ?? null };
  });
}

function todosFrom(value: unknown): TodoItem[] {
  return items(value).map(todo => {
    if (typeof todo.createdAt !== 'number' || !Number.isFinite(todo.createdAt)) throw new Error('Invalid todo date');
    formatDate(new Date(todo.createdAt));
    return { id: todo.id as string, title: todo.title as string, isCompleted: todo.isCompleted as boolean, createdAt: todo.createdAt };
  });
}

function notesFrom(value: unknown): Record<string, string> {
  return Object.fromEntries(Object.entries(record(value)).map(([date, content]) => {
    parseDate(date);
    if (typeof content !== 'string') throw new Error('Invalid note content');
    return [date, content];
  }));
}

export function loadData(storage: LocalStorage, today: string): AppData {
  parseDate(today);
  const read = (key: string, fallback: unknown): unknown => {
    const raw = storage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  };
  const dailyTasks = dailyTasksFrom(read(STORAGE_KEYS.DAILY_TASKS, []), today);
  const todos = todosFrom(read(STORAGE_KEYS.TODO_ITEMS, []));
  const notes = notesFrom(read(STORAGE_KEYS.DAILY_NOTES, {}));
  const legacy = storage.getItem(STORAGE_KEYS.NOTE);
  const rawMigration = storage.getItem(STORAGE_KEYS.NOTE_MIGRATION);
  const existing = notes[today];
  const content = !existing ? (legacy ?? '') : !legacy || existing === legacy ? existing : `${existing}\n\n${legacy}`;
  const migration = rawMigration === null ? { date: today, source: legacy, content } : record(JSON.parse(rawMigration));
  if (typeof migration.date !== 'string' || (migration.source !== null && typeof migration.source !== 'string') || typeof migration.content !== 'string') throw new Error('Invalid note migration');
  parseDate(migration.date);
  if (legacy !== null) {
    if (migration.source !== legacy) throw new Error('Legacy note changed during migration');
    if (rawMigration === null) storage.setItem(STORAGE_KEYS.NOTE_MIGRATION, JSON.stringify(migration));
    notes[migration.date] = migration.content;
    saveData(storage, { dailyTasks, todos, notes });
    storage.removeItem(STORAGE_KEYS.NOTE);
    storage.removeItem(STORAGE_KEYS.NOTE_MIGRATION);
  } else {
    saveData(storage, { dailyTasks, todos, notes });
    if (rawMigration !== null) storage.removeItem(STORAGE_KEYS.NOTE_MIGRATION);
  }
  return { dailyTasks, todos, notes };
}

export function saveData(storage: LocalStorage, data: AppData): void {
  dailyTasksFrom(data.dailyTasks, '0001-01-01');
  if (data.dailyTasks.some(task => !Array.isArray(task.completionHistory))) throw new Error('Missing completion history');
  todosFrom(data.todos);
  notesFrom(data.notes);
  const updates = [
    [STORAGE_KEYS.DAILY_TASKS, JSON.stringify(data.dailyTasks)],
    [STORAGE_KEYS.TODO_ITEMS, JSON.stringify(data.todos)],
    [STORAGE_KEYS.DAILY_NOTES, JSON.stringify(data.notes)],
  ].map(([key, value]) => ({ key, value, previous: storage.getItem(key) })).filter(update => update.value !== update.previous);
  const written: typeof updates = [];
  try {
    for (const update of updates) {
      storage.setItem(update.key, update.value);
      written.push(update);
    }
  } catch (error) {
    // ponytail: localStorage rollback is best-effort; use IndexedDB when atomic multi-key writes are required.
    const rollbackErrors: unknown[] = [];
    for (const update of written.reverse()) {
      try {
        if (update.previous === null) storage.removeItem(update.key);
        else storage.setItem(update.key, update.previous);
      } catch (rollbackError) { rollbackErrors.push(rollbackError); }
    }
    if (rollbackErrors.length) throw new Error(`${String(error)}; rollback failed: ${rollbackErrors.map(String).join('; ')}`);
    throw error;
  }
}

export function resetDailyTasks(tasks: DailyTask[], today: string): DailyTask[] {
  parseDate(today);
  return tasks.map(task => ({ ...task, isCompleted: task.completionHistory.includes(today) }));
}

export function toggleHabit(task: DailyTask, today: string): DailyTask {
  parseDate(today);
  const completionHistory = task.completionHistory.includes(today)
    ? task.completionHistory.filter(date => date !== today)
    : [...task.completionHistory, today].sort();
  return { ...task, completionHistory, isCompleted: completionHistory.includes(today), lastCompletedDate: completionHistory[completionHistory.length - 1] ?? null };
}
