import React, { useState, useEffect, useMemo, useCallback } from 'react';
import type { DailyTask, TodoItem } from './types';
import { STORAGE_KEYS } from './data/storageKeys';

const GREETINGS = ["Hello", "Hi there", "Good to see you", "Welcome back"];

const DEFAULT_DAILY_TASKS: DailyTask[] = [
  { id: '1', title: 'Drink water', isCompleted: false, lastCompletedDate: '' },
  { id: '2', title: 'Read 10 pages', isCompleted: false, lastCompletedDate: '' },
  { id: '3', title: 'Stretch for 10 minutes', isCompleted: false, lastCompletedDate: '' },
];

export default function App() {
  const getTodayString = () => new Date().toISOString().split('T')[0];

  // 1. Initialize State with Midnight Reset logic
  const [dailyTasks, setDailyTasks] = useState<DailyTask[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.DAILY_TASKS);
      if (saved) {
        const parsed: DailyTask[] = JSON.parse(saved);
        const today = getTodayString();
        // Midnight reset: if lastCompletedDate < today, reset isCompleted to false
        return parsed.map(task => ({
          ...task,
          isCompleted: task.lastCompletedDate === today ? task.isCompleted : false,
        }));
      }
    } catch (e) {
      console.error(e);
    }
    return DEFAULT_DAILY_TASKS;
  });

  const [todos, setTodos] = useState<TodoItem[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.TODO_ITEMS);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error(e);
    }
    return [
      { id: 't1', title: 'Review weekly goals', isCompleted: false, createdAt: Date.now() },
      { id: 't2', title: 'Send project update', isCompleted: false, createdAt: Date.now() },
    ];
  });

  const [noteContent, setNoteContent] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.NOTE);
      if (saved !== null) return saved;
    } catch (e) {
      console.error(e);
    }
    return '';
  });

  const [isNotesOpen, setIsNotesOpen] = useState(false);
  const [newTodoTitle, setNewTodoTitle] = useState('');
  const [newHabitTitle, setNewHabitTitle] = useState('');
  const [showAddHabitInput, setShowAddHabitInput] = useState(false);

  // Random greeting selected on mount or state change
  const [greeting, setGreeting] = useState(() => GREETINGS[Math.floor(Math.random() * GREETINGS.length)]);
  // Index for cycling through uncompleted habits when clicking [Skip for now]
  const [activeHabitCycleIndex, setActiveHabitCycleIndex] = useState(0);

  // 2. Persistence & Midnight Reset check on window focus / visibility change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.DAILY_TASKS, JSON.stringify(dailyTasks));
  }, [dailyTasks]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.TODO_ITEMS, JSON.stringify(todos));
  }, [todos]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.NOTE, noteContent);
  }, [noteContent]);

  const checkMidnightReset = useCallback(() => {
    const today = getTodayString();
    setDailyTasks(prev =>
      prev.map(task => {
        if (task.lastCompletedDate && task.lastCompletedDate !== today) {
          return { ...task, isCompleted: false };
        }
        return task;
      })
    );
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkMidnightReset();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', checkMidnightReset);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', checkMidnightReset);
    };
  }, [checkMidnightReset]);

  // 3. Companion Engine State Evaluation
  const incompleteHabits = useMemo(() => dailyTasks.filter(t => !t.isCompleted), [dailyTasks]);
  const incompleteTodos = useMemo(() => todos.filter(t => !t.isCompleted), [todos]);

  // Reset cycle index if out of bounds
  useEffect(() => {
    if (activeHabitCycleIndex >= incompleteHabits.length) {
      setActiveHabitCycleIndex(0);
    }
  }, [incompleteHabits.length, activeHabitCycleIndex]);

  const companionState = useMemo(() => {
    if (incompleteHabits.length > 0) {
      const currentHabit = incompleteHabits[activeHabitCycleIndex] || incompleteHabits[0];
      return {
        type: 'habit' as const,
        text: `${greeting}, did you ${currentHabit.title.toLowerCase()} today?`,
        targetHabit: currentHabit,
      };
    } else if (incompleteTodos.length > 0) {
      const firstTodo = incompleteTodos[0];
      return {
        type: 'todo' as const,
        text: `Daily tasks complete. Maybe you can check on "${firstTodo.title}"?`,
        targetTodo: firstTodo,
      };
    } else {
      return {
        type: 'done' as const,
        text: 'All caught up for today. Take a breather.',
      };
    }
  }, [incompleteHabits, incompleteTodos, activeHabitCycleIndex, greeting]);

  // Handlers
  const handleToggleHabit = (id: string) => {
    const today = getTodayString();
    setDailyTasks(prev =>
      prev.map(t => {
        if (t.id === id) {
          const nextCompleted = !t.isCompleted;
          return {
            ...t,
            isCompleted: nextCompleted,
            lastCompletedDate: nextCompleted ? today : '',
          };
        }
        return t;
      })
    );
  };

  const handleCompanionYes = () => {
    if (companionState.type === 'habit' && companionState.targetHabit) {
      handleToggleHabit(companionState.targetHabit.id);
      setGreeting(GREETINGS[Math.floor(Math.random() * GREETINGS.length)]);
    } else if (companionState.type === 'todo' && companionState.targetTodo) {
      handleToggleTodo(companionState.targetTodo.id);
    }
  };

  const handleCompanionSkip = () => {
    if (companionState.type === 'habit' && incompleteHabits.length > 1) {
      setActiveHabitCycleIndex(prev => (prev + 1) % incompleteHabits.length);
      setGreeting(GREETINGS[Math.floor(Math.random() * GREETINGS.length)]);
    } else {
      // Pick a new random greeting
      setGreeting(GREETINGS[Math.floor(Math.random() * GREETINGS.length)]);
    }
  };

  const handleToggleTodo = (id: string) => {
    setTodos(prev =>
      prev.map(t => (t.id === id ? { ...t, isCompleted: !t.isCompleted } : t))
    );
  };

  const handleAddTodo = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTodoTitle.trim()) return;
    setTodos(prev => [
      ...prev,
      { id: Date.now().toString(), title: newTodoTitle.trim(), isCompleted: false, createdAt: Date.now() },
    ]);
    setNewTodoTitle('');
  };

  const handleDeleteTodo = (id: string) => {
    setTodos(prev => prev.filter(t => t.id !== id));
  };

  const handleAddHabit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newHabitTitle.trim()) return;
    setDailyTasks(prev => [
      ...prev,
      { id: Date.now().toString(), title: newHabitTitle.trim(), isCompleted: false, lastCompletedDate: '' },
    ]);
    setNewHabitTitle('');
    setShowAddHabitInput(false);
  };

  const handleDeleteHabit = (id: string) => {
    setDailyTasks(prev => prev.filter(t => t.id !== id));
  };

  // Sort todos: incomplete first, completed at the bottom
  const sortedTodos = useMemo(() => {
    return [...todos].sort((a, b) => Number(a.isCompleted) - Number(b.isCompleted));
  }, [todos]);

  return (
    <div className="app-container">
      {/* Header */}
      <header>
        <button className="text-btn" onClick={() => setIsNotesOpen(true)}>
          [Notes]
        </button>
      </header>

      {/* Main Companion Section */}
      <main>
        <section className="companion-section">
          <h1 className="companion-prompt">{companionState.text}</h1>
          {companionState.type !== 'done' && (
            <div className="companion-actions">
              <button className="action-link" onClick={handleCompanionYes}>
                [Yes, done]
              </button>
              <button className="action-link" onClick={handleCompanionSkip}>
                [Skip for now]
              </button>
            </div>
          )}
        </section>

        {/* Lists Section */}
        <div className="lists-grid">
          {/* Daily Habits Column */}
          <div className="list-column">
            <h2>
              Daily Habits
              <button
                className="text-btn"
                style={{ fontSize: '0.8rem', textTransform: 'none' }}
                onClick={() => setShowAddHabitInput(prev => !prev)}
              >
                {showAddHabitInput ? '[cancel]' : '[+ add]'}
              </button>
            </h2>

            <ul className="list-items">
              {dailyTasks.map(task => (
                <li key={task.id} className={`list-item ${task.isCompleted ? 'completed' : ''}`}>
                  <div className="item-content" onClick={() => handleToggleHabit(task.id)}>
                    <input
                      type="checkbox"
                      checked={task.isCompleted}
                      onChange={() => handleToggleHabit(task.id)}
                      className="item-checkbox"
                    />
                    <span>{task.title}</span>
                  </div>
                  <button
                    className="delete-btn"
                    onClick={() => handleDeleteHabit(task.id)}
                    title="Delete habit"
                  >
                    [x]
                  </button>
                </li>
              ))}
            </ul>

            {showAddHabitInput && (
              <form onSubmit={handleAddHabit} className="add-form">
                <input
                  type="text"
                  placeholder="> new habit..."
                  value={newHabitTitle}
                  onChange={e => setNewHabitTitle(e.target.value)}
                  className="add-input"
                  autoFocus
                />
              </form>
            )}
          </div>

          {/* To-Do List Column */}
          <div className="list-column">
            <h2>To-Do</h2>
            <ul className="list-items">
              {sortedTodos.map(todo => (
                <li key={todo.id} className={`list-item ${todo.isCompleted ? 'completed' : ''}`}>
                  <div className="item-content" onClick={() => handleToggleTodo(todo.id)}>
                    <input
                      type="checkbox"
                      checked={todo.isCompleted}
                      onChange={() => handleToggleTodo(todo.id)}
                      className="item-checkbox"
                    />
                    <span>{todo.title}</span>
                  </div>
                  <button
                    className="delete-btn"
                    onClick={() => handleDeleteTodo(todo.id)}
                    title="Delete todo"
                  >
                    [x]
                  </button>
                </li>
              ))}
            </ul>

            <form onSubmit={handleAddTodo} className="add-form">
              <input
                type="text"
                placeholder="> type a new task..."
                value={newTodoTitle}
                onChange={e => setNewTodoTitle(e.target.value)}
                className="add-input"
              />
            </form>
          </div>
        </div>
      </main>

      {/* Footer / Branding */}
      <footer style={{ marginTop: '5px', textAlign: 'center' }}>
        <span style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: '#999' }}>
          Text Companion — Distraction-Free Productivity
        </span>
      </footer>

      {/* Floating Notes Modal Overlay */}
      {isNotesOpen && (
        <div className="notes-overlay">
          <div className="notes-header">
            <span className="notes-title">scratchpad</span>
            <button className="text-btn" onClick={() => setIsNotesOpen(false)}>
              [Close]
            </button>
          </div>
          <textarea
            className="notes-textarea"
            placeholder="Type your transient thoughts here... (autosaved)"
            value={noteContent}
            onChange={e => setNoteContent(e.target.value)}
            autoFocus
          />
        </div>
      )}
    </div>
  );
}
