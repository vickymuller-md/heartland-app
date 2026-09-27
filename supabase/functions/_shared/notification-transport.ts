/** Runtime-neutral transport. Results describe HTTP acceptance, never delivery or care. */
export interface PushSubscription {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

export interface NotificationConfig {
  vapidPublicKey?: string
  vapidPrivateKey?: string
  resendApiKey?: string
  appUrl?: string
}

export interface TransportDependencies {
  fetch: typeof fetch
  buildPushRequest: (subscription: PushSubscription, payload: string, options: {
    vapidDetails: { subject: string; publicKey: string; privateKey: string }
    TTL: number
    urgency: 'high'
    contentEncoding: 'aes128gcm'
  }) => { endpoint: string; headers: HeadersInit; body: Uint8Array<ArrayBuffer> }
}

export interface TransportResult {
  channel: 'push' | 'email'
  state: 'accepted' | 'rejected' | 'unknown' | 'not_attempted'
  code: 'accepted' | 'credentials_rejected' | 'subscription_expired' | 'rate_limited'
    | 'http_rejected' | 'redirect_unconfirmed' | 'request_timeout' | 'server_error'
    | 'timeout' | 'network_error' | 'missing_credentials' | 'missing_recipient'
    | 'invalid_app_url' | 'invalid_subscription' | 'payload_failed'
  httpStatus?: number
}

function httpsUrl(value: string): URL | null {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password ? url : null
  } catch {
    return null
  }
}

function classify(channel: TransportResult['channel'], status: number): TransportResult {
  const httpStatus = status
  if (status >= 200 && status < 300) return { channel, state: 'accepted', code: 'accepted', httpStatus }
  // A server may have processed a POST before returning an error. Do not replay it blindly.
  if (status >= 500) return { channel, state: 'unknown', code: 'server_error', httpStatus }
  if (status === 408) return { channel, state: 'unknown', code: 'request_timeout', httpStatus }
  // A redirect (notably 303) can refer to the result of an already applied POST.
  if (status >= 300 && status < 400) return { channel, state: 'unknown', code: 'redirect_unconfirmed', httpStatus }
  const code = status === 401 || status === 403 ? 'credentials_rejected'
    : channel === 'push' && (status === 404 || status === 410) ? 'subscription_expired'
    : status === 429 ? 'rate_limited' : 'http_rejected'
  return { channel, state: 'rejected', code, httpStatus }
}

async function post(
  channel: TransportResult['channel'], endpoint: string, request: RequestInit,
  fetcher: typeof fetch,
): Promise<TransportResult> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  // This is a transport deadline, not a clinical response-time guarantee.
  const deadline = new Promise<TransportResult>(resolve => {
    timer = setTimeout(() => {
      resolve({ channel, state: 'unknown', code: 'timeout' })
      controller.abort()
    }, 10_000)
  })
  const attempt = async (): Promise<TransportResult> => {
    try {
      const response = await fetcher(endpoint, {
        ...request, method: 'POST', redirect: 'manual', signal: controller.signal,
      })
      // Response bodies may contain identifiers; neither parse nor log them.
      void response.body?.cancel().catch(() => {})
      return classify(channel, response.status)
    } catch {
      return { channel, state: 'unknown', code: controller.signal.aborted ? 'timeout' : 'network_error' }
    }
  }
  try {
    // Also bounds adapters that fail to settle after abort. Late settlement never triggers a retry.
    return await Promise.race([attempt(), deadline])
  } finally {
    clearTimeout(timer)
  }
}

export async function sendWebPush(
  subscription: PushSubscription, config: NotificationConfig, deps: TransportDependencies,
): Promise<TransportResult> {
  const channel = 'push' as const
  if (!config.vapidPublicKey || !config.vapidPrivateKey) {
    return { channel, state: 'not_attempted', code: 'missing_credentials' }
  }
  if (!subscription || !httpsUrl(subscription.endpoint)
    || !subscription.keys?.p256dh || !subscription.keys?.auth) {
    return { channel, state: 'not_attempted', code: 'invalid_subscription' }
  }
  let request: ReturnType<TransportDependencies['buildPushRequest']>
  try {
    request = deps.buildPushRequest(subscription, JSON.stringify({
      title: 'HEARTLAND',
      body: 'A new update is available. Sign in to review it.',
      data: { url: '/alerts' },
    }), {
      vapidDetails: {
        subject: 'mailto:alerts@heartlandprotocol.org',
        publicKey: config.vapidPublicKey, privateKey: config.vapidPrivateKey,
      },
      TTL: 86400, urgency: 'high', contentEncoding: 'aes128gcm',
    })
  } catch {
    return { channel, state: 'not_attempted', code: 'payload_failed' }
  }
  return await post(channel, request.endpoint, { headers: request.headers, body: request.body }, deps.fetch)
}

export async function sendEmailAlert(
  providerEmail: string | null | undefined, config: NotificationConfig, deps: TransportDependencies,
): Promise<TransportResult> {
  const channel = 'email' as const
  if (!providerEmail?.trim()) return { channel, state: 'not_attempted', code: 'missing_recipient' }
  if (!config.resendApiKey) return { channel, state: 'not_attempted', code: 'missing_credentials' }
  const appUrl = httpsUrl(config.appUrl ?? 'https://app.heartlandprotocol.org')
  if (!appUrl) return { channel, state: 'not_attempted', code: 'invalid_app_url' }
  return await post(channel, 'https://api.resend.com/emails', {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.resendApiKey}` },
    body: JSON.stringify({
      from: 'HEARTLAND Alerts <alerts@heartlandprotocol.org>', to: [providerEmail],
      subject: 'HEARTLAND update',
      html: `<p>A new update is available. Sign in to review it.</p><p><a href="${appUrl.origin}/alerts">Open HEARTLAND</a></p>`,
    }),
  }, deps.fetch)
}

/** Fall back only when every push was definitely rejected or never attempted. */
export function shouldUseEmailFallback(results: TransportResult[]): boolean {
  return results.every(result => result.state === 'rejected' || result.state === 'not_attempted')
}
