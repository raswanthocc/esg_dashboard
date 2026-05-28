// Tiny fetch wrapper that injects the X-Tenant and X-Analyst headers from
// localStorage. Keeping this in one place means components don't reach
// into storage themselves.

const STORAGE_TENANT = "breathe.tenant";
const STORAGE_ANALYST = "breathe.analyst";

export function getTenant() {
  return localStorage.getItem(STORAGE_TENANT) || "";
}
export function setTenant(slug) {
  localStorage.setItem(STORAGE_TENANT, slug);
}
export function getAnalyst() {
  return localStorage.getItem(STORAGE_ANALYST) || "";
}
export function setAnalyst(email) {
  localStorage.setItem(STORAGE_ANALYST, email);
}

async function request(path, { method = "GET", body, isForm = false } = {}) {
  const headers = {};
  const tenant = getTenant();
  const analyst = getAnalyst();
  if (tenant) headers["X-Tenant"] = tenant;
  if (analyst) headers["X-Analyst"] = analyst;
  if (!isForm && body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: isForm ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const detail = json?.detail || res.statusText;
    const err = new Error(detail);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

export const api = {
  organizations: () => request("/organizations"),
  summary: () => request("/summary"),
  batches: () => request("/batches"),
  batch: (id) => request(`/batches/${id}`),
  upload: (sourceType, file) => {
    const fd = new FormData();
    fd.append("source_type", sourceType);
    fd.append("file", file);
    return request("/batches/upload", { method: "POST", body: fd, isForm: true });
  },
  records: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/records${q ? `?${q}` : ""}`);
  },
  record: (id) => request(`/records/${id}`),
  patchRecord: (id, body, clearFlags = false) =>
    request(`/records/${id}${clearFlags ? "?clear_flags=true" : ""}`, {
      method: "PATCH",
      body,
    }),
  approveRecord: (id, note = "") =>
    request(`/records/${id}/approve`, { method: "POST", body: { note } }),
  rejectRecord: (id, note = "") =>
    request(`/records/${id}/reject`, { method: "POST", body: { note } }),
  bulkApprove: (batchId) =>
    request("/records/bulk-approve", {
      method: "POST",
      body: batchId ? { batch: batchId } : {},
    }),
};
