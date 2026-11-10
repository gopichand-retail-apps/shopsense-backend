import { mapApiError } from './errors.mjs';
import { sendOutcome } from './json.mjs';
import {
  resolveRequestId,
  resolveTraceId,
  routeTemplate,
  setSecurityHeaders,
} from './request-metadata.mjs';
import { writeLog } from '../observability/logging.mjs';
import { routeApiRequest } from './api-router.mjs';
import { APP_VERSION } from '../app-version.mjs';

export async function handleApiRequest(context) {
  const startedAt = performance.now();
  const requestId = resolveRequestId(context.request.headers['x-request-id']);
  const traceId = resolveTraceId(context.request.headers.traceparent);
  const origin = context.request.headers.origin;
  const pathname = new URL(context.request.url ?? '/', 'http://127.0.0.1')
    .pathname;
  const loggedRouteTemplate = routeTemplate(pathname);
  setSecurityHeaders(context.response, requestId, traceId);

  let outcome;
  try {
    outcome = await routeApiRequest({
      ...context,
      origin,
      requestId,
      traceId,
      pathname,
    });
  } catch (error) {
    outcome = mapApiError(error, context.model, requestId);
  }
  sendOutcome(context.response, outcome);
  logRequest(context, outcome, {
    requestId,
    traceId,
    loggedRouteTemplate,
    startedAt,
  });
}

function logRequest(context, outcome, metadata) {
  const failed = outcome.status >= 400;
  writeLog({
    level: outcome.status >= 500 ? 'ERROR' : failed ? 'WARN' : 'INFO',
    service: 'shopsense-api',
    environment: process.env.NODE_ENV ?? 'development',
    version: APP_VERSION,
    requestId: metadata.requestId,
    method: context.request.method,
    routeTemplate: metadata.loggedRouteTemplate,
    status: outcome.status,
    durationMs: Math.round(performance.now() - metadata.startedAt),
    outcome: failed ? 'failure' : 'success',
    traceId: metadata.traceId,
    ...(outcome.errorCode ? { errorCode: outcome.errorCode } : {}),
    eventName: failed ? 'api.request.failed' : 'api.request.completed',
  });
}
