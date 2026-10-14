import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatDate, parseDate, getMonthGrid, getWeekGrid } from '../src/utils/calendar.ts';
import { loadData, saveData, toggleHabit, resetDailyTasks, readBrowserData, parseAppData } from '../src/data/storage.ts';
import { CloudWriter } from '../src/data/cloud.ts';
import { STORAGE_KEYS } from '../src/data/storageKeys.ts';
import type { AppData, DailyTask } from '../src/types/index.ts';

process.env.TZ = 'America/Los_Angeles';

class MemoryStorage {
  values: Map<string, string>;
  failSet: string | null = null;
  failRemove: string | null = null;
  constructor(entries: Record<string, string> = {}) { this.values = new Map(Object.entries(entries)); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) {
    if (key === this.failSet) throw new Error('Storage write failed');
    this.values.set(key, value);
  }
  removeItem(key: string) {
    if (key === this.failRemove) throw new Error('Storage removal failed');
    this.values.delete(key);
  }
}

const emptyData: AppData = { dailyTasks: [], todos: [], notes: {} };

test('calendar dates use local days and reject invalid date-only input', () => {
  assert.equal(formatDate(new Date('2024-03-01T01:00:00Z')), '2024-02-29');
  assert.equal(formatDate(parseDate('2024-02-29')), '2024-02-29');
  for (const invalid of ['2023-02-29', '2024-02-30', '2024-13-01', '2024-2-01', '2024-01-01T00:00:00Z', '']) {
    assert.throws(() => parseDate(invalid), /Invalid date/);
  }
  assert.throws(() => formatDate(new Date(NaN)), /Invalid date/);
});

test('month grid includes leap day and adjacent days in Monday-first weeks', () => {
  const grid = getMonthGrid(2024, 1);
  assert.equal(grid.length, 5);
  assert.ok(grid.every(week => week.length === 7));
  assert.deepEqual(grid[0].map(formatDate), ['2024-01-29', '2024-01-30', '2024-01-31', '2024-02-01', '2024-02-02', '2024-02-03', '2024-02-04']);
  assert.deepEqual(grid[4].map(formatDate), ['2024-02-26', '2024-02-27', '2024-02-28', '2024-02-29', '2024-03-01', '2024-03-02', '2024-03-03']);
  assert.equal(getMonthGrid(2024, 8).length, 6);
  for (const [year, month] of [[2024, -1], [2024, 12], [2024, 0.5], [NaN, 1], [0, 1]]) {
    assert.throws(() => getMonthGrid(year, month), /Invalid month/);
  }
});

test('week grid stays on local calendar days across DST', () => {
  const week = getWeekGrid(parseDate('2024-03-10'));
  assert.deepEqual(week.map(formatDate), ['2024-03-04', '2024-03-05', '2024-03-06', '2024-03-07', '2024-03-08', '2024-03-09', '2024-03-10']);
  const afterChange = getWeekGrid(parseDate('2024-03-11'));
  assert.deepEqual(afterChange.map(formatDate), ['2024-03-11', '2024-03-12', '2024-03-13', '2024-03-14', '2024-03-15', '2024-03-16', '2024-03-17']);
  assert.ok(week.concat(afterChange).every(date => date.getHours() === 0));
  assert.equal((afterChange[0].getTime() - week[6].getTime()) / 3600000, 23);
  assert.throws(() => getWeekGrid(new Date(NaN)), /Invalid date/);
});

test('habit completion undo and recheck preserve earlier history without duplicate dates', () => {
  const task: DailyTask = { id: 'water', title: 'Drink water', isCompleted: false, lastCompletedDate: '2024-02-28', completionHistory: ['2024-02-28'] };
  const completed = toggleHabit(task, '2024-02-29');
  assert.deepEqual(completed, { ...task, isCompleted: true, lastCompletedDate: '2024-02-29', completionHistory: ['2024-02-28', '2024-02-29'] });
  const undone = toggleHabit(completed, '2024-02-29');
  assert.deepEqual(undone, task);
  assert.deepEqual(toggleHabit(undone, '2024-02-29'), completed);
  assert.deepEqual(task.completionHistory, ['2024-02-28']);
  assert.throws(() => toggleHabit(task, '2024-02-30'), /Invalid date/);
});

