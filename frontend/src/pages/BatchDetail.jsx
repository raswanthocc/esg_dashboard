import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import RecordRow from "../components/RecordRow.jsx";

export default function BatchDetail({ onToast }) {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setData(await api.batch(id)); }
    catch (e) { onToast("error", e.message); }
  }, [id, onToast]);

  useEffect(() => { load(); }, [load]);

  if (!data) return <div className="empty">Loading…</div>;
  const { batch, records, failed_raw_rows } = data;

  const bulkApprove = async () => {
    if (!confirm(`Approve every clean (pending) row in batch #${batch.id}?`)) return;
    setBusy(true);
    try {
      const res = await api.bulkApprove(batch.id);
      onToast("ok", `Approved ${res.approved} rows.`);
      load();
    } catch (e) { onToast("error", e.message); }
    setBusy(false);
  };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>
        Batch #{batch.id} · {batch.source_type_display}
      </h2>
      <div className="card mb-12">
        <dl className="detail-grid">
          <dt>File</dt><dd className="mono">{batch.original_filename}</dd>
          <dt>Uploaded</dt><dd>{new Date(batch.created_at).toLocaleString()}</dd>
          <dt>Status</dt><dd>{batch.status}</dd>
          <dt>Rows</dt>
          <dd>
            {batch.row_count_raw} total · {batch.row_count_normalized} normalized ·{" "}
            <span style={{ color: "var(--warn)" }}>{batch.row_count_flagged} flagged</span> ·{" "}
            <span style={{ color: "var(--danger)" }}>{batch.row_count_failed} failed</span>
          </dd>
          <dt>SHA-256</dt><dd className="mono" style={{ fontSize: 11 }}>{batch.file_sha256}</dd>
        </dl>
        <details className="mt-12">
          <summary className="muted">Parser notes</summary>
          <pre className="raw-payload">{JSON.stringify(batch.parser_notes, null, 2)}</pre>
        </details>
      </div>

      <div className="row mb-12">
        <h3 style={{ margin: 0 }}>Normalized records ({records.length})</h3>
        <div className="spacer" style={{ flex: 1 }} />
        <button className="primary" disabled={busy} onClick={bulkApprove}>
          Bulk-approve clean rows in this batch
        </button>
      </div>

      <table className="records">
        <thead>
          <tr>
            <th>ID</th><th>Scope</th><th>Activity</th><th>Site / Description</th>
            <th>Period</th><th>Normalized</th><th>CO₂e</th><th>Status</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r) => <RecordRow key={r.id} r={r} />)}
        </tbody>
      </table>

      {failed_raw_rows.length > 0 && (
        <>
          <h3 className="mt-12" style={{ color: "var(--danger)" }}>
            Failed rows ({failed_raw_rows.length})
          </h3>
          <table className="records">
            <thead>
              <tr><th>Source row #</th><th>Parse error</th><th>Payload</th></tr>
            </thead>
            <tbody>
              {failed_raw_rows.map((f) => (
                <tr key={f.id}>
                  <td>{f.source_row_number}</td>
                  <td style={{ color: "var(--danger)" }}>{f.parse_error}</td>
                  <td className="mono" style={{ fontSize: 11 }}>{JSON.stringify(f.payload)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
