/**
 * Track B: Patient Red Flag Instruction Card
 * Requirement: TRKB-05
 * Source: HEARTLAND Protocol v3.3 Module 5, Section 5.2
 *
 * Take-home card for Track B patients listing warning signs and
 * emergency criteria. Sources all thresholds from RED_FLAG_CRITERIA
 * constants (no hardcoded clinical values).
 *
 * All text text-lg minimum per VITL-08 elderly UX requirement.
 */

import { RED_FLAG_CRITERIA } from './constants';

export default function RedFlagCard() {
  const { weight_gain_3lb_2d, weight_gain_5lb_7d, sbp_low_symptomatic, spo2_low } =
    RED_FLAG_CRITERIA;

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-center">
        When to Call for Help
      </h2>

      {/* Warning section -- Call Clinic */}
      <div className="border-l-4 border-amber-500 bg-amber-50 rounded-r-lg p-4">
        <h3 className="text-lg font-bold text-amber-800 uppercase mb-3">
          Call Your Clinic the Same Day If:
        </h3>
        <ul className="list-disc list-inside space-y-2">
          <li className="text-lg text-amber-900">
            You gained <strong>{weight_gain_3lb_2d.threshold} lbs or more</strong> in{' '}
            <strong>{weight_gain_3lb_2d.windowDays} days</strong>
          </li>
        </ul>
      </div>

      {/* Critical section -- Call 911 / ER */}
      <div className="border-l-4 border-red-500 bg-red-50 rounded-r-lg p-4">
        <h3 className="text-lg font-bold text-red-800 uppercase mb-3">
          Call 911 or Go to the Emergency Room Immediately If:
        </h3>
        <ul className="list-disc list-inside space-y-2">
          <li className="text-lg text-red-900">
            You gained <strong>{weight_gain_5lb_7d.threshold} lbs or more</strong> in 1 week
          </li>
          <li className="text-lg text-red-900">
            Your blood pressure is below <strong>{sbp_low_symptomatic.threshold} mmHg</strong> (top
            number) with dizziness or shortness of breath
          </li>
          <li className="text-lg text-red-900">
            Your oxygen level is below <strong>{spo2_low.threshold}%</strong>
          </li>
          <li className="text-lg text-red-900">
            Severe shortness of breath at rest that does not improve
          </li>
        </ul>
      </div>

      <p className="text-sm italic text-gray-600 text-center">
        Keep this card near your telephone and daily diary.
      </p>
    </div>
  );
}
