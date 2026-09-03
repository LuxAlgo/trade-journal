export interface Routine {
  id: string;
  title: string;
  stage: string;
  weekdays: number[];
  createdAt: string;
  archivedAt: string | null;
}
export interface RoutineCheck {
  ruleId: string;
  date: string;
  done: boolean;
}
export function scheduledRules(rules: Routine[], date: string) {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return rules.filter(
    (r) =>
      r.createdAt.slice(0, 10) <= date &&
      (!r.archivedAt || date < r.archivedAt.slice(0, 10)) &&
      r.weekdays.includes(weekday),
  );
}
export function progressScore(rules: Routine[], checks: RoutineCheck[], date: string) {
  const scheduled = scheduledRules(rules, date);
  const completed = scheduled.filter((r) =>
    checks.some((c) => c.ruleId === r.id && c.date === date && c.done),
  ).length;
  return {
    total: scheduled.length,
    completed,
    score: scheduled.length ? completed / scheduled.length : null,
  };
}
