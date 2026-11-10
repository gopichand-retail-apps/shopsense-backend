import { randomUUID } from 'node:crypto';

const knownRoutes = new Set([
  '/api/v1/health',
    '/api/v1/version',
  '/api/v1/catalog',
  '/api/v1/search',
  '/api/v1/feedback',
]);

export function resolveRequestId(value) {
  if (typeof value === 'string' && /^[A-Za-z0-9._:-]{1,80}$/.test(value))
    return value;
  return randomUUID();
}

export function resolveTraceId(traceparent) {
  const match =
    typeof traceparent === 'string'
      ? /^00-([a-fA-F0-9]{32})-[a-fA-F0-9]{16}-[a-fA-F0-9]{2}$/.exec(
          traceparent,
        )
      : null;
  return match?.[1]?.toLowerCase() ?? randomUUID().replaceAll('-', '');
}

export function routeTemplate(pathname) {
  return knownRoutes.has(pathname) ? pathname : '/unmatched';
}

export function setSecurityHeaders(response, requestId, traceId) {
  response.setHeader('X-Request-ID', requestId);
  response.setHeader('X-Trace-ID', traceId);
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Vary', 'Origin');
}

export function setCorsHeaders(response, origin) {
  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, X-Request-ID, traceparent',
  );
  response.setHeader(
    'Access-Control-Expose-Headers',
    'X-Request-ID, X-Trace-ID',
  );
}
