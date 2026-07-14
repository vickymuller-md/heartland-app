import { describe, expect, it } from 'vitest';
import {
  CLINICAL_RULE_REGISTRY,
  unapprovedClinicalRuleSets,
} from '@/lib/clinical-governance/rule-registry';

describe('clinical rule release governance', () => {
  it('registers every high-risk rule family with version, source, owner, and implementation', () => {
    const expected = [
      'heartland-risk-framework',
      'remote-monitoring-alerts',
      'gdmt-pathways',
      'titration-safety-gates',
      'discharge-followup',
      'ckm-classification',
    ];
    expect(CLINICAL_RULE_REGISTRY.map((ruleSet) => ruleSet.id)).toEqual(expected);
    for (const ruleSet of CLINICAL_RULE_REGISTRY) {
      expect(ruleSet.version).toBeTruthy();
      expect(ruleSet.source).toBeTruthy();
      expect(ruleSet.ownerRole).toBeTruthy();
      expect(ruleSet.implementation.length).toBeGreaterThan(0);
    }
  });

  it('fails closed until independent review is recorded', () => {
    expect(unapprovedClinicalRuleSets).toHaveLength(CLINICAL_RULE_REGISTRY.length);
    expect(CLINICAL_RULE_REGISTRY.every((ruleSet) => ruleSet.reviewStatus !== 'approved')).toBe(true);
  });
});