test('daily reset derives today from history without deleting travel dates', () => {
  const tasks: DailyTask[] = [{ id: 'read', title: 'Read', isCompleted: true, lastCompletedDate: '2024-03-02', completionHistory: ['2024-02-29', '2024-03-02'] }];
  assert.equal(resetDailyTasks(tasks, '2024-03-01')[0].isCompleted, false);
  assert.deepEqual(resetDailyTasks(tasks, '2024-03-01')[0].completionHistory, ['2024-02-29', '2024-03-02']);
  assert.equal(resetDailyTasks(tasks, '2024-02-29')[0].isCompleted, true);
  assert.equal(toggleHabit(resetDailyTasks(tasks, '2024-02-29')[0], '2024-02-29').lastCompletedDate, '2024-03-02');
  assert.equal(tasks[0].isCompleted, true);
});

test('storage loads empty users and backfills legacy habit completion history', () => {
  assert.deepEqual(loadData(new MemoryStorage(), '2024-02-29'), emptyData);
  const storage = new MemoryStorage({
    [STORAGE_KEYS.DAILY_TASKS]: JSON.stringify([
      { id: 'old', title: 'Read', isCompleted: true, lastCompletedDate: '2024-02-28' },
      { id: 'new', title: 'Walk', isCompleted: false, lastCompletedDate: '', completionHistory: ['2024-02-29', '2024-02-29'] },
      { id: 'never', title: 'Write', isCompleted: false, lastCompletedDate: null },
    ]),
  });
  const data = loadData(storage, '2024-02-29');
  assert.deepEqual(data.dailyTasks, [
    { id: 'old', title: 'Read', isCompleted: false, lastCompletedDate: '2024-02-28', completionHistory: ['2024-02-28'] },
    { id: 'new', title: 'Walk', isCompleted: true, lastCompletedDate: '2024-02-29', completionHistory: ['2024-02-29'] },
    { id: 'never', title: 'Write', isCompleted: false, lastCompletedDate: null, completionHistory: [] },
  ]);
  assert.deepEqual(loadData(storage, '2024-02-29'), data);
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEYS.DAILY_TASKS)!), data.dailyTasks);
});

test('storage rejects malformed entities and dates without mutating persisted data', () => {
  const habit = { id: 'habit', title: 'Read', isCompleted: false, lastCompletedDate: null };
  const todo = { id: 'todo', title: 'Plan', isCompleted: false, createdAt: parseDate('2024-02-29').getTime() };
  const invalidEntries = [
    { [STORAGE_KEYS.DAILY_TASKS]: '{broken' },
    { [STORAGE_KEYS.DAILY_TASKS]: JSON.stringify({}) },
    { [STORAGE_KEYS.DAILY_TASKS]: JSON.stringify([{ ...habit, id: '' }]) },
    { [STORAGE_KEYS.DAILY_TASKS]: JSON.stringify([{ ...habit, title: ' ' }]) },
    { [STORAGE_KEYS.DAILY_TASKS]: JSON.stringify([{ ...habit, isCompleted: 'yes' }]) },
    { [STORAGE_KEYS.DAILY_TASKS]: JSON.stringify([{ ...habit, lastCompletedDate: '2024-02-30' }]) },
    { [STORAGE_KEYS.DAILY_TASKS]: JSON.stringify([{ ...habit, completionHistory: null }]) },
    { [STORAGE_KEYS.DAILY_TASKS]: JSON.stringify([{ ...habit, completionHistory: ['2024-02-30'] }]) },
    { [STORAGE_KEYS.DAILY_TASKS]: JSON.stringify([habit, habit]) },
    { [STORAGE_KEYS.TODO_ITEMS]: JSON.stringify([{ ...todo, createdAt: '2024-02-29' }]) },
    { [STORAGE_KEYS.TODO_ITEMS]: JSON.stringify([{ ...todo, createdAt: 1e20 }]) },
    { [STORAGE_KEYS.DAILY_NOTES]: JSON.stringify({ '2024-02-30': 'Bad date' }) },
    { [STORAGE_KEYS.DAILY_NOTES]: JSON.stringify({ '2024-02-29': 12 }) },
    { [STORAGE_KEYS.NOTE_MIGRATION]: JSON.stringify({ date: '2024-02-30', source: 'Legacy must survive', content: 'Legacy must survive' }) },
    { [STORAGE_KEYS.NOTE_MIGRATION]: JSON.stringify({ date: '2024-02-29', source: 'Legacy must survive', content: 12 }) },
  ];
  for (const invalid of invalidEntries) {
    const storage = new MemoryStorage({ ...invalid, [STORAGE_KEYS.NOTE]: 'Legacy must survive' });
    const before = new Map(storage.values);
    assert.throws(() => loadData(storage, '2024-02-29'));
    assert.deepEqual(storage.values, before);
  }
});

