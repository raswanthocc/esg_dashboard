export default function Toast({ kind = "ok", msg }) {
  return <div className={`toast ${kind}`}>{msg}</div>;
}
