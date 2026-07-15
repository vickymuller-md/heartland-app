'use client';

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <main style={{ maxWidth: 640, margin: '0 auto', padding: '64px 24px', fontFamily: 'system-ui' }}>
          <h1>HEARTLAND is temporarily unavailable</h1>
          <p>No clinical state should be inferred from this error. Follow your facility downtime and escalation workflow.</p>
          <button type="button" onClick={reset} style={{ minHeight: 44, padding: '8px 16px', fontWeight: 700 }}>Try again</button>
        </main>
      </body>
    </html>
  );
}
