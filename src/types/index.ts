export interface DailyTask {
  id: string;
  title: string;
  isCompleted: boolean;
  lastCompletedDate: string | null; // ISO Date string (YYYY-MM-DD)
}

export interface TodoItem {
  id: string;
  title: string;
  isCompleted: boolean;
  createdAt: string; // ISO Date string
}

export interface Note {
  content: string;
  lastEdited: string; // ISO Date string
}
