/**
 * Alert Toast -- Utility Function
 *
 * Shows a toast notification when a new alert arrives via Realtime.
 * Uses sonner's toast.error for critical, toast.warning for warning.
 *
 * Requirements: DASH-08 (real-time alert notification)
 */

import { toast } from 'sonner';
import { FLAG_LABELS } from '@/lib/dashboard/constants';
import type { AlertFlag, AlertSeverity } from '@/lib/dashboard/types';

interface AlertToastData {
  flags: string[];
  severity: string;
  patient_id: string;
}

export function showAlertToast(alert: AlertToastData): void {
  const flagLabels = alert.flags
    .map((f) => FLAG_LABELS[f as AlertFlag] || f)
    .join(', ');

  const severity = alert.severity as AlertSeverity;

  if (severity === 'critical') {
    toast.error('New Patient Alert', {
      description: flagLabels,
      action: {
        label: 'View',
        onClick: () => {
          window.location.href = '/alerts';
        },
      },
      duration: 10000,
    });
  } else {
    toast.warning('New Patient Alert', {
      description: flagLabels,
      action: {
        label: 'View',
        onClick: () => {
          window.location.href = '/alerts';
        },
      },
      duration: 5000,
    });
  }
}
