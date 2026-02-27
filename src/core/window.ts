export type WindowRange = {
  start: Date;
  end: Date;
};

export function computeWindowRange(
  windowMinutes: number,
  reference: Date = new Date()
): WindowRange {
  const end = new Date(reference);
  const start = new Date(end.getTime() - windowMinutes * 60 * 1000);
  return { start, end };
}

export function isWithinWindow(target: Date, window: WindowRange): boolean {
  return target >= window.start && target <= window.end;
}
