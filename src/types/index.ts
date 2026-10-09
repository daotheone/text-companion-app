export interface DailyTask {
  id: string;
  title: string;
  isCompleted: boolean;
  lastCompletedDate: string | null; // YYYY-MM-DD
}

export interface TodoItem {
  id: string;
  title: string;
  isCompleted: boolean;
  createdAt: number; // Unix timestamp
}

export interface Note {
  content: string;
  lastEdited: string | null; // ISO Date string
}
