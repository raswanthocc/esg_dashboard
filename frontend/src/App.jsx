import { useEffect, useState } from "react";
import { Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { api, getAnalyst, getTenant, setAnalyst, setTenant } from "./api.js";
import Dashboard from "./pages/Dashboard.jsx";
import Upload from "./pages/Upload.jsx";
import Review from "./pages/Review.jsx";
import RecordDetail from "./pages/RecordDetail.jsx";
import Batches from "./pages/Batches.jsx";
import BatchDetail from "./pages/BatchDetail.jsx";
import Toast from "./components/Toast.jsx";

export default function App() {
  const [orgs, setOrgs] = useState([]);
  const [tenant, setTenantState] = useState(getTenant());
  const [analyst, setAnalystState] = useState(getAnalyst());
  const [toast, setToast] = useState(null);
  const location = useLocation();

  useEffect(() => {
    api.organizations().then((data) => {
      setOrgs(data);
      if (!tenant && data.length) {
        setTenantState(data[0].slug);
        setTenant(data[0].slug);
      }
    }).catch((e) => setToast({ kind: "error", msg: `Failed to load orgs: ${e.message}` }));
  }, []);

  const showToast = (kind, msg) => {
    setToast({ kind, msg });
    setTimeout(() => setToast(null), 4000);
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          Breathe ESG
          <span className="badge">prototype</span>
        </div>
        <nav className="tabs">
          <NavLink to="/" end>Dashboard</NavLink>
          <NavLink to="/upload">Upload</NavLink>
          <NavLink to="/review">Review</NavLink>
          <NavLink to="/batches">Batches</NavLink>
        </nav>
        <div className="spacer" />
        <div className="row gap-16">
          <label className="row" style={{ gap: 6 }}>
            <span className="muted">Tenant</span>
            <select
              value={tenant}
              onChange={(e) => { setTenantState(e.target.value); setTenant(e.target.value); window.location.reload(); }}
            >
              {orgs.map((o) => (
                <option key={o.slug} value={o.slug}>{o.name}</option>
              ))}
            </select>
          </label>
          <label className="row" style={{ gap: 6 }}>
            <span className="muted">Analyst</span>
            <input
              defaultValue={analyst}
              placeholder="you@org.example"
              onBlur={(e) => { setAnalyst(e.target.value); setAnalystState(e.target.value); }}
              style={{ width: 200 }}
            />
          </label>
        </div>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Dashboard onToast={showToast} />} />
          <Route path="/upload" element={<Upload onToast={showToast} />} />
          <Route path="/review" element={<Review onToast={showToast} />} />
          <Route path="/review/:id" element={<RecordDetail onToast={showToast} />} />
          <Route path="/batches" element={<Batches onToast={showToast} />} />
          <Route path="/batches/:id" element={<BatchDetail onToast={showToast} />} />
        </Routes>
      </main>
      {toast && <Toast {...toast} />}
    </div>
  );
}