test('storage loads existing todos and date-keyed notes unchanged', () => {
  const todo = { id: 'todo', title: 'Plan', isCompleted: false, createdAt: parseDate('2024-02-29').getTime() };
  const storage = new MemoryStorage({
    [STORAGE_KEYS.TODO_ITEMS]: JSON.stringify([todo]),
    [STORAGE_KEYS.DAILY_NOTES]: JSON.stringify({ '2024-02-29': 'Local leap day' }),
  });
  assert.deepEqual(loadData(storage, '2024-02-29'), { dailyTasks: [], todos: [todo], notes: { '2024-02-29': 'Local leap day' } });
});

test('save persists complete data and rolls back partial writes when storage fails', () => {
  const storage = new MemoryStorage();
  saveData(storage, emptyData);
  const before = new Map(storage.values);
  const changed: AppData = {
    dailyTasks: [{ id: 'read', title: 'Read', isCompleted: true, lastCompletedDate: '2024-02-29', completionHistory: ['2024-02-29'] }],
    todos: [{ id: 'plan', title: 'Plan', isCompleted: false, createdAt: parseDate('2024-03-01').getTime() }],
    notes: { '2024-02-29': 'Keep this draft' },
  };
  storage.failSet = STORAGE_KEYS.DAILY_NOTES;
  assert.throws(() => saveData(storage, changed), /Storage write failed/);
  assert.deepEqual(storage.values, before);
  storage.failSet = null;
  saveData(storage, changed);
  assert.deepEqual(loadData(storage, '2024-02-29'), changed);
  const persisted = new Map(storage.values);
  assert.throws(() => saveData(storage, { ...changed, notes: { '2024-02-30': 'Invalid' } }));
  assert.deepEqual(storage.values, persisted);
});

