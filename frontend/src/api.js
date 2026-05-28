import { defaultData } from "./pipeline/defaultData.js";
import { PLANTS, resolveFactor } from "./pipeline/factors.js";
import { parseSAP, parseUtility, parseTravel } from "./pipeline/parser.js";
import { validateRecord } from "./pipeline/validator.js";

// Storage Keys
const STORAGE_TENANT = "breathe.tenant";
const STORAGE_ANALYST = "breathe.analyst";
const KEY_ORGS = "breathe.db.organizations";
const KEY_BATCHES = "breathe.db.batches";
const KEY_RAW = "breathe.db.raw_records";
const KEY_RECORDS = "breathe.db.activity_records";
const KEY_AUDIT = "breathe.db.audit_events";

export function getTenant() {
  return localStorage.getItem(STORAGE_TENANT) || "acme";
}
export function setTenant(slug) {
  localStorage.setItem(STORAGE_TENANT, slug);
}
export function getAnalyst() {
  return localStorage.getItem(STORAGE_ANALYST) || "analyst@acme.example";
}
export function setAnalyst(email) {
  localStorage.setItem(STORAGE_ANALYST, email);
}

// Simple hash helper to detect duplicate file uploads
function getSimpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
}

// Low-level database operations
function getDB(key) {
  const data = localStorage.getItem(key);
  return data ? JSON.parse(data) : [];
}

function saveDB(key, data) {
  localStorage.setItem(key, JSON.stringify(data));
}

// Async File Reader helper
function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

