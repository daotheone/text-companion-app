export interface DailyTask {
  id: string;
  title: string;
  isCompleted: boolean;
  lastCompletedDate: string | null; // Local YYYY-MM-DD
  completionHistory: string[];
}

export interface TodoItem {
  id: string;
  title: string;
  isCompleted: boolean;
  createdAt: number; // Selected local date as a Unix timestamp
}

export interface DailyNote {
  date: string;
  content: string;
}

export interface AppData {
  dailyTasks: DailyTask[];
  todos: TodoItem[];
  notes: Record<string, string>;
}

export interface Note {
  content: string;
  lastEdited: string | null; // ISO Date string
}
