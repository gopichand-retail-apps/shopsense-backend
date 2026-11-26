const MINUTE_MS = 60_000;

// A record older than the limit, or no record at all, is reported as unknown: never as in stock.
export function effectiveAvailability(row, { locationId, now, maxAgeMinutes }) {
  if (!row || row.state === 'unknown')
    return {
      locationId,
      state: 'unknown',
      confirmedAt: row?.confirmedAt ?? null,
      stale: false,
    };
  const stale =
    now.getTime() - Date.parse(row.confirmedAt) > maxAgeMinutes * MINUTE_MS;
  return {
    locationId,
    state: stale ? 'unknown' : row.state,
    confirmedAt: row.confirmedAt,
    stale,
  };
}

export function freshAfter(now, maxAgeMinutes) {
  return new Date(now.getTime() - maxAgeMinutes * MINUTE_MS).toISOString();
}

export function catalogFreshness({ status, now, maxAgeMinutes }) {
  let state = 'ready';
  if (status.offerCount === 0) state = 'empty';
  else if (status.watermark < freshAfter(now, maxAgeMinutes)) state = 'stale';
  return {
    state,
    asOf: status.offerCount === 0 ? null : status.watermark,
    generatedAt: now.toISOString(),
    maxAgeMinutes,
  };
}