// Core Ingestion Pipeline (ported from Django ingestion/pipeline.py)
function localIngest({ sourceType, filename, fileText, uploadedBy }) {
  const tenant = getTenant();
  const sha = getSimpleHash(fileText);

  // Check for duplicates
  const batches = getDB(KEY_BATCHES);
  const isDuplicate = batches.some(
    b => b.organization === tenant && b.source_type === sourceType && b.file_sha256 === sha
  );
  if (isDuplicate) {
    throw new Error(`This exact file (hash=${sha.substring(0, 8)}) was already uploaded for this source.`);
  }

  // Choose the parser
  let parser = null;
  if (sourceType === "sap") parser = parseSAP;
  else if (sourceType === "utility") parser = parseUtility;
  else if (sourceType === "travel") parser = parseTravel;
  else throw new Error(`Unknown source type: ${sourceType}`);

  const parseResult = parser(fileText);

  const newBatch = {
    id: Date.now(),
    organization: tenant,
    source_type: sourceType,
    original_filename: filename,
    file_size_bytes: fileText.length,
    file_sha256: sha,
    uploaded_by: { email: uploadedBy, display_name: uploadedBy.split("@")[0] },
    uploaded_at: new Date().toISOString(),
    status: "parsed",
    parser_notes: parseResult.parser_notes || {},
    row_count_raw: 0,
    row_count_normalized: 0,
    row_count_failed: 0,
    row_count_flagged: 0
  };

  if (!parseResult.rows || parseResult.rows.length === 0) {
    newBatch.status = "failed";
    newBatch.error_message = `No rows parsed. Notes: ${JSON.stringify(parseResult.parser_notes)}`;
    saveDB(KEY_BATCHES, [...batches, newBatch]);
    return newBatch;
  }

  const counts = { raw: 0, normalized: 0, failed: 0, flagged: 0 };
  const rawRecords = getDB(KEY_RAW);
  const activityRecords = getDB(KEY_RECORDS);
  const auditEvents = getDB(KEY_AUDIT);

  const batchRawRecords = [];
  const batchActivityRecords = [];
  const batchAuditEvents = [];

  parseResult.rows.forEach(prow => {
    counts.raw++;
    
    // Create RawRecord
    const rawRec = {
      id: Date.now() + Math.floor(Math.random() * 100000),
      organization: tenant,
      batch: newBatch.id,
      source_row_number: prow.index,
      payload: prow.raw_payload,
      parse_error: prow.error || ""
    };
    batchRawRecords.push(rawRec);

    if (prow.error || !prow.canonical) {
      counts.failed++;
      return;
    }

    const canonical = prow.canonical;

    // Resolve plant code lookup
    let siteName = canonical.site_name;
    let country = canonical.country;
    const plantCode = canonical.parser_hints?.plant_code;
    const lookupFindings = [];

    if (plantCode) {
      const plant = PLANTS[plantCode];
      if (plant) {
        siteName = plant.siteName;
        country = plant.country;
      } else {
        lookupFindings.push({
          rule_id: "unmapped_plant_code",
          severity: "warning",
          message: `Unmapped SAP plant code '${plantCode}' — assign to a site in PlantCodeMap`,
          field: "site_name",
          observed: plantCode
        });
      }
    }

    if (!country) {
      country = "IN"; // default tenant country
    }

    const multiplierRaw = canonical.parser_hints?.compute_multiplier || "1.00";
    const multiplier = parseFloat(multiplierRaw);

    const year = new Date(canonical.period_end).getFullYear();
    const { factor, strategy } = resolveFactor(canonical.activity_type, canonical.normalized_unit, country, year);

    let co2e = null;
    if (factor !== null) {
      co2e = Math.round(canonical.normalized_value * factor.value * multiplier * 10000) / 10000;
    }

    // Create ActivityRecord
    const ar = {
      id: Date.now() + Math.floor(Math.random() * 100000),
      organization: tenant,
      batch: newBatch.id,
      raw_record: rawRec.id,
      scope: canonical.scope,
      activity_type: canonical.activity_type,
      period_start: canonical.period_start,
      period_end: canonical.period_end,
      original_value: canonical.original_value,
      original_unit: canonical.original_unit,
      normalized_value: canonical.normalized_value,
      normalized_unit: canonical.normalized_unit,
      emission_factor: factor ? { kg_co2e_per_unit: factor.value, source: factor.source } : null,
      factor_match_strategy: strategy,
      compute_multiplier: multiplier,
      co2e_kg: co2e,
      site_name: siteName,
      country: country,
      description: canonical.description,
      flag_reasons: [...(canonical.parser_findings || []), ...lookupFindings],
      status: "pending" // defaults to pending
    };
    counts.normalized++;

    // Validate (runs flagging rules)
    validateRecord(ar, [...activityRecords, ...batchActivityRecords]);
    if (ar.status === "flagged") {
      counts.flagged++;
    }

    batchActivityRecords.push(ar);

    // Create AuditEvent
    const audit = {
      id: Date.now() + Math.floor(Math.random() * 100000),
      organization: tenant,
      activity_record: ar.id,
      action: "ingested",
      actor_label: uploadedBy,
      created_at: new Date().toISOString(),
      after: {
        status: ar.status,
        co2e_kg: ar.co2e_kg !== null ? String(ar.co2e_kg) : null,
        factor_match_strategy: ar.factor_match_strategy,
        finding_count: ar.flag_reasons.length
      },
      note: `Ingested from batch #${newBatch.id}`
    };
    batchAuditEvents.push(audit);
  });

  newBatch.row_count_raw = counts.raw;
  newBatch.row_count_normalized = counts.normalized;
  newBatch.row_count_failed = counts.failed;
  newBatch.row_count_flagged = counts.flagged;

  // Persist all data
  saveDB(KEY_BATCHES, [...batches, newBatch]);
  saveDB(KEY_RAW, [...rawRecords, ...batchRawRecords]);
  saveDB(KEY_RECORDS, [...activityRecords, ...batchActivityRecords]);
  saveDB(KEY_AUDIT, [...auditEvents, ...batchAuditEvents]);

  return newBatch;
}

// Database Seeding Logic (seeding default data on first boot)
function ensureSeeded() {
  const orgs = getDB(KEY_ORGS);
  if (orgs.length > 0) return; // Already seeded

  // 1. Create Tenant
  const demoTenant = {
    slug: "acme",
    name: "Acme Industries",
    default_country: "IN",
    fiscal_year_start_month: 4
  };
  saveDB(KEY_ORGS, [demoTenant]);
  setTenant("acme");
  setAnalyst("analyst@acme.example");

  // 2. Ingest the three default files as batches
  try {
    localIngest({
      sourceType: "sap",
      filename: "sap_fuel_q1_2025.csv",
      fileText: defaultData.sapFuel,
      uploadedBy: "system"
    });
    
    localIngest({
      sourceType: "utility",
      filename: "utility_electricity_q1_2025.csv",
      fileText: defaultData.utilityElectricity,
      uploadedBy: "system"
    });

    localIngest({
      sourceType: "travel",
      filename: "travel_concur_q1_2025.csv",
      fileText: defaultData.travelConcur,
      uploadedBy: "system"
    });
  } catch (err) {
    console.error("Failed to seed default batches:", err);
  }
}

