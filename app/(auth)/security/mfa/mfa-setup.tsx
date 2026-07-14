'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, LockKeyhole, ShieldCheck } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Enrollment = {
  factorId: string;
  qrCode: string;
  secret: string;
};

export function MfaSetup() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [verifiedFactorId, setVerifiedFactorId] = useState<string | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [alreadyAal2, setAlreadyAal2] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      const supabase = createClient();
      const [assuranceResult, factorsResult] = await Promise.all([
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
        supabase.auth.mfa.listFactors(),
      ]);
      if (!active) return;
      if (assuranceResult.error || factorsResult.error) {
        setError('Security status could not be loaded. Sign out and try again.');
      } else {
        setAlreadyAal2(assuranceResult.data.currentLevel === 'aal2');
        setVerifiedFactorId(factorsResult.data.totp[0]?.id ?? null);
      }
      setLoading(false);
    }
    void load();
    return () => { active = false; };
  }, []);

  async function startEnrollment() {
    setSubmitting(true);
    setError(null);
    const supabase = createClient();
    const factors = await supabase.auth.mfa.listFactors();
    const staleFactor = factors.data?.all.find(
      (factor) => factor.factor_type === 'totp' && factor.status === 'unverified',
    );
    if (staleFactor) await supabase.auth.mfa.unenroll({ factorId: staleFactor.id });

    const { data, error: enrollError } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: 'HEARTLAND provider workspace',
      issuer: 'HEARTLAND',
    });
    if (enrollError) {
      setError('Authenticator enrollment could not be started.');
    } else {
      setEnrollment({
        factorId: data.id,
        qrCode: data.totp.qr_code,
        secret: data.totp.secret,
      });
    }
    setSubmitting(false);
  }

  async function verify() {
    const factorId = enrollment?.factorId ?? verifiedFactorId;
    if (!factorId || !/^\d{6}$/.test(code)) {
      setError('Enter the six-digit code from your authenticator app.');
      return;
    }
    setSubmitting(true);
    setError(null);
    const supabase = createClient();
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
      factorId,
      code,
    });
    if (verifyError) {
      setError('The code could not be verified. Check the current code and try again.');
      setSubmitting(false);
      return;
    }
    router.replace('/dashboard');
    router.refresh();
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="mb-2 flex size-11 items-center justify-center rounded-full bg-blue-100 text-blue-800">
          <LockKeyhole className="size-5" aria-hidden="true" />
        </div>
        <CardTitle>Provider multi-factor authentication</CardTitle>
        <CardDescription>
          Clinical work requires a fresh password session plus a time-based authenticator code.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-slate-600">
            <Loader2 className="size-4 animate-spin" /> Checking security status…
          </p>
        ) : alreadyAal2 ? (
          <div className="space-y-4">
            <p className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
              <ShieldCheck className="size-4" /> This session meets AAL2.
            </p>
            <Button className="w-full" onClick={() => router.replace('/dashboard')}>
              Continue to Daily Loop
            </Button>
          </div>
        ) : !verifiedFactorId && !enrollment ? (
          <div className="space-y-4">
            <p className="text-sm text-slate-700">
              Use Microsoft Authenticator, Google Authenticator, 1Password, or another TOTP app.
            </p>
            <Button className="w-full" disabled={submitting} onClick={startEnrollment}>
              {submitting ? 'Starting…' : 'Set up authenticator'}
            </Button>
          </div>
        ) : (
          <div className="space-y-5">
            {enrollment && (
              <div className="space-y-3 rounded-lg border bg-slate-50 p-4 text-center">
                {/* Supabase returns a same-origin-safe SVG data URI for this enrollment. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={enrollment.qrCode} alt="Authenticator enrollment QR code" className="mx-auto size-48" />
                <p className="text-xs text-slate-600">Cannot scan? Enter this secret manually:</p>
                <code className="block break-all rounded bg-white p-2 text-xs">{enrollment.secret}</code>
              </div>
            )}
            {!enrollment && (
              <p className="text-sm text-slate-700">
                Open the authenticator already enrolled for this account.
              </p>
            )}
            <div className="space-y-2">
              <Label htmlFor="mfa-code">Six-digit code</Label>
              <Input
                id="mfa-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              />
            </div>
            <Button className="w-full" disabled={submitting || code.length !== 6} onClick={verify}>
              {submitting ? 'Verifying…' : 'Verify and continue'}
            </Button>
          </div>
        )}

        {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        <p className="text-xs text-slate-500">
          HEARTLAND does not offer self-service factor removal. If the authenticator is lost, contact the security administrator for identity verification and session revocation.
        </p>
      </CardContent>
    </Card>
  );
}
