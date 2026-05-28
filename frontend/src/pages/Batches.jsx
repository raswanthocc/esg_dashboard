import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";

export default function Batches({ onToast }) {
  const [batches, setBatches] = useState(null);

  useEffect(() => {
    api.batches().then(setBatches).catch((e) =>
      onToast("error", `Could not load batches: ${e.message}`)
    );
  }, []);

  if (!batches) return <div className="empty">Loading…</div>;
  if (!batches.length)
    return (
      <div className="empty">
        No uploads yet. Head to <Link to="/upload">Upload</Link>.
      </div>
    );

  return (
    <table className="records">
      <thead>
        <tr>
          <th>ID</th>
          <th>Source</th>
          <th>File</th>
          <th>Uploaded</th>
          <th>Rows</th>
          <th>Normalized</th>
          <th>Flagged</th>
          <th>Failed</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {batches.map((b) => (
          <tr key={b.id}>
            <td><Link to={`/batches/${b.id}`}>#{b.id}</Link></td>
            <td>{b.source_type_display}</td>
            <td className="mono">{b.original_filename}</td>
            <td>{new Date(b.created_at).toLocaleString()}</td>
            <td className="num">{b.row_count_raw}</td>
            <td className="num">{b.row_count_normalized}</td>
            <td className="num" style={{ color: b.row_count_flagged ? "var(--warn)" : undefined }}>
              {b.row_count_flagged}
            </td>
            <td className="num" style={{ color: b.row_count_failed ? "var(--danger)" : undefined }}>
              {b.row_count_failed}
            </td>
            <td><span className={`pill ${b.status === "parsed" ? "approved" : b.status === "failed" ? "failed" : "pending"}`}>{b.status}</span></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