// -------------------------------------------------------------
// Public Client API Mock Interfaces (Promise-based for components)
// -------------------------------------------------------------
export const api = {
  organizations: async () => {
    ensureSeeded();
    return getDB(KEY_ORGS);
  },

  summary: async () => {
    ensureSeeded();
    const tenant = getTenant();
    const records = getDB(KEY_RECORDS).filter(r => r.organization === tenant);
    
    // Status counts
    const counts = { pending: 0, flagged: 0, approved: 0, rejected: 0 };
    records.forEach(r => {
      if (counts[r.status] !== undefined) counts[r.status]++;
    });

    // Totals by scope
    const byScope = {
      scope_1: { records: 0, co2e_kg: 0 },
      scope_2: { records: 0, co2e_kg: 0 },
      scope_3: { records: 0, co2e_kg: 0 }
    };
    records.forEach(r => {
      if (byScope[r.scope] !== undefined) {
        byScope[r.scope].records++;
        byScope[r.scope].co2e_kg += r.co2e_kg || 0;
      }
    });

    // Round scope co2e
    Object.keys(byScope).forEach(k => {
      byScope[k].co2e_kg = Math.round(byScope[k].co2e_kg * 100) / 100;
    });

    // Totals by source type
    const sourceTypes = [
      { value: "sap", label: "SAP Procurement" },
      { value: "utility", label: "Utility Billing" },
      { value: "travel", label: "Corporate Travel" }
    ];
    
    const batches = getDB(KEY_BATCHES).filter(b => b.organization === tenant);

    const bySource = sourceTypes.map(st => {
      const sourceBatches = batches.filter(b => b.source_type === st.value);
      const batchIds = new Set(sourceBatches.map(b => b.id));
      const sourceRecords = records.filter(r => batchIds.has(r.batch));

      const totalCo2e = sourceRecords.reduce((sum, r) => sum + (r.co2e_kg || 0), 0);
      const flagged = sourceRecords.filter(r => r.status === "flagged").length;
      const pending = sourceRecords.filter(r => r.status === "pending").length;

      return {
        source_type: st.value,
        source_type_display: st.label,
        batches: sourceBatches.length,
        records: sourceRecords.length,
        co2e_kg: Math.round(totalCo2e * 100) / 100,
        flagged,
        pending
      };
    });

    const grandTotalCo2e = records.reduce((sum, r) => sum + (r.co2e_kg || 0), 0);
    const activeOrg = getDB(KEY_ORGS).find(o => o.slug === tenant) || { name: tenant, slug: tenant };

    return {
      organization: activeOrg,
      totals: {
        records: records.length,
        co2e_kg: Math.round(grandTotalCo2e * 100) / 100,
        pending: counts.pending,
        flagged: counts.flagged,
        approved: counts.approved,
        rejected: counts.rejected
      },
      by_scope: byScope,
      by_source: bySource,
      source_types: sourceTypes
    };
  },

  batches: async () => {
    ensureSeeded();
    const tenant = getTenant();
    const list = getDB(KEY_BATCHES).filter(b => b.organization === tenant);
    // Sort descending by uploaded date
    list.sort((a, b) => new Date(b.uploaded_at) - new Date(a.uploaded_at));
    return list;
  },

  batch: async (id) => {
    ensureSeeded();
    const tenant = getTenant();
    const numericId = parseInt(id);
    const batch = getDB(KEY_BATCHES).find(b => b.id === numericId && b.organization === tenant);
    if (!batch) throw new Error("Batch not found");

    const records = getDB(KEY_RECORDS).filter(r => r.batch === numericId && r.organization === tenant);
    const failed = getDB(KEY_RAW).filter(
      r => r.batch === numericId && r.organization === tenant && r.parse_error !== ""
    );

    return {
      batch,
      records,
      failed_raw_rows: failed
    };
  },

  upload: async (sourceType, file) => {
    ensureSeeded();
    const text = await readFileAsText(file);
    const analyst = getAnalyst();
    return localIngest({
      sourceType,
      filename: file.name,
      fileText: text,
      uploadedBy: analyst || "system"
    });
  },

  records: async (params = {}) => {
    ensureSeeded();
    const tenant = getTenant();
    let qs = getDB(KEY_RECORDS).filter(r => r.organization === tenant);

    const batches = getDB(KEY_BATCHES).filter(b => b.organization === tenant);
    const batchMap = {};
    batches.forEach(b => { batchMap[b.id] = b; });

    // Apply filters
    if (params.source_type) {
      qs = qs.filter(r => batchMap[r.batch]?.source_type === params.source_type);
    }
    if (params.scope) {
      qs = qs.filter(r => r.scope === params.scope);
    }
    if (params.status) {
      qs = qs.filter(r => r.status === params.status);
    }
    if (params.batch) {
      qs = qs.filter(r => r.batch === parseInt(params.batch));
    }
    if (params.q) {
      const q = params.q.toLowerCase();
      qs = qs.filter(
        r => (r.description && r.description.toLowerCase().includes(q)) ||
             (r.site_name && r.site_name.toLowerCase().includes(q))
      );
    }

    const total = qs.length;
    const limit = parseInt(params.limit || "100");
    const offset = parseInt(params.offset || "0");
    const page = qs.slice(offset, offset + limit);

    return {
      total,
      limit,
      offset,
      results: page
    };
  },

  record: async (id) => {
    ensureSeeded();
    const tenant = getTenant();
    const numericId = parseInt(id);
    const record = getDB(KEY_RECORDS).find(r => r.id === numericId && r.organization === tenant);
    if (!record) throw new Error("Record not found");

    const rawRecord = getDB(KEY_RAW).find(r => r.id === record.raw_record);
    record.raw_record = rawRecord || null; // inline raw payload

    const audit = getDB(KEY_AUDIT).filter(a => a.activity_record === numericId && a.organization === tenant);
    // Sort chronological descending
    audit.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    return {
      record,
      audit
    };
  },

  patchRecord: async (id, body, clearFlags = false) => {
    ensureSeeded();
    const tenant = getTenant();
    const analyst = getAnalyst();
    const numericId = parseInt(id);

    const records = getDB(KEY_RECORDS);
    const idx = records.findIndex(r => r.id === numericId && r.organization === tenant);
    if (idx === -1) throw new Error("Record not found");

    const ar = records[idx];
    if (ar.status === "approved") {
      throw new Error("Record is approved/locked. Reject first to edit.");
    }

    const EDITABLE = [
      "scope",
      "activity_type",
      "period_start",
      "period_end",
      "normalized_value",
      "normalized_unit",
      "site_name",
      "country",
      "description"
    ];

    const before = {};
    EDITABLE.forEach(f => { before[f] = ar[f]; });

    let changed = false;
    EDITABLE.forEach(field => {
      if (body[field] !== undefined && body[field] !== null) {
        if (field === "normalized_value") {
          ar[field] = parseFloat(body[field]);
        } else {
          ar[field] = body[field];
        }
        changed = true;
      }
    });

    if (!changed) throw new Error("No editable fields supplied.");

    ar.edited_after_import = true;
    ar.last_edited_by = { email: analyst, display_name: analyst.split("@")[0] };
    ar.last_edited_at = new Date().toISOString();

    // Re-calculate CO2e if values changed
    const year = new Date(ar.period_end).getFullYear();
    const { factor, strategy } = resolveFactor(ar.activity_type, ar.normalized_unit, ar.country, year);
    ar.emission_factor = factor ? { kg_co2e_per_unit: factor.value, source: factor.source } : null;
    ar.factor_match_strategy = strategy;
    
    if (factor !== null) {
      ar.co2e_kg = Math.round(ar.normalized_value * factor.value * ar.compute_multiplier * 10000) / 10000;
    } else {
      ar.co2e_kg = null;
    }

    // Handle flags clearing
    if (clearFlags) {
      ar.flag_reasons = [];
      if (ar.status === "flagged") {
        ar.status = "pending";
      }
    } else {
      // Clear out validator warnings, keep parser flags, and re-validate
      ar.flag_reasons = ar.flag_reasons.filter(f => f.rule_id === "activity_inference_failed" || f.rule_id === "unmapped_plant_code" || f.rule_id === "cabin_class_unknown" || f.rule_id === "hotel_country_missing");
      validateRecord(ar, records);
    }

    records[idx] = ar;
    saveDB(KEY_RECORDS, records);

    // Create AuditEvent
    const auditEvents = getDB(KEY_AUDIT);
    const audit = {
      id: Date.now() + Math.floor(Math.random() * 100000),
      organization: tenant,
      activity_record: ar.id,
      action: "edited",
      actor_label: analyst || "system",
      created_at: new Date().toISOString(),
      before,
      after: {
        scope: ar.scope,
        activity_type: ar.activity_type,
        period_start: ar.period_start,
        period_end: ar.period_end,
        normalized_value: ar.normalized_value,
        normalized_unit: ar.normalized_unit,
        co2e_kg: ar.co2e_kg
      },
      note: `Edited fields: ${Object.keys(body).filter(k => EDITABLE.includes(k)).join(", ")}`
    };
    saveDB(KEY_AUDIT, [...auditEvents, audit]);

    return ar;
  },

  approveRecord: async (id, note = "") => {
    ensureSeeded();
    const tenant = getTenant();
    const analyst = getAnalyst();
    const numericId = parseInt(id);

    const records = getDB(KEY_RECORDS);
    const idx = records.findIndex(r => r.id === numericId && r.organization === tenant);
    if (idx === -1) throw new Error("Record not found");

    const ar = records[idx];
    if (ar.status === "approved") throw new Error("Already approved.");

    ar.status = "approved";
    ar.approved_by = { email: analyst, display_name: analyst.split("@")[0] };
    ar.approved_at = new Date().toISOString();

    records[idx] = ar;
    saveDB(KEY_RECORDS, records);

    // Create AuditEvent
    const auditEvents = getDB(KEY_AUDIT);
    const audit = {
      id: Date.now() + Math.floor(Math.random() * 100000),
      organization: tenant,
      activity_record: ar.id,
      action: "approved",
      actor_label: analyst || "system",
      created_at: new Date().toISOString(),
      after: {
        status: ar.status,
        approved_at: ar.approved_at
      },
      note
    };
    saveDB(KEY_AUDIT, [...auditEvents, audit]);

    return ar;
  },

  rejectRecord: async (id, note = "") => {
    ensureSeeded();
    const tenant = getTenant();
    const analyst = getAnalyst();
    const numericId = parseInt(id);

    const records = getDB(KEY_RECORDS);
    const idx = records.findIndex(r => r.id === numericId && r.organization === tenant);
    if (idx === -1) throw new Error("Record not found");

    const ar = records[idx];
    if (ar.status === "approved") throw new Error("Already approved — cannot reject.");

    ar.status = "rejected";

    records[idx] = ar;
    saveDB(KEY_RECORDS, records);

    // Create AuditEvent
    const auditEvents = getDB(KEY_AUDIT);
    const audit = {
      id: Date.now() + Math.floor(Math.random() * 100000),
      organization: tenant,
      activity_record: ar.id,
      action: "rejected",
      actor_label: analyst || "system",
      created_at: new Date().toISOString(),
      after: {
        status: ar.status
      },
      note
    };
    saveDB(KEY_AUDIT, [...auditEvents, audit]);

    return ar;
  },

  bulkApprove: async (batchId) => {
    ensureSeeded();
    const tenant = getTenant();
    const analyst = getAnalyst();
    const numericBatchId = batchId ? parseInt(batchId) : null;

    const records = getDB(KEY_RECORDS);
    const auditEvents = getDB(KEY_AUDIT);
    
    let count = 0;
    const now = new Date().toISOString();
    const batchAuditEvents = [];

    records.forEach(ar => {
      if (ar.organization !== tenant) return;
      if (ar.status !== "pending") return;
      if (numericBatchId && ar.batch !== numericBatchId) return;

      ar.status = "approved";
      ar.approved_by = { email: analyst, display_name: analyst.split("@")[0] };
      ar.approved_at = now;
      count++;

      // Create AuditEvent
      const audit = {
        id: Date.now() + Math.floor(Math.random() * 100000) + count,
        organization: tenant,
        activity_record: ar.id,
        action: "approved",
        actor_label: analyst || "system",
        created_at: now,
        after: {
          status: "approved",
          approved_at: now
        },
        note: "Bulk approve clean rows"
      };
      batchAuditEvents.push(audit);
    });

    if (count > 0) {
      saveDB(KEY_RECORDS, records);
      saveDB(KEY_AUDIT, [...auditEvents, ...batchAuditEvents]);
    }

    return { approved: count };
  }
};
