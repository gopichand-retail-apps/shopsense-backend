export function createRateLimiter({ limit, windowMs, now = Date.now }) {
  if (!Number.isInteger(limit) || limit < 1)
    throw new RangeError('limit must be a positive integer');
  if (!Number.isInteger(windowMs) || windowMs < 1)
    throw new RangeError('windowMs must be a positive integer');

  const windows = new Map();
  return function consume(key) {
    const timestamp = now();
    let window = windows.get(key);
    if (!window || timestamp >= window.resetAt) {
      window = { count: 0, resetAt: timestamp + windowMs };
      windows.set(key, window);
    }

    window.count += 1;
    if (windows.size > 10_000) {
      for (const [candidate, value] of windows) {
        if (timestamp >= value.resetAt) windows.delete(candidate);
      }
    }

    return {
      allowed: window.count <= limit,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((window.resetAt - timestamp) / 1000),
      ),
    };
  };
}
