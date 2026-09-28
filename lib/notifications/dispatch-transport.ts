import 'server-only';
import webpush from 'web-push';
import { sendEmailAlert, sendWebPush, type NotificationConfig, type TransportDependencies } from '@/supabase/functions/_shared/notification-transport';
import type { StartedDispatch } from './dispatch-worker';

// User-supplied subscriptions must not turn the service worker into an arbitrary
// HTTPS proxy. Deliberately excludes custom gateways until separately reviewed.
export function supportedPushEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'].includes(url.hostname);
  } catch { return false; }
}

export function notificationTransport(config: NotificationConfig, fetcher: typeof fetch = fetch) {
  const dependencies: TransportDependencies = {
    fetch: fetcher,
    buildPushRequest(subscription, payload, options) {
      const request = webpush.generateRequestDetails(subscription, payload, options);
      return { endpoint: request.endpoint, headers: request.headers, body: new Uint8Array(request.body ?? []) };
    },
  };
  return async (input: StartedDispatch) => {
    if (input.channel === 'email') return sendEmailAlert(input.email, config, dependencies);
    if (!supportedPushEndpoint(input.subscription.endpoint)) {
      return { channel: 'push', state: 'not_attempted', code: 'invalid_subscription' } as const;
    }
    return sendWebPush(input.subscription, config, dependencies);
  };
}
