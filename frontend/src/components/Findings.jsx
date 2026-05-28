// Renders structured flag findings. Each finding has:
//   { rule_id, severity, message, field?, observed?, threshold? }
// Groups by rule_id so a row that trips the same rule twice doesn't repeat
// the header. Severity drives the color band.

const SEVERITY_CLASS = {
  error: "danger",
  warning: "warn",
  info: "info",
};

const RULE_TITLES = {
  // Validators
  no_emission_factor: "No emission factor matched",
  value_out_of_range: "Value out of plausible range",
  period_inverted: "Period end before start",
  period_too_long: "Period spans too long",
  duplicate_period: "Possible duplicate (overlapping period)",
  future_date: "Period in the future",
  validator_internal_error: "Validator error",
  // Pipeline / lookup
  unmapped_plant_code: "Unmapped SAP plant code",
  // Parsers — SAP
  activity_inference_failed: "Activity type not inferred",
  // Parsers — utility
  period_atypical: "Atypical billing period length",
  negative_consumption: "Negative consumption",
  estimated_reading: "Estimated reading (not physically read)",
  // Parsers — travel
  cabin_class_unknown: "Unknown cabin class",
  hotel_country_missing: "Hotel country missing",
};

export function ruleTitle(ruleId) {
  return RULE_TITLES[ruleId] || ruleId;
}

export default function Findings({ findings, compact = false }) {
  if (!findings || findings.length === 0) return null;

  // Group by rule_id, preserve insertion order
  const groups = new Map();
  for (const f of findings) {
    const arr = groups.get(f.rule_id) || [];
    arr.push(f);
    groups.set(f.rule_id, arr);
  }

  if (compact) {
    // Used in the review-table row — single line per rule with count
    return (
      <div>
        {[...groups.entries()].map(([ruleId, fs]) => (
          <span key={ruleId} className={`flag-reason sev-${SEVERITY_CLASS[fs[0].severity] || "warn"}`}>
            ⚑ {fs[0].message}{fs.length > 1 ? ` (×${fs.length})` : ""}
          </span>
        ))}
      </div>
    );
  }

  return (
    <ul className="findings-list">
      {[...groups.entries()].map(([ruleId, fs]) => (
        <li key={ruleId} className={`finding sev-${SEVERITY_CLASS[fs[0].severity] || "warn"}`}>
          <div className="finding-head">
            <span className={`pill ${fs[0].severity === "error" ? "failed" : "flagged"}`}>
              {fs[0].severity}
            </span>
            <strong>{ruleTitle(ruleId)}</strong>
            <span className="mono muted" style={{ fontSize: 11 }}>{ruleId}</span>
          </div>
          {fs.map((f, i) => (
            <div key={i} className="finding-body">
              {f.message}
              {(f.observed !== undefined || f.threshold !== undefined) && (
                <div className="muted mono" style={{ fontSize: 11, marginTop: 2 }}>
                  {f.field && <>field={f.field}{" "}</>}
                  {f.observed !== undefined && <>observed={String(f.observed)}{" "}</>}
                  {f.threshold !== undefined && <>threshold={String(f.threshold)}</>}
                </div>
              )}
            </div>
          ))}
        </li>
      ))}
    </ul>
  );
}
