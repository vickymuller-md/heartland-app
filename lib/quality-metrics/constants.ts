/**
 * Quality Metrics -- Metric Definitions
 *
 * Derives numeric targets from QUALITY_METRICS (lib/tier-selector/constants).
 * DO NOT duplicate target strings -- parse from source of truth.
 * Source: HEARTLAND Protocol v3.3 Module 8, Section 8.1
 */

import { QUALITY_METRICS } from '@/lib/tier-selector/constants';
import type { MetricDefinition, MetricKey } from './types';

/**
 * The protocol table writes the targets as ">70%" and "<15%", but evaluateTarget
 * counts a rate exactly on the threshold as met (>= for higher-is-better, <= for
 * lower-is-better). Displaying the strict comparator would publish a metric that
 * differs from the one being computed, so the label is shown with the comparator
 * the code applies.
 */
function inclusiveTargetLabel(label: string): string {
  return label.replace('>', '≥').replace('<', '≤');
}

/**
 * Map position in QUALITY_METRICS array to MetricKey.
 * Order matches the protocol table (Section 8.1).
 */
export const METRIC_DEFINITIONS: MetricDefinition[] = [
  {
    key: 'contact_48_72h',
    label: QUALITY_METRICS[0].name,
    tier1Target: 70,
    tier1TargetLabel: inclusiveTargetLabel(QUALITY_METRICS[0].tier1Target),
    tier23Target: 90,
    tier23TargetLabel: inclusiveTargetLabel(QUALITY_METRICS[0].tier23Target),
    higherIsBetter: true,
  },
  {
    key: 'gdmt_discharge_rate',
    label: QUALITY_METRICS[1].name,
    tier1Target: 60,
    tier1TargetLabel: inclusiveTargetLabel(QUALITY_METRICS[1].tier1Target),
    tier23Target: 80,
    tier23TargetLabel: inclusiveTargetLabel(QUALITY_METRICS[1].tier23Target),
    higherIsBetter: true,
  },
  {
    key: 'followup_7day',
    label: QUALITY_METRICS[2].name,
    tier1Target: 60,
    tier1TargetLabel: inclusiveTargetLabel(QUALITY_METRICS[2].tier1Target),
    tier23Target: 85,
    tier23TargetLabel: inclusiveTargetLabel(QUALITY_METRICS[2].tier23Target),
    higherIsBetter: true,
  },
  {
    key: 'readmission_30day',
    label: QUALITY_METRICS[3].name,
    tier1Target: null,    // 'Improvement from baseline' -- no numeric threshold
    tier1TargetLabel: inclusiveTargetLabel(QUALITY_METRICS[3].tier1Target),
    tier23Target: 15,
    tier23TargetLabel: inclusiveTargetLabel(QUALITY_METRICS[3].tier23Target),
    higherIsBetter: false,
  },
  {
    key: 'teachback_documentation',
    label: QUALITY_METRICS[4].name,
    tier1Target: 70,
    tier1TargetLabel: inclusiveTargetLabel(QUALITY_METRICS[4].tier1Target),
    tier23Target: 90,
    tier23TargetLabel: inclusiveTargetLabel(QUALITY_METRICS[4].tier23Target),
    higherIsBetter: true,
  },
];

export type { MetricKey };
