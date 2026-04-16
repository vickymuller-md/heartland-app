/**
 * GA4 event name constants and types.
 *
 * All custom events fired via trackEvent() are defined here.
 * GA4 automatic pageview tracking is handled by the GoogleAnalytics
 * component in the root layout.
 */

export const GA_EVENTS = {
  RISK_CALCULATOR_COMPLETED: 'risk_calculator_completed',
  GDMT_PATHWAY_USED: 'gdmt_pathway_used',
  TIER_SELECTOR_COMPLETED: 'tier_selector_completed',
  PATIENT_VITALS_LOGGED: 'patient_vitals_logged',
  ALERT_TRIGGERED: 'alert_triggered',
  LANDING_CTA_CLICKED: 'landing_cta_clicked',
  ACCESS_REQUEST_SUBMITTED: 'access_request_submitted',
} as const;

export type GAEventName = (typeof GA_EVENTS)[keyof typeof GA_EVENTS];

export type GAEventParams = Record<string, string | number>;
