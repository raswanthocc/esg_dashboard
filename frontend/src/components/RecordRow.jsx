import { Link } from "react-router-dom";
import StatusPill, { ScopePill } from "./StatusPill.jsx";
import Findings from "./Findings.jsx";

// Locale forced to en-US so number grouping is consistent regardless of the
// reviewer's browser locale. Indian lakh-grouping (14,80,000) on an ESG
// report reads as half-finished to non-IN reviewers.
function fmtNum(n) {
  if (n === null || n === undefined) return "—";
  const num = Number(n);
  if (Number.isNaN(num)) return n;
  return num.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export default function RecordRow({ r }) {
  return (
    <tr>
      <td><Link to={`/review/${r.id}`}>#{r.id}</Link></td>
      <td><ScopePill scope={r.scope} /></td>
      <td>{r.activity_type_display}</td>
      <td>
        {r.site_name || <span className="muted">—</span>}
        {r.description && (
          <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
            {r.description}
          </div>
        )}
      </td>
      <td>{r.period_start} → {r.period_end}</td>
      <td className="num">
        {fmtNum(r.normalized_value)} {r.normalized_unit}
        {String(r.normalized_value) !== String(r.original_value) && (
          <div className="muted" style={{ fontSize: 11 }}>
            was {fmtNum(r.original_value)} {r.original_unit}
          </div>
        )}
      </td>
      <td className="num">
        {r.co2e_kg !== null ? `${fmtNum(r.co2e_kg)} kg` : "—"}
      </td>
      <td>
        <StatusPill status={r.status} />
        <Findings findings={r.flag_reasons} compact />
      </td>
    </tr>
  );
}
