import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";

function fmtKg(n) {
  if (n === null || n === undefined) return "—";
  const num = Number(n);
  const opts = { maximumFractionDigits: 1, minimumFractionDigits: 1 };
  if (num >= 1000) return `${(num / 1000).toLocaleString("en-US", opts)} t CO₂e`;
  return `${num.toLocaleString("en-US", opts)} kg CO₂e`;
}

const SCOPE_NAMES = {
  scope_1: "Scope 1 — Direct",
  scope_2: "Scope 2 — Purchased energy",
  scope_3: "Scope 3 — Value chain",
};

export default function Dashboard({ onToast }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    api.summary().then(setData).catch((e) =>
      onToast("error", `Could not load summary: ${e.message}`)
    );
  }, []);

  if (!data) return <div className="empty">Loading…</div>;

  const { totals, by_scope, by_source } = data;

  return (
    <div>
      <div className="summary-grid">
        <div className="card stat-card">
          <div className="label">Total CO₂e</div>
          <div className="value">{fmtKg(totals.co2e_kg)}</div>
          <div className="sub">{totals.records} records across all sources</div>
        </div>
        <div className="card stat-card">
          <div className="label">Pending review</div>
          <div className="value">{totals.pending}</div>
          <div className="sub">Clean rows awaiting approval</div>
        </div>
        <div className="card stat-card">
          <div className="label">Flagged</div>
          <div className="value" style={{ color: "var(--warn)" }}>{totals.flagged}</div>
          <div className="sub">Need analyst attention</div>
        </div>
        <div className="card stat-card">
          <div className="label">Approved (locked)</div>
          <div className="value" style={{ color: "var(--ok)" }}>{totals.approved}</div>
          <div className="sub">Audit-ready</div>
        </div>
      </div>

      <div className="section-title">By scope</div>
      <div className="summary-grid">
        {Object.entries(by_scope).map(([scope, val]) => (
          <div key={scope} className="card stat-card">
            <div className="label">{SCOPE_NAMES[scope]}</div>
            <div className="value">{fmtKg(val.co2e_kg)}</div>
            <div className="sub">{val.records} records</div>
          </div>
        ))}
      </div>

      <div className="section-title">By source</div>
      <table className="records">
        <thead>
          <tr>
            <th>Source</th>
            <th>Batches</th>
            <th>Records</th>
            <th>Pending</th>
            <th>Flagged</th>
            <th>CO₂e</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {by_source.map((s) => (
            <tr key={s.source_type}>
              <td>{s.source_type_display}</td>
              <td className="num">{s.batches}</td>
              <td className="num">{s.records}</td>
              <td className="num">{s.pending}</td>
              <td className="num" style={{ color: s.flagged ? "var(--warn)" : undefined }}>
                {s.flagged}
              </td>
              <td className="num">{fmtKg(s.co2e_kg)}</td>
              <td>
                <Link to={`/review?source_type=${s.source_type}`}>Review →</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
