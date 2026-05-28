const LABELS = {
  pending: "Pending",
  flagged: "Flagged",
  approved: "Approved",
  rejected: "Rejected",
  failed: "Failed",
};

export default function StatusPill({ status }) {
  return <span className={`pill ${status}`}>{LABELS[status] || status}</span>;
}

export function ScopePill({ scope }) {
  const label =
    scope === "scope_1" ? "Scope 1" :
    scope === "scope_2" ? "Scope 2" :
    scope === "scope_3" ? "Scope 3" : scope;
  return <span className={`pill ${scope}`}>{label}</span>;
}
