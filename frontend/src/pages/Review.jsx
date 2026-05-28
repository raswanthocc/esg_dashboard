import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import RecordRow from "../components/RecordRow.jsx";

const STATUSES = [
  { value: "", label: "Any status" },
  { value: "pending", label: "Pending" },
  { value: "flagged", label: "Flagged" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];
const SCOPES = [
  { value: "", label: "Any scope" },
  { value: "scope_1", label: "Scope 1" },
  { value: "scope_2", label: "Scope 2" },
  { value: "scope_3", label: "Scope 3" },
];
const SOURCES = [
  { value: "", label: "Any source" },
  { value: "sap_fuel", label: "SAP fuel" },
  { value: "utility_electricity", label: "Utility electricity" },
  { value: "travel_concur", label: "Travel" },
];

export default function Review({ onToast }) {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);

  const filters = useMemo(() => ({
    source_type: params.get("source_type") || "",
    scope: params.get("scope") || "",
    status: params.get("status") || "",
    q: params.get("q") || "",
  }), [params]);

  const load = useCallback(async () => {
    const apiParams = Object.fromEntries(
      Object.entries(filters).filter(([_, v]) => v)
    );
    try {
      const res = await api.records({ ...apiParams, limit: 200 });
      setData(res);
    } catch (e) {
      onToast("error", e.message);
    }
  }, [filters, onToast]);

  useEffect(() => { load(); }, [load]);

  const setFilter = (k, v) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    setParams(next);
  };

  const bulkApprove = async () => {
    if (!confirm("Approve all clean (pending) rows in the current filter scope?")) return;
    setBusy(true);
    try {
      const res = await api.bulkApprove(null);
      onToast("ok", `Approved ${res.approved} rows.`);
      load();
    } catch (e) { onToast("error", e.message); }
    setBusy(false);
  };

  return (
    <div>
      <div className="filter-bar">
        <label>Source
          <select value={filters.source_type} onChange={(e) => setFilter("source_type", e.target.value)}>
            {SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
        <label>Scope
          <select value={filters.scope} onChange={(e) => setFilter("scope", e.target.value)}>
            {SCOPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
        <label>Status
          <select value={filters.status} onChange={(e) => setFilter("status", e.target.value)}>
            {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
        <label>Search
          <input
            placeholder="site, description…"
            defaultValue={filters.q}
            onBlur={(e) => setFilter("q", e.target.value)}
          />
        </label>
        <div className="spacer" style={{ flex: 1 }} />
        <button className="primary" disabled={busy} onClick={bulkApprove}>
          Bulk-approve clean rows
        </button>
      </div>

      {data?.results?.length ? (
        <>
          <div className="muted mb-12">{data.total} records · showing {data.results.length}</div>
          <table className="records">
            <thead>
              <tr>
                <th>ID</th>
                <th>Scope</th>
                <th>Activity</th>
                <th>Site / Description</th>
                <th>Period</th>
                <th>Normalized</th>
                <th>CO₂e</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.results.map((r) => <RecordRow key={r.id} r={r} />)}
            </tbody>
          </table>
        </>
      ) : (
        <div className="empty">No records match these filters.</div>
      )}
    </div>
  );
}
