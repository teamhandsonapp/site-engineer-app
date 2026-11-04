// Device local time deliberately (plain `new Date()`, no UTC/server value)
// so this reads correctly wherever the person actually is, not wherever
// the backend happens to run.
export function timeOfDayGreeting(date: Date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

// "Chandraprakash Admin" -> "Chandraprakash" — a greeting using someone's
// full name (incl. a surname that's actually just a role label in this
// app's seed data, e.g. "Admin"/"Client A") reads oddly formal/wrong.
export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || fullName;
}