test('raw legacy note migration preserves conflicting destination content and removes source after persistence', () => {
  const storage = new MemoryStorage({
    [STORAGE_KEYS.NOTE]: 'not JSON: legacy thoughts',
    [STORAGE_KEYS.DAILY_NOTES]: JSON.stringify({ '2024-02-29': 'Existing daily note', '2024-02-28': 'Earlier day' }),
  });
  const expected = { '2024-02-29': 'Existing daily note\n\nnot JSON: legacy thoughts', '2024-02-28': 'Earlier day' };
  assert.deepEqual(loadData(storage, '2024-02-29').notes, expected);
  assert.equal(storage.getItem(STORAGE_KEYS.NOTE), null);
  assert.deepEqual(loadData(storage, '2024-02-29').notes, expected);
  const sameContent = new MemoryStorage({ [STORAGE_KEYS.NOTE]: 'Same', [STORAGE_KEYS.DAILY_NOTES]: JSON.stringify({ '2024-02-29': 'Same' }) });
  assert.equal(loadData(sameContent, '2024-02-29').notes['2024-02-29'], 'Same');
  const emptyDestination = new MemoryStorage({ [STORAGE_KEYS.NOTE]: 'Legacy content', [STORAGE_KEYS.DAILY_NOTES]: JSON.stringify({ '2024-02-29': '' }) });
  assert.equal(loadData(emptyDestination, '2024-02-29').notes['2024-02-29'], 'Legacy content');
  const emptyLegacy = new MemoryStorage({ [STORAGE_KEYS.NOTE]: '' });
  assert.deepEqual(loadData(emptyLegacy, '2024-02-29').notes, { '2024-02-29': '' });
  const blankSource = new MemoryStorage({ [STORAGE_KEYS.NOTE]: '', [STORAGE_KEYS.DAILY_NOTES]: JSON.stringify({ '2024-02-29': 'Existing' }) });
  assert.deepEqual(loadData(blankSource, '2024-02-29').notes, { '2024-02-29': 'Existing' });
  const suffixCollision = new MemoryStorage({ [STORAGE_KEYS.NOTE]: 'Legacy', [STORAGE_KEYS.DAILY_NOTES]: JSON.stringify({ '2024-02-29': 'Original\n\nLegacy' }) });
  assert.deepEqual(loadData(suffixCollision, '2024-02-29').notes, { '2024-02-29': 'Original\n\nLegacy\n\nLegacy' });
});

test('failed migration writes retain legacy note and next-day cleanup retries never duplicate content', () => {
  const storage = new MemoryStorage({ [STORAGE_KEYS.NOTE]: 'Keep legacy', [STORAGE_KEYS.DAILY_NOTES]: JSON.stringify({ '2024-02-29': 'Existing' }) });
  const before = new Map(storage.values);
  storage.failSet = STORAGE_KEYS.DAILY_NOTES;
  assert.throws(() => loadData(storage, '2024-02-29'), /Storage write failed/);
  assert.equal(storage.getItem(STORAGE_KEYS.NOTE), 'Keep legacy');
  assert.equal(storage.getItem(STORAGE_KEYS.DAILY_NOTES), before.get(STORAGE_KEYS.DAILY_NOTES));
  storage.failSet = null;
  storage.failRemove = STORAGE_KEYS.NOTE;
  assert.throws(() => loadData(storage, '2024-02-29'), /Storage removal failed/);
  assert.equal(storage.getItem(STORAGE_KEYS.NOTE), 'Keep legacy');
  storage.failRemove = null;
  assert.deepEqual(loadData(storage, '2024-03-01').notes, { '2024-02-29': 'Existing\n\nKeep legacy' });
  assert.equal(storage.getItem(STORAGE_KEYS.NOTE), null);
  assert.equal(storage.getItem(STORAGE_KEYS.NOTE_MIGRATION), null);
});

test('storage read and migration journal write errors propagate without destroying source', () => {
  const unreadable = new MemoryStorage();
  unreadable.getItem = () => { throw new Error('Storage read failed'); };
  assert.throws(() => loadData(unreadable, '2024-02-29'), /Storage read failed/);
  const storage = new MemoryStorage({ [STORAGE_KEYS.NOTE]: 'Keep source' });
  storage.failSet = STORAGE_KEYS.NOTE_MIGRATION;
  const before = new Map(storage.values);
  assert.throws(() => loadData(storage, '2024-02-29'), /Storage write failed/);
  assert.deepEqual(storage.values, before);
});

