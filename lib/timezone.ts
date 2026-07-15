export const DEFAULT_TIME_ZONE = 'America/New_York';

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function partsInTimeZone(date: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  };
}

function offsetAt(date: Date, timeZone: string): number {
  const parts = partsInTimeZone(date, timeZone);
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  ) - date.getTime();
}

function localPartsToUtc(parts: Omit<ZonedParts, 'hour' | 'minute' | 'second'> & Partial<Pick<ZonedParts, 'hour' | 'minute' | 'second'>>, timeZone: string): Date {
  const wallClock = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0,
  );
  let utc = wallClock - offsetAt(new Date(wallClock), timeZone);
  // Re-evaluate once to cross daylight-saving transitions correctly.
  utc = wallClock - offsetAt(new Date(utc), timeZone);
  return new Date(utc);
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}

export function getZonedDayBounds(
  now: Date,
  requestedTimeZone: string,
): { start: Date; endExclusive: Date; timeZone: string } {
  const timeZone = isValidTimeZone(requestedTimeZone)
    ? requestedTimeZone
    : DEFAULT_TIME_ZONE;
  const current = partsInTimeZone(now, timeZone);
  const nextLocalDate = new Date(Date.UTC(current.year, current.month - 1, current.day + 1));
  return {
    start: localPartsToUtc({
      year: current.year,
      month: current.month,
      day: current.day,
    }, timeZone),
    endExclusive: localPartsToUtc({
      year: nextLocalDate.getUTCFullYear(),
      month: nextLocalDate.getUTCMonth() + 1,
      day: nextLocalDate.getUTCDate(),
    }, timeZone),
    timeZone,
  };
}

export function getDateKeyInTimeZone(now: Date, requestedTimeZone: string): string {
  const timeZone = isValidTimeZone(requestedTimeZone) ? requestedTimeZone : DEFAULT_TIME_ZONE;
  const parts = partsInTimeZone(now, timeZone);
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export function addZonedDays(now: Date, days: number, requestedTimeZone: string): Date {
  const timeZone = isValidTimeZone(requestedTimeZone) ? requestedTimeZone : DEFAULT_TIME_ZONE;
  const current = partsInTimeZone(now, timeZone);
  const target = new Date(Date.UTC(current.year, current.month - 1, current.day + days));
  return localPartsToUtc({
    year: target.getUTCFullYear(),
    month: target.getUTCMonth() + 1,
    day: target.getUTCDate(),
    hour: current.hour,
    minute: current.minute,
    second: current.second,
  }, timeZone);
}

export function formatInTimeZone(
  date: Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat('en-US', {
    ...options,
    timeZone: isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE,
  }).format(date);
}
