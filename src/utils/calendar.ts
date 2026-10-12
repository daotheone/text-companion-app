import { addDays, endOfMonth, endOfWeek, eachDayOfInterval, format, startOfWeek } from 'date-fns';

export { isSameDay } from 'date-fns';

export function formatDate(date: Date): string {
  if (!Number.isFinite(date.getTime()) || date.getFullYear() < 1 || date.getFullYear() > 9999) {
    throw new Error('Invalid date');
  }
  return format(date, 'yyyy-MM-dd');
}

export function parseDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Invalid date');
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  if (formatDate(date) !== value) throw new Error('Invalid date');
  return date;
}

export function getWeekGrid(date: Date): Date[] {
  formatDate(date);
  const monday = startOfWeek(date, { weekStartsOn: 1 });
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

export function getMonthGrid(year: number, month: number): Date[][] {
  if (!Number.isInteger(year) || year < 1 || year > 9999 || !Number.isInteger(month) || month < 0 || month > 11) {
    throw new Error('Invalid month');
  }
  const first = parseDate(`${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-01`);
  const days = eachDayOfInterval({ start: startOfWeek(first, { weekStartsOn: 1 }), end: endOfWeek(endOfMonth(first), { weekStartsOn: 1 }) });
  return Array.from({ length: days.length / 7 }, (_, index) => days.slice(index * 7, index * 7 + 7));
}
