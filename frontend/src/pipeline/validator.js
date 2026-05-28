const RANGES = {
  electricity: { lo: 0, hi: 5000000, unit: "kWh" },
  diesel: { lo: 0, hi: 100000, unit: "L" },
  petrol: { lo: 0, hi: 100000, unit: "L" },
  natural_gas: { lo: 0, hi: 1000000, unit: "L" },
  lpg: { lo: 0, hi: 5000, unit: "kg" },
  flight_short: { lo: 0, hi: 3000, unit: "pkm" },
  flight_medium: { lo: 0, hi: 5000, unit: "pkm" },
  flight_long: { lo: 0, hi: 20000, unit: "pkm" }
};

function createFinding(ruleId, message, severity = "warning", extra = {}) {
  return { rule_id: ruleId, severity, message, ...extra };
}

// 1. Missing emission factor check
function checkNoFactor(ar) {
  if (!ar.emission_factor) {
    return [createFinding(
      "no_emission_factor",
      `No emission factor matched for ${ar.activity_type}/${ar.normalized_unit}/${ar.country || "GLOBAL"} in ${new Date(ar.period_end).getFullYear()} — CO2e cannot be computed`,
      "error"
    )];
  }
  return [];
}

// 2. Out of range values check
function checkValueRange(ar) {
  const band = RANGES[ar.activity_type];
  if (!band) return [];

  const { lo, hi, unit } = band;
  if (ar.normalized_unit !== unit) return [];

  const findings = [];
  const val = ar.normalized_value;
  if (val < lo) {
    findings.push(createFinding(
      "value_out_of_range",
      `Value ${val}${unit} is below plausible minimum ${lo}${unit}`,
      "warning",
      { field: "normalized_value", observed: String(val), threshold: String(lo) }
    ));
  }
  if (val > hi) {
    findings.push(createFinding(
      "value_out_of_range",
      `Value ${val}${unit} exceeds plausible maximum ${hi}${unit} — unit mistake?`,
      "warning",
      { field: "normalized_value", observed: String(val), threshold: String(hi) }
    ));
  }
  return findings;
}

// 3. Period sanity check
function checkPeriodSanity(ar) {
  const start = new Date(ar.period_start);
  const end = new Date(ar.period_end);

  if (end < start) {
    return [createFinding(
      "period_inverted",
      "Period end is before start",
      "error",
      { field: "period_end" }
    )];
  }

  const diffTime = Math.abs(end - start);
  const days = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
  if (days > 366) {
    return [createFinding(
      "period_too_long",
      `Period spans ${days} days — multi-year is suspicious for a single row`,
      "warning",
      { field: "period_end", observed: days }
    )];
  }
  return [];
}

// 4. Duplicate period overlap check
function checkDuplicatePeriod(ar, existingRecords) {
  if (!existingRecords || existingRecords.length === 0) return [];

  const start = new Date(ar.period_start);
  const end = new Date(ar.period_end);

  const overlap = existingRecords.find(other => {
    // Exclude the record itself
    if (other.id === ar.id) return false;
    
    // Must match same organization and activity type
    if (other.organization !== ar.organization) return false;
    if (other.activity_type !== ar.activity_type) return false;

    // Must match either same site or description
    if (ar.site_name && other.site_name) {
      if (ar.site_name !== other.site_name) return false;
    } else if (ar.description && other.description) {
      if (ar.description !== other.description) return false;
    } else {
      return false; // Skip if neither has descriptors
    }

    // Must overlap periods: start1 <= end2 AND end1 >= start2
    const otherStart = new Date(other.period_start);
    const otherEnd = new Date(other.period_end);
    return start <= otherEnd && end >= otherStart;
  });

  if (overlap) {
    return [createFinding(
      "duplicate_period",
      `Possible duplicate — overlaps record #${overlap.id} (${overlap.period_start}–${overlap.period_end})`,
      "warning",
      { field: "period_start", observed: `record #${overlap.id}` }
    )];
  }
  return [];
}

// 5. Future date check
function checkFutureDate(ar) {
  const start = new Date(ar.period_start);
  const today = new Date();
  today.setHours(23, 59, 59, 999); // Set to end of today

  if (start > today) {
    return [createFinding(
      "future_date",
      "Period start is in the future",
      "warning",
      { field: "period_start" }
    )];
  }
  return [];
}

const RULES = [
  checkNoFactor,
  checkValueRange,
  checkPeriodSanity,
  checkDuplicatePeriod,
  checkFutureDate
];

export function validateRecord(ar, existingRecords) {
  // Start with any pre-existing parser-supplied findings
  const newFindings = [...(ar.flag_reasons || [])];
  
  for (const rule of RULES) {
    try {
      newFindings.push(...rule(ar, existingRecords));
    } catch (exc) {
      newFindings.push(createFinding(
        "validator_internal_error",
        `Validator crashed: ${exc.message}`,
        "error"
      ));
    }
  }

  ar.flag_reasons = newFindings;

  // Any error- or warning-severity finding moves the row to flagged.
  const hasBlocker = newFindings.some(f => ["warning", "error"].includes(f.severity));
  if (hasBlocker && ar.status === "pending") {
    ar.status = "flagged";
  }
  
  return ar;
}