test('browser import migrates a copy and never changes source keys', () => {
  const storage = new MemoryStorage({
    [STORAGE_KEYS.NOTE]: 'Legacy',
    [STORAGE_KEYS.DAILY_NOTES]: JSON.stringify({ '2024-02-29': 'Existing' }),
  });
  const before = new Map(storage.values);
  assert.equal(readBrowserData(storage, '2024-02-29').notes['2024-02-29'], 'Existing\n\nLegacy');
  assert.deepEqual(readBrowserData(storage, '2024-02-29'), readBrowserData(storage, '2024-02-29'));
  assert.deepEqual(storage.values, before);
  assert.throws(() => parseAppData({ dailyTasks: [], todos: [], notes: { '2024-02-30': 'Invalid' } }, '2024-02-29'));
  assert.throws(() => parseAppData(null, '2024-02-29'));
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const settled = () => new Promise<void>(resolve => setImmediate(resolve));

test('cloud writer serializes writes and coalesces newest edits without stale saved state', async () => {
  const requests: { data: AppData; version: number; response: ReturnType<typeof deferred<number>> }[] = [];
  let reportedDirty = false;
  const writer = new CloudWriter(3, (data, version) => {
    const response = deferred<number>();
    requests.push({ data, version, response });
    return response.promise;
  }, () => { reportedDirty = writer.dirty; });
  const first = { ...emptyData, notes: { '2024-02-29': 'First' } };
  const latest = { ...emptyData, notes: { '2024-02-29': 'Latest' } };
  writer.queue(first);
  writer.queue({ ...first, notes: { '2024-02-29': 'Intermediate' } });
  writer.queue(latest);
  assert.equal(requests.length, 1);
  assert.equal(reportedDirty, true);
  requests[0].response.resolve(4);
  await settled();
  assert.equal(requests.length, 2);
  assert.equal(requests[1].version, 4);
  assert.equal(requests[1].data, latest);
  assert.equal(reportedDirty, true);
  requests[1].response.resolve(5);
  await settled();
  assert.equal(writer.version, 5);
  assert.equal(reportedDirty, false);
});

test('failed or ambiguous cloud save retains request ID and version for safe retry', async () => {
  const requests: { data: AppData; version: number; id: string }[] = [];
  let fail = true;
  const writer = new CloudWriter(0, async (data, version, id) => {
    requests.push({ data, version, id });
    if (fail) throw new Error('Connection lost');
    return version + 1;
  }, () => {});
  writer.queue(emptyData);
  await settled();
  const latest = { ...emptyData, notes: { '2024-02-29': 'Newer unsaved draft' } };
  writer.queue(latest);
  await settled();
  assert.equal(requests.length, 1);
  assert.equal(writer.dirty, true);
  assert.equal(writer.version, 0);
  assert.match(writer.error, /Connection lost/);
  fail = false;
  writer.retry();
  await settled();
  assert.deepEqual(requests[1], requests[0]);
  assert.equal(requests[2].data, latest);
  assert.equal(requests[2].version, 1);
  assert.equal(writer.version, 2);
  assert.equal(writer.dirty, false);
});

test('cloud conflict never adopts a fresh version or overwrites remote data', async () => {
  let calls = 0;
  const writer = new CloudWriter(9, async (_data, version) => {
    assert.equal(version, 9);
    calls++;
    throw new Error('Data changed in another tab');
  }, () => {});
  writer.queue(emptyData);
  await settled();
  writer.queue({ ...emptyData, notes: { '2024-02-29': 'Keep this' } });
  assert.equal(calls, 1);
  writer.retry();
  await settled();
  assert.equal(calls, 2);
  assert.equal(writer.version, 9);
  assert.equal(writer.dirty, true);
});

test('disposed account writer stops queued work and stale UI notifications', async () => {
  const response = deferred<number>();
  let calls = 0;
  let notifications = 0;
  const writer = new CloudWriter(0, () => { calls++; return response.promise; }, () => { notifications++; });
  writer.queue(emptyData);
  writer.queue({ ...emptyData, notes: { '2024-02-29': 'Queued' } });
  writer.disposed = true;
  const previousNotifications = notifications;
  response.resolve(1);
  await settled();
  assert.equal(calls, 1);
  assert.equal(notifications, previousNotifications);
});
