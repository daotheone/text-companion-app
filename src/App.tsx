import { useEffect, useRef, useState, type FormEvent } from 'react';
import { addDays, addMonths, addWeeks, format, startOfMonth } from 'date-fns';
import type { AppData, DailyTask, TodoItem } from './types';
import { readBrowserData, resetDailyTasks, toggleHabit } from './data/storage';
import { CloudWriter, loadCloud, saveCloud } from './data/cloud';
import { supabase } from './data/supabase';
import { formatDate, getMonthGrid, getWeekGrid, parseDate } from './utils/calendar';
import Modal from './components/Modal';
import ThemeButton from './components/ThemeButton';

const GREETINGS = ['Hello', 'Hi there', 'Good to see you', 'Welcome back'];
const randomGreeting = () => GREETINGS[Math.floor(Math.random() * GREETINGS.length)];
const emptyData = (): AppData => ({ dailyTasks: [], todos: [], notes: {} });

export default function App({ userId, email, authenticated, onLeave }: { userId: string; email: string; authenticated: boolean; onLeave: (signedOut?: boolean) => void }) {
  const [data, setData] = useState<AppData>(emptyData);
  const current = useRef(data);
  const writer = useRef<CloudWriter | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [saveState, setSaveState] = useState('Loading…');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [importAvailable, setImportAvailable] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [today, setToday] = useState(() => formatDate(new Date()));
  const [cursor, setCursor] = useState(() => new Date());
  const [view, setView] = useState<'month' | 'week'>('month');
  const [selected, setSelected] = useState<string | null>(null);
  const panelClose = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (selected) panelClose.current?.focus(); }, [selected]);
  const dayTrigger = useRef<HTMLButtonElement | null>(null);
  const [noteDate, setNoteDate] = useState(today);
  const [noteDraft, setNoteDraft] = useState('');
  const draft = useRef({ date: today, content: '', dirty: false });
  const [allNotes, setAllNotes] = useState(false);
  const [adding, setAdding] = useState(false);
  const addId = useRef('');
  const [addTitle, setAddTitle] = useState('');
  const [addType, setAddType] = useState<'todo' | 'habit'>('todo');
  const [addDate, setAddDate] = useState(today);
  const [formError, setFormError] = useState('');
  const [habitTitle, setHabitTitle] = useState('');
  const [todoTitle, setTodoTitle] = useState('');
  const [greeting, setGreeting] = useState(randomGreeting);
  const [cycle, setCycle] = useState(0);
  const [editing, setEditing] = useState<{ type: 'habit' | 'todo'; id: string } | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editError, setEditError] = useState('');

  const showError = (cause: unknown) => setError(`${cause instanceof Error ? cause.message : 'Cloud unavailable'}. Changes not saved; keep this tab open and retry. If another tab changed data, export your changes before reloading.`);
  const commit = (next: AppData) => {
    if (!ready || !writer.current || !authenticated || loggingOut) return false;
    current.current = next;
    setData(next);
    writer.current.queue(next);
    return true; // Accepted locally; Saved appears only after cloud acknowledgement.
  };
  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    let active = true;
    let ownedWriter: CloudWriter | null = null;
    setReady(false);
    loadCloud(client, userId, formatDate(new Date())).then(loaded => {
      if (!active) return;
      current.current = loaded.data;
      setData(loaded.data);
      const content = loaded.data.notes[draft.current.date] ?? '';
      draft.current = { ...draft.current, content, dirty: false };
      setNoteDraft(content);
      ownedWriter = new CloudWriter(loaded.version, (data, version, id) => saveCloud(client, userId, data, version, id), () => {
        if (!active || !ownedWriter) return;
        if (ownedWriter.error) { showError(new Error(ownedWriter.error)); setSaveState('Not saved'); }
        else { setError(''); setSaveState(ownedWriter.dirty ? 'Saving…' : 'Saved to Supabase'); }
        if (!ownedWriter.dirty) draft.current.dirty = false;
        if (ownedWriter.version > 0) setImportAvailable(false);
      });
      writer.current = ownedWriter;
      setImportAvailable(loaded.version === 0);
      setReady(true); setError(''); setSaveState('Saved to Supabase');
    }).catch(cause => { if (active) { showError(cause); setSaveState('Load failed'); } });
    return () => {
      active = false;
      if (ownedWriter) ownedWriter.disposed = true;
      writer.current = null;
    };
  }, [userId, loadAttempt]);

  const flushNote = () => {
    if (!draft.current.dirty) return true;
    if (!ready) return false;
    const { date, content } = draft.current;
    const notes = { ...current.current.notes };
    if (content) notes[date] = content;
    else delete notes[date];
    if (current.current.notes[date] !== notes[date]) commit({ ...current.current, notes });
    else if (!writer.current?.dirty) draft.current.dirty = false;
    return !writer.current?.error;
  };
  const signOut = async () => {
    if (!supabase || loggingOut || !authenticated) return;
    if (draft.current.dirty || writer.current?.dirty) {
      setError('Unsaved changes. Retry save or export your changes before logging out.');
      return;
    }
    setLoggingOut(true);
    try {
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) throw error;
      onLeave(true);
    } catch (cause) { showError(cause); }
    finally { setLoggingOut(false); }
  };
  const importBrowser = () => {
    if (!ready || !authenticated || loggingOut || writer.current?.dirty || writer.current?.version !== 0) return;
    if (!window.confirm('Import this browser’s old habits, tasks, and notes into this account? The original browser data will remain unchanged.')) return;
    try {
      const imported = readBrowserData(window.localStorage, formatDate(new Date()));
      draft.current = { date: noteDate, content: imported.notes[noteDate] ?? '', dirty: false };
      setNoteDraft(draft.current.content);
      commit(imported);
      setImportAvailable(false);
    } catch (cause) { showError(cause); }
  };
  const exportChanges = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(current.current, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'text-companion-backup.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  useEffect(() => {
    let midnight: ReturnType<typeof setTimeout>;
    let lastZone = new Date().getTimezoneOffset();
    let lastDay = formatDate(new Date());
    const checkDay = () => {
      const date = formatDate(new Date());
      const zone = new Date().getTimezoneOffset();
      if (date !== lastDay || zone !== lastZone) {
        lastDay = date; lastZone = zone;
        clearTimeout(midnight);
        schedule();
      }
      setToday(date);
      if (!ready) return;
      const tasks = resetDailyTasks(current.current.dailyTasks, date);
      if (tasks.some((task, index) => task.isCompleted !== current.current.dailyTasks[index].isCompleted)) commit({ ...current.current, dailyTasks: tasks });
    };
    const visibility = () => { if (document.visibilityState === 'visible') checkDay(); };
    const schedule = () => {
      const now = new Date();
      const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      midnight = setTimeout(() => { checkDay(); clearTimeout(midnight); schedule(); }, next.getTime() - now.getTime() + 50);
    };
    schedule();
    const clock = setInterval(checkDay, 30_000);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('focus', checkDay);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (draft.current.dirty || writer.current?.dirty) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      clearTimeout(midnight);
      clearInterval(clock);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('focus', checkDay);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [ready, authenticated, loggingOut]);

  const incomplete = data.dailyTasks.filter(task => !task.isCompleted);
  const activeHabit = incomplete[cycle % (incomplete.length || 1)];
  const activeTodo = data.todos.find(todo => !todo.isCompleted);
  const prompt = activeHabit ? `${greeting}, did you ${activeHabit.title.toLowerCase()} today?`
    : activeTodo ? `Daily tasks complete. Maybe you can check on “${activeTodo.title}”?`
      : 'All caught up for today. Take a breather.';
  const toggle = (id: string) => {
    const date = formatDate(new Date());
    setToday(date);
    const tasks = resetDailyTasks(current.current.dailyTasks, date).map(task => task.id === id ? toggleHabit(task, date) : task);
    return commit({ ...current.current, dailyTasks: tasks });
  };
  const toggleTodo = (id: string) => commit({ ...current.current, todos: current.current.todos.map(todo => todo.id === id ? { ...todo, isCompleted: !todo.isCompleted } : todo) });
  const remove = (type: 'habit' | 'todo', id: string) => {
    const next = type === 'habit' ? { ...current.current, dailyTasks: current.current.dailyTasks.filter(task => task.id !== id) }
      : { ...current.current, todos: current.current.todos.filter(todo => todo.id !== id) };
    if (commit(next)) setEditing(null);
  };
  const add = (title: string, type: 'habit' | 'todo', date = formatDate(new Date()), id: string = crypto.randomUUID()) => {
    if (!title.trim()) return false;
    const next = type === 'habit'
      ? { ...current.current, dailyTasks: [...current.current.dailyTasks.filter(task => task.id !== id), { id, title: title.trim(), isCompleted: false, lastCompletedDate: null, completionHistory: [] }] }
      : { ...current.current, todos: [...current.current.todos.filter(todo => todo.id !== id), { id, title: title.trim(), isCompleted: false, createdAt: parseDate(date).getTime() }] };
    return commit(next);
  };
  const openAdd = (date: string) => {
    addId.current = crypto.randomUUID();
    setAddTitle(''); setAddType('todo'); setAddDate(date); setFormError(''); setAdding(true);
  };
  const cancelAdd = () => setAdding(false);
  const submitAdd = (event: FormEvent) => {
    event.preventDefault();
    if (!addTitle.trim()) { setFormError('Enter a title.'); return; }
    try {
      const accepted = add(addTitle, addType, addDate, addId.current);
      if (accepted) { setAdding(false); setAddTitle(''); }
      else setFormError('Could not save. Your item is retained; press Add to retry.');
    } catch { setFormError('Choose a valid date.'); }
  };
  const changeNoteDate = (date: string) => {
    if (!flushNote()) return false;
    const content = current.current.notes[date] ?? '';
    draft.current = { date, content, dirty: false };
    setNoteDate(date); setNoteDraft(content);
    return true;
  };
  const startEdit = (type: 'habit' | 'todo', item: DailyTask | TodoItem) => {
    setEditing({ type, id: item.id }); setEditTitle(item.title); setEditError('');
  };
  const saveEdit = (event: FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    if (!editTitle.trim()) { setEditError('Enter a title.'); return; }
    const { type, id } = editing;
    const next = type === 'habit' ? { ...current.current, dailyTasks: current.current.dailyTasks.map(task => task.id === id ? { ...task, title: editTitle.trim() } : task) }
      : { ...current.current, todos: current.current.todos.map(todo => todo.id === id ? { ...todo, title: editTitle.trim() } : todo) };
    if (commit(next)) setEditing(null);
  };
  const renderDetailItem = (type: 'habit' | 'todo', item: DailyTask | TodoItem) => <li key={item.id}>
    {editing?.type === type && editing.id === item.id ? <form onSubmit={saveEdit}><fieldset disabled={loggingOut || !authenticated}>
      <label>Title<input autoFocus value={editTitle} onChange={event => setEditTitle(event.target.value)} required /></label>
      {editError && <p role="alert">{editError}</p>}
      <button type="submit">[Save]</button><button type="button" onClick={() => setEditing(null)}>[Cancel]</button>
    </fieldset></form> : <><span>{item.title}</span><div className="item-actions">
      <button disabled={loggingOut || !authenticated} aria-label={`Edit ${item.title}`} onClick={() => startEdit(type, item)}>[edit]</button>
      <button disabled={loggingOut || !authenticated} aria-label={`Delete ${item.title}`} onClick={() => remove(type, item.id)}>[delete]</button>
    </div></>}
  </li>;
  const closePanel = () => { setSelected(null); setEditing(null); dayTrigger.current?.focus(); };
  const days = view === 'month' ? getMonthGrid(cursor.getFullYear(), cursor.getMonth()).flat() : getWeekGrid(cursor);
  const heading = view === 'month' ? format(cursor, 'MMMM yyyy') : `${format(days[0], 'MMM d')} – ${format(days[6], 'MMM d, yyyy')}`;

  return <div className="app-shell">
    <a className="skip-link" href="#calendar">Skip to calendar</a>
    <aside className="sidebar" aria-label="Daily companion">
      <header className="brand"><h1>text companion</h1><ThemeButton /><p>A little room for your day.</p></header>
      <div className="account"><p className="muted">{email}</p><button disabled={loggingOut || !authenticated} onClick={signOut}>[Log out]</button>{importAvailable && <button disabled={!ready || !authenticated || loggingOut || Boolean(writer.current?.dirty)} onClick={importBrowser}>[Import browser data]</button>}</div>
      {!authenticated && <div className="storage-error" role="alert"><p>Session changed. Your changes remain in this tab. Export them before continuing to log in.</p><button onClick={exportChanges}>[Export changes]</button><button onClick={() => { if ((!writer.current?.dirty && !draft.current.dirty) || window.confirm('Discard unsaved changes in this tab and continue? Export them first if you want to keep them.')) onLeave(); }}>[Continue to log in]</button></div>}
      {!ready && !error && <p role="status">Loading your data…</p>}
      {error && <div className="storage-error" role="alert"><p>{error}</p><button disabled={!authenticated || loggingOut} onClick={() => { if (!ready) setLoadAttempt(value => value + 1); else writer.current?.retry(); }}>{ready ? '[Retry save]' : '[Retry load]'}</button>{ready && <button onClick={exportChanges}>[Export changes]</button>}</div>}
      <fieldset disabled={!ready || loggingOut || !authenticated} className="sidebar-content">
        <details open><summary>Companion</summary><div className="section-content">
          <p className="companion-prompt" aria-live="polite">{prompt}</p>
          {(activeHabit || activeTodo) && <div className="actions">
            <button onClick={() => { if (activeHabit ? toggle(activeHabit.id) : activeTodo && toggleTodo(activeTodo.id)) setGreeting(randomGreeting()); }}>[Yes, done]</button>
            <button onClick={() => { setCycle(value => value + 1); setGreeting(randomGreeting()); }}>[Skip for now]</button>
          </div>}
        </div></details>
        <details open><summary>Daily Habits</summary><div className="section-content">
          {!data.dailyTasks.length && <p className="muted">Start with one small habit.</p>}
          <ul className="task-list">{data.dailyTasks.map(task => <li key={task.id}>
            <label className={task.isCompleted ? 'completed' : ''}><input type="checkbox" checked={task.isCompleted} onChange={() => toggle(task.id)} /><span>{task.title}</span></label>
            <button aria-label={`Delete habit ${task.title}`} onClick={() => remove('habit', task.id)}>[delete]</button>
          </li>)}</ul>
          <form onSubmit={event => { event.preventDefault(); if (add(habitTitle, 'habit')) setHabitTitle(''); }}>
            <label className="sr-only" htmlFor="new-habit">New habit</label><input id="new-habit" placeholder="> add a daily habit…" value={habitTitle} onChange={event => setHabitTitle(event.target.value)} required />
            <button className="sr-only focus-visible" type="submit">Add habit</button>
          </form>
        </div></details>
        <details open><summary>To-Do</summary><div className="section-content">
          {!data.todos.length && <p className="muted">Nothing on your list. Room to breathe.</p>}
          <ul className="task-list">{[...data.todos].sort((a, b) => Number(a.isCompleted) - Number(b.isCompleted)).map(todo => <li key={todo.id}>
            <label className={todo.isCompleted ? 'completed' : ''}><input type="checkbox" checked={todo.isCompleted} onChange={() => toggleTodo(todo.id)} /><span>{todo.title}</span></label>
            <button aria-label={`Delete task ${todo.title}`} onClick={() => remove('todo', todo.id)}>[delete]</button>
          </li>)}</ul>
          <form onSubmit={event => { event.preventDefault(); if (add(todoTitle, 'todo')) setTodoTitle(''); }}>
            <label className="sr-only" htmlFor="new-todo">New task</label><input id="new-todo" placeholder="> add a task…" value={todoTitle} onChange={event => setTodoTitle(event.target.value)} required />
            <button className="sr-only focus-visible" type="submit">Add task</button>
          </form>
        </div></details>
        <details open className="notes-section"><summary>Notes</summary><div className="section-content">
          <div className="note-navigation"><button aria-label="Previous note day" onClick={() => changeNoteDate(formatDate(addDays(parseDate(noteDate), -1)))}>&lt;</button>
            <label className="sr-only" htmlFor="note-date">Note date</label><input id="note-date" type="date" value={noteDate} onChange={event => { try { parseDate(event.target.value); changeNoteDate(event.target.value); } catch { /* Native date input can be temporarily empty. */ } }} />
            <button aria-label="Next note day" onClick={() => changeNoteDate(formatDate(addDays(parseDate(noteDate), 1)))}>&gt;</button></div>
          <label className="sr-only" htmlFor="daily-note">Daily note</label><textarea id="daily-note" placeholder="A thought worth keeping…" value={noteDraft} onChange={event => {
            setNoteDraft(event.target.value); draft.current = { date: noteDate, content: event.target.value, dirty: true }; flushNote();
          }} />
          <div className="actions"><button onClick={() => { if (flushNote()) setAllNotes(true); }}>[All notes]</button><span className="muted" role="status">{saveState}</span></div>
        </div></details>
        <button className="add-item" aria-label="Add item" onClick={() => openAdd(formatDate(new Date()))}>[+ add]</button>
      </fieldset>
    </aside>
    <main id="calendar" className="calendar" tabIndex={-1}>
      <header className="calendar-toolbar"><div><p className="muted">Your days, at a glance</p><h2 id="calendar-heading">{heading}</h2></div>
        <nav aria-label="Calendar navigation"><button aria-label={`Previous ${view}`} onClick={() => setCursor(date => view === 'month' ? addMonths(startOfMonth(date), -1) : addWeeks(date, -1))}>&lt;</button>
          <button onClick={() => setCursor(new Date())}>Today</button><button aria-label={`Next ${view}`} onClick={() => setCursor(date => view === 'month' ? addMonths(startOfMonth(date), 1) : addWeeks(date, 1))}>&gt;</button>
          <button aria-pressed={view === 'month'} onClick={() => setView('month')}>Month</button><button aria-pressed={view === 'week'} onClick={() => setView('week')}>Week</button>
        </nav>
      </header>
      <div className="weekday-row" aria-hidden="true">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => <span key={day}>{day}</span>)}</div>
      <div className={`calendar-grid ${view}`} aria-labelledby="calendar-heading">
        {days.map(day => {
          const date = formatDate(day);
          const count = data.dailyTasks.filter(task => task.completionHistory.includes(date)).length;
          const todos = data.todos.filter(todo => formatDate(new Date(todo.createdAt)) === date);
          const hasNote = Boolean(data.notes[date]);
          return <button key={date} className={`day-cell ${day.getMonth() !== cursor.getMonth() ? 'other-month' : ''} ${date === today ? 'today' : ''} ${date === selected ? 'selected' : ''}`}
            aria-current={date === today ? 'date' : undefined} aria-pressed={date === selected} aria-expanded={date === selected} aria-controls={date === selected ? 'day-details' : undefined}
            aria-label={`${format(day, 'EEEE, MMMM d, yyyy')}, ${count} habits completed, ${todos.length} tasks${hasNote ? ', note available' : ''}`}
            onClick={event => { dayTrigger.current = event.currentTarget; setSelected(date); setEditing(null); }}>
            <span className="day-heading"><time dateTime={date}>{day.getDate()}</time>{count > 0 && <span className="habit-count" title={`${count} habits completed`}>{count}</span>}{hasNote && <span aria-hidden="true">•</span>}</span>
            <span className="day-tasks">{todos.slice(0, 3).map(todo => <span key={todo.id} className={todo.isCompleted ? 'completed' : ''}>{todo.title}</span>)}{todos.length > 3 && <span className="muted">+{todos.length - 3} more</span>}</span>
          </button>;
        })}
      </div>
      <p className="calendar-caption">A number for habits done. A dot for thoughts saved. Select a day to look closer.</p>
      {selected && <aside id="day-details" className="detail-panel" aria-label="Day details" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); closePanel(); } }}>
        <header><h2>{format(parseDate(selected), 'EEEE, MMMM d')}</h2><button ref={panelClose} onClick={closePanel}>[Close]</button></header>
        <h3>Habits completed</h3><ul className="detail-list">{data.dailyTasks.filter(task => task.completionHistory.includes(selected)).map(task => renderDetailItem('habit', task))}</ul>
        {!data.dailyTasks.some(task => task.completionHistory.includes(selected)) && <p className="muted">No habits completed.</p>}
        <h3>To-Do</h3><ul className="detail-list">{data.todos.filter(todo => formatDate(new Date(todo.createdAt)) === selected).map(todo => renderDetailItem('todo', todo))}</ul>
        {!data.todos.some(todo => formatDate(new Date(todo.createdAt)) === selected) && <p className="muted">No tasks for this day.</p>}
        <h3>Note</h3><p className="note-preview">{data.notes[selected] || 'No note for this day.'}</p>
        <p className="muted">Notes edited in sidebar. Habit edits and deletes apply to all dates.</p>
        <button disabled={!ready || loggingOut || !authenticated} aria-label="Add item for selected day" onClick={() => openAdd(selected)}>[+ add]</button>
      </aside>}
    </main>
    {adding && <Modal title="Add item" onClose={cancelAdd}><form onSubmit={submitAdd}><fieldset disabled={loggingOut || !authenticated}>
      <label>Title<input autoFocus value={addTitle} onChange={event => setAddTitle(event.target.value)} required /></label>
      <label htmlFor="add-type">Type</label><select id="add-type" value={addType} onChange={event => setAddType(event.target.value === 'habit' ? 'habit' : 'todo')}><option value="todo">To-Do</option><option value="habit">Daily Habit</option></select>
      {addType === 'todo' ? <label>Date<input type="date" value={addDate} onChange={event => setAddDate(event.target.value)} required /></label> : <p className="muted">Daily habits repeat each day. Complete them to record a date.</p>}
      {formError && <p role="alert">{formError}</p>}
      <div className="actions"><button type="submit">[Add]</button><button type="button" onClick={cancelAdd}>[Cancel]</button></div>
    </fieldset></form></Modal>}
    {allNotes && <Modal title="All notes" onClose={() => setAllNotes(false)}><ul className="all-notes">
      {Object.entries(data.notes).filter(([, content]) => content).sort(([a], [b]) => b.localeCompare(a)).map(([date, content]) => <li key={date}><button onClick={() => { if (changeNoteDate(date)) setAllNotes(false); }}><time dateTime={date}>{date}</time><span>{content.slice(0, 140)}</span></button></li>)}
      {!Object.values(data.notes).some(Boolean) && <li className="muted">No notes yet. Write your first thought in the sidebar.</li>}
    </ul></Modal>}
  </div>;
}
