import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";

const SOURCES = [
  {
    value: "sap_fuel",
    label: "SAP — Fuel & Procurement",
    desc: "Flat-file export from SE16/SQVI. Semicolon-separated, German or English headers, decimal-comma supported.",
    hint: "Try sample_data/sap_fuel_q1_2025.csv",
  },
  {
    value: "utility_electricity",
    label: "Utility — Electricity",
    desc: "Portal CSV export. One row per meter per billing period. kWh or MWh accepted.",
    hint: "Try sample_data/utility_electricity_q1_2025.csv",
  },
  {
    value: "travel_concur",
    label: "Corporate Travel",
    desc: "Concur-style itinerary CSV. Flights (IATA codes), hotels (nights), ground (distance).",
    hint: "Try sample_data/travel_concur_q1_2025.csv",
  },
];

export default function Upload({ onToast }) {
  const nav = useNavigate();
  const [busy, setBusy] = useState(null);

  const handleFile = async (sourceType, file) => {
    if (!file) return;
    setBusy(sourceType);
    try {
      const batch = await api.upload(sourceType, file);
      onToast(
        "ok",
        `Ingested ${batch.row_count_normalized}/${batch.row_count_raw} rows · ${batch.row_count_flagged} flagged · ${batch.row_count_failed} failed`
      );
      nav(`/batches/${batch.id}`);
    } catch (e) {
      onToast("error", e.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Upload source data</h2>
      <p className="muted" style={{ maxWidth: 720 }}>
        Drop or pick a file for the source. The ingestion pipeline parses
        the file, normalizes units, looks up emission factors, flags suspicious
        rows, and lands everything in the review queue. Duplicate uploads
        (same file content) are rejected.
      </p>
      <div className="upload-grid">
        {SOURCES.map((s) => (
          <div key={s.value} className="card">
            <h3 style={{ marginTop: 0 }}>{s.label}</h3>
            <p className="muted" style={{ fontSize: 13 }}>{s.desc}</p>
            <div className="muted mono" style={{ fontSize: 12, marginBottom: 12 }}>
              {s.hint}
            </div>
            <input
              type="file"
              accept=".csv,.tsv,.txt"
              disabled={busy === s.value}
              onChange={(e) => handleFile(s.value, e.target.files?.[0])}
            />
            {busy === s.value && <div className="muted mt-12">Uploading and ingesting…</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
