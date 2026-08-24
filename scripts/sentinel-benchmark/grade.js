/**
 * Grading state machine — maps a test's ground truth + observed signal to the
 * Sentinel result classification (PASS / PARTIAL / FAIL / FALSE_POSITIVE /
 * FALSE_NEGATIVE) per the spec's definitions.
 *
 * All positive-case test images in this benchmark are synthetically derived
 * FROM the protected original, so ground truth for "is this genuinely
 * related" is always known — a positive test that isn't detected is
 * classified FALSE_NEGATIVE (a known-true relationship was missed), not the
 * more ambiguous FAIL. FAIL is reserved for cases with no known ground truth
 * (not produced by this controlled harness, but kept for future real-world
 * corpus tests where ground truth may be uncertain).
 */

const CONFIDENCE_BANDS = [
  { min: 95, label: 'Very strong evidence (95-100%)' },
  { min: 85, label: 'Strong evidence (85-94%)' },
  { min: 70, label: 'Probable (70-84%)' },
  { min: 50, label: 'Weak / requires investigation (50-69%)' },
  { min: -Infinity, label: 'Insufficient evidence (<50%)' },
];

function confidenceBand(pct) {
  if (pct == null) return 'n/a';
  return CONFIDENCE_BANDS.find((b) => pct >= b.min).label;
}

/**
 * @param {object} signal
 * @param {boolean} signal.sourceExpected - true for positive tests (derived from the
 *   protected asset), false for negative controls (should find nothing).
 * @param {boolean} signal.sourceDetected - did the report establish a relationship to
 *   the protected asset at all (owner match, fragment-reuse match, etc.)?
 * @param {number|null} signal.signalConfidence - confidence (0-100) for the specific
 *   manipulation being tested (e.g. the "Crop" detector's confidence), or null if no
 *   such specific signal exists in the report even though the source was found.
 * @param {number} signal.targetConfidencePct - the PASS threshold from the spec table.
 */
function grade({ sourceExpected, sourceDetected, signalConfidence, targetConfidencePct }) {
  if (!sourceExpected) {
    return {
      result: sourceDetected ? 'FALSE_POSITIVE' : 'PASS',
      reason: sourceDetected
        ? 'Claimed a relationship to the protected asset where none exists'
        : 'Correctly found no relationship to any protected asset',
    };
  }

  if (!sourceDetected) {
    return { result: 'FALSE_NEGATIVE', reason: 'A genuine protected-asset relationship was not identified' };
  }

  if (signalConfidence == null) {
    return { result: 'PARTIAL', reason: 'Source identified, but no specific manipulation signal was reported' };
  }

  if (signalConfidence >= targetConfidencePct) {
    return { result: 'PASS', reason: `Signal confidence ${signalConfidence}% met target ${targetConfidencePct}%` };
  }

  return {
    result: 'PARTIAL',
    reason: `Source identified; manipulation confidence ${signalConfidence}% below target ${targetConfidencePct}%`,
  };
}

module.exports = { grade, confidenceBand, CONFIDENCE_BANDS };
