import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import StatusPill, { ScopePill } from "../components/StatusPill.jsx";
import Findings from "../components/Findings.jsx";

function fmt(n, frac = 4) {
  if (n === null || n === undefined || n === "") return "—";
  const num = Number(n);
  if (Number.isNaN(num)) return n;
  return num.toLocaleString("en-US", { maximumFractionDigits: frac });
}

function CalcBox({ record }) {
  const f = record.emission_factor;
  const mult = Number(record.compute_multiplier || 1);
  const co2e = record.co2e_kg;

  if (co2e === null || co2e === undefined) {
    return (
      <div className="calc-box">
        <span className="muted">CO₂e could not be computed — no emission factor matched.</span>
      </div>
    );
  }

  return (
    <div className="calc-box">
      <div>
        <span className="label">CO₂e calculation</span>
        <span className={`strategy-badge ${record.factor_match_strategy}`}>
          {record.factor_match_strategy_display || record.factor_match_strategy}
        </span>
      </div>
      <div style={{ marginTop: 8 }}>
        {fmt(record.normalized_value)} {record.normalized_unit}
        <span className="op">×</span>
        {f ? `${fmt(f.kg_co2e_per_unit, 6)} kg/${f.unit}` : "?"}
        {mult !== 1 && (
          <>
            <span className="op">×</span>
            {fmt(mult, 2)} <span className="label">(cabin multiplier)</span>
          </>
        )}
        <span className="op">=</span>
        <span className="total">{fmt(co2e, 2)} kg CO₂e</span>
      </div>
      {f && (
        <div className="label" style={{ marginTop: 6 }}>
          Factor: {f.source} · region {f.region} · valid {f.valid_year}
        </div>
      )}
    </div>
  );
}

export default function RecordDetail({ onToast }) {
  const { id } = useParams();
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [edit, setEdit] = useState({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.record(id);
      setData(res);
      setEdit({});
    } catch (e) { onToast("error", e.message); }
  }, [id, onToast]);

  useEffect(() => { load(); }, [load]);

  if (!data) return <div className="empty">Loading…</div>;

  const r = data.record;
  const locked = r.is_locked;

  const saveEdits = async (clearFlags = false) => {
    if (Object.keys(edit).length === 0) {
      onToast("error", "No edits to save.");
      return;
    }
    setBusy(true);
    try {
      await api.patchRecord(id, edit, clearFlags);
      onToast("ok", "Saved.");
      load();
    } catch (e) { onToast("error", e.message); }
    setBusy(false);
  };

  const approve = async () => {
    setBusy(true);
    try {
      await api.approveRecord(id);
      onToast("ok", "Approved and locked.");
      load();
    } catch (e) { onToast("error", e.message); }
    setBusy(false);
  };

  const reject = async () => {
    const note = prompt("Why are you rejecting this record?");
    if (note === null) return;
    setBusy(true);
    try {
      await api.rejectRecord(id, note);
      onToast("ok", "Rejected.");
      load();
    } catch (e) { onToast("error", e.message); }
    setBusy(false);
  };

  return (
    <div>
      <div className="row gap-16 mb-12">
        <button onClick={() => nav(-1)}>← Back</button>
        <h2 style={{ margin: 0 }}>Record #{r.id}</h2>
        <StatusPill status={r.status} />
        <ScopePill scope={r.scope} />
        <div className="spacer" style={{ flex: 1 }} />
        {!locked && (
          <>
            <button className="danger" disabled={busy} onClick={reject}>Reject</button>
            <button className="primary" disabled={busy} onClick={approve}>Approve & lock</button>
          </>
        )}
      </div>

      {r.flag_reasons.length > 0 && (
        <div className="card mb-12">
          <h3 style={{ marginTop: 0 }}>
            Findings ({r.flag_reasons.length})
          </h3>
          <Findings findings={r.flag_reasons} />
          {!locked && (
            <button onClick={() => saveEdits(true)} disabled={busy} style={{ marginTop: 8 }}>
              Clear findings (after editing)
            </button>
          )}
        </div>
      )}

      <div className="card mb-12">
        <h3 style={{ marginTop: 0 }}>Normalized (canonical)</h3>
        <dl className="detail-grid">
          <dt>Activity type</dt>
          <dd>
            {locked ? (r.activity_type_display) : (
              <input
                defaultValue={r.activity_type}
                onChange={(e) => setEdit({ ...edit, activity_type: e.target.value })}
              />
            )}
          </dd>
          <dt>Scope</dt>
          <dd>
            {locked ? (r.scope_display) : (
              <select
                defaultValue={r.scope}
                onChange={(e) => setEdit({ ...edit, scope: e.target.value })}
              >
                <option value="scope_1">Scope 1</option>
                <option value="scope_2">Scope 2</option>
                <option value="scope_3">Scope 3</option>
              </select>
            )}
          </dd>
          <dt>Period</dt>
          <dd>
            {locked ? `${r.period_start} → ${r.period_end}` : (
              <>
                <input type="date" defaultValue={r.period_start}
                  onChange={(e) => setEdit({ ...edit, period_start: e.target.value })} />
                {" → "}
                <input type="date" defaultValue={r.period_end}
                  onChange={(e) => setEdit({ ...edit, period_end: e.target.value })} />
              </>
            )}
          </dd>
          <dt>Original value</dt>
          <dd>{fmt(r.original_value)} {r.original_unit}</dd>
          <dt>Normalized value</dt>
          <dd>
            {locked ? `${fmt(r.normalized_value)} ${r.normalized_unit}` : (
              <>
                <input defaultValue={r.normalized_value} style={{ width: 140 }}
                  onChange={(e) => setEdit({ ...edit, normalized_value: e.target.value })} />
                {" "}{r.normalized_unit}
              </>
            )}
          </dd>
          <dt>Site</dt>
          <dd>
            {locked ? (r.site_name || "—") : (
              <input defaultValue={r.site_name}
                onChange={(e) => setEdit({ ...edit, site_name: e.target.value })} />
            )}
          </dd>
          <dt>Country</dt>
          <dd>{r.country || "—"}</dd>
        </dl>
        {!locked && Object.keys(edit).length > 0 && (
          <div className="mt-12">
            <button className="primary" disabled={busy} onClick={() => saveEdits(false)}>
              Save edits
            </button>
          </div>
        )}
      </div>

      <div className="card mb-12">
        <h3 style={{ marginTop: 0 }}>How the CO₂e was computed</h3>
        <CalcBox record={r} />
        <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          The match strategy shows whether we hit the exact country+year factor,
          fell back within the country, or used the GLOBAL average. An auditor
          should be able to verify this number from the formula above without
          any system access.
        </div>
      </div>

      <div className="card mb-12">
        <h3 style={{ marginTop: 0 }}>Original source row</h3>
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
          Row {r.raw_record.source_row_number} from the uploaded file. Immutable.
        </div>
        <pre className="raw-payload">{JSON.stringify(r.raw_record.payload, null, 2)}</pre>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Audit trail</h3>
        <ul className="audit-list">
          {data.audit.map((ev) => (
            <li key={ev.id} className={ev.action}>
              <strong>{ev.action_display}</strong> by {ev.actor_label}{" "}
              <span className="muted">{new Date(ev.created_at).toLocaleString()}</span>
              {ev.note && <div>{ev.note}</div>}
              {Object.keys(ev.before || {}).length > 0 && (
                <details>
                  <summary>before/after</summary>
                  <pre className="mono">{JSON.stringify({ before: ev.before, after: ev.after }, null, 2)}</pre>
                </details>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
