import { AIRPORTS, haversineKm } from "./distance.js";

// Helper: Custom robust CSV parser that handles quotes and multiple delimiters
function parseCSV(text, delimiter) {
  const lines = text.split(/\r?\n/);
  const rows = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    
    const row = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === delimiter && !inQuotes) {
        row.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    row.push(current.trim());
    rows.push(row);
  }
  return rows;
}

function detectSeparator(firstLine) {
  for (const sep of [";", "\t", ","]) {
    if (firstLine.includes(sep)) return sep;
  }
  return ";";
}

function normalizeHeader(h) {
  return h.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function buildHeaderMap(headers, aliasesSpec) {
  const normToIdx = {};
  headers.forEach((h, idx) => {
    normToIdx[normalizeHeader(h)] = idx;
  });
  
  const out = {};
  for (const [canonicalKey, aliases] of Object.entries(aliasesSpec)) {
    for (const alias of aliases) {
      const n = normalizeHeader(alias);
      if (normToIdx[n] !== undefined) {
        out[canonicalKey] = normToIdx[n];
        break;
      }
    }
  }
  return out;
}

function parseGermanDecimal(s) {
  if (!s) return null;
  s = s.trim();
  if (!s) return null;
  
  // German style: '.' is thousands, ',' is decimal point
  if (s.includes(",") && s.includes(".")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }
  
  const val = parseFloat(s);
  return isNaN(val) ? null : val;
}

function parseStandardDate(s) {
  if (!s) return null;
  s = s.trim();
  if (!s) return null;

  // Formats: DD.MM.YYYY, YYYY-MM-DD, DD/MM/YYYY, MM/DD/YYYY, YYYYMMDD
  // Check DD.MM.YYYY
  let m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) {
    const day = m[1].padStart(2, "0");
    const month = m[2].padStart(2, "0");
    const year = m[3];
    return `${year}-${month}-${day}`;
  }

  // Check YYYY-MM-DD
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const year = m[1];
    const month = m[2].padStart(2, "0");
    const day = m[3].padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  // Check DD/MM/YYYY or MM/DD/YYYY
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    // We try to guess based on standard logic. For our travel/utility data:
    // bombay to delhi is 08/01/2025 (8th Jan). Let's assume DD/MM/YYYY
    const dOrM = m[1].padStart(2, "0");
    const mOrD = m[2].padStart(2, "0");
    const year = m[3];
    
    // In our travel sample: '2025-01-08' is Priya's travel.
    // If the second token is > 12, it must be the day, so it is MM/DD/YYYY.
    // Otherwise we default to DD/MM/YYYY
    if (parseInt(mOrD) > 12) {
      return `${year}-${dOrM}-${mOrD}`; // MM/DD/YYYY -> YYYY-MM-DD
    } else {
      return `${year}-${mOrD}-${dOrM}`; // DD/MM/YYYY -> YYYY-MM-DD
    }
  }

  return s; // Fallback
}

// Structured finding shorthand
function createFinding(ruleId, message, severity = "warning", extra = {}) {
  return { rule_id: ruleId, severity, message, ...extra };
}

// -------------------------------------------------------------
// SAP Fuel Parser
// -------------------------------------------------------------
const SAP_HEADER_ALIASES = {
  material: ["material", "materialnummer", "matnr"],
  description: ["description", "materialkurztext", "material description", "kurztext"],
  plant: ["plant", "werk", "werks"],
  quantity: ["quantity", "menge", "qty"],
  unit: ["unit", "uom", "mengeneinheit", "meins", "base unit"],
  posting_date: ["posting date", "buchungsdatum", "budat", "doc date"],
  movement_type: ["movement type", "bewegungsart", "bwart"]
};

const SAP_UNIT_TO_CANONICAL = {
  L: { unit: "L", multiplier: 1 },
  LTR: { unit: "L", multiplier: 1 },
  LITRE: { unit: "L", multiplier: 1 },
  LITER: { unit: "L", multiplier: 1 },
  ML: { unit: "L", multiplier: 0.001 },
  M3: { unit: "L", multiplier: 1000 },
  KG: { unit: "kg", multiplier: 1 },
  G: { unit: "kg", multiplier: 0.001 },
  T: { unit: "kg", multiplier: 1000 }
};

const SAP_KEYWORDS = [
  ["diesel", "diesel"],
  ["hsd", "diesel"],
  ["petrol", "petrol"],
  ["gasoline", "petrol"],
  ["ms ", "petrol"],
  ["natural gas", "natural_gas"],
  ["png", "natural_gas"],
  ["cng", "natural_gas"],
  ["lpg", "lpg"],
  ["propane", "lpg"]
];

function inferSapActivity(description) {
  const desc = (description || "").toLowerCase();
  for (const [kw, act] of SAP_KEYWORDS) {
    if (desc.includes(kw)) return act;
  }
  return "other";
}

export function parseSAP(text) {
  const firstLine = text.split("\n")[0] || "";
  const sep = detectSeparator(firstLine);
  const rows = parseCSV(text, sep);

  if (rows.length === 0) {
    return { rows: [], parserNotes: { error: "empty file" } };
  }

  const headers = rows[0];
  const headerMap = buildHeaderMap(headers, SAP_HEADER_ALIASES);
  
  const missingRequired = ["material", "plant", "quantity", "unit", "posting_date"].filter(
    k => headerMap[k] === undefined
  );
  
  const notes = {
    encoding: "utf-8",
    separator: sep,
    headers_seen: headers,
    header_map: headerMap,
    missing_required_headers: missingRequired
  };

  if (missingRequired.length > 0) {
    return { rows: [], parserNotes: notes };
  }

  const parsedRows = [];
  for (let idx = 1; idx < rows.length; idx++) {
    const row = rows[idx];
    if (row.length === 0 || row.join("").trim() === "") continue;

    const col = key => {
      const i = headerMap[key];
      return (i !== undefined && i < row.length) ? row[i].trim() : "";
    };

    const rawPayload = {};
    headers.forEach((h, i) => {
      rawPayload[h] = i < row.length ? row[i] : "";
    });

    const parsed = { index: idx, raw_payload: rawPayload, canonical: null, error: "" };

    const material = col("material").replace(/^0+/, "") || col("material");
    const description = col("description");
    const plant = col("plant");
    const unitRaw = col("unit").toUpperCase();
    const qty = parseGermanDecimal(col("quantity"));
    const posting = parseStandardDate(col("posting_date"));

    if (qty === null) {
      parsed.error = `Unparseable quantity: '${col("quantity")}'`;
      parsedRows.push(parsed);
      continue;
    }
    if (!posting) {
      parsed.error = `Unparseable date: '${col("posting_date")}'`;
      parsedRows.push(parsed);
      continue;
    }

    const activity = inferSapActivity(description);
    const findings = [];
    if (activity === "other") {
      findings.push(createFinding(
        "activity_inference_failed",
        `Could not infer activity type from description '${description}' — defaulted to 'other'`,
        "warning",
        { field: "activity_type", observed: description }
      ));
    }

    const canonicalUnitInfo = SAP_UNIT_TO_CANONICAL[unitRaw];
    if (!canonicalUnitInfo) {
      parsed.error = `Unknown SAP unit of measure '${unitRaw}'`;
      parsedRows.push(parsed);
      continue;
    }

    const { unit: normalizedUnit, multiplier } = canonicalUnitInfo;
    const normalizedValue = Math.round(qty * multiplier * 10000) / 10000;

    parsed.canonical = {
      scope: "scope_1",
      activity_type: activity,
      period_start: posting,
      period_end: posting,
      original_value: qty,
      original_unit: unitRaw,
      normalized_value: normalizedValue,
      normalized_unit: normalizedUnit,
      site_name: "", // Resolved in API layer using PlantCodeMap lookup
      country: "",   // Resolved in API layer
      description: `${material} ${description}`.trim(),
      parser_findings: findings,
      parser_hints: plant ? { plant_code: plant } : {}
    };

    parsedRows.push(parsed);
  }

  return { rows: parsedRows, parserNotes: notes };
}

// -------------------------------------------------------------
// Utility Electricity Parser
// -------------------------------------------------------------
const UTILITY_REQUIRED = {
  meter_id: ["meter id", "meter", "mpan", "meter_number"],
  site: ["site", "site name", "premises", "location"],
  period_start: ["period start", "billing start", "from", "service period start"],
  period_end: ["period end", "billing end", "to", "service period end"],
  consumption: ["consumption", "usage", "kwh", "energy"],
  unit: ["unit", "uom"]
};

const UTILITY_OPTIONAL = {
  estimated: ["estimated", "read type", "is_estimated"],
  country: ["country"]
};

const UTILITY_UNIT_TO_KWH = {
  KWH: 1,
  MWH: 1000,
  GWH: 1000000,
  WH: 0.001
};

export function parseUtility(text) {
  const rows = parseCSV(text, ",");

  if (rows.length === 0) {
    return { rows: [], parserNotes: { error: "empty file" } };
  }

  const headers = rows[0];
  const cols = buildHeaderMap(headers, UTILITY_REQUIRED);
  const opt = buildHeaderMap(headers, UTILITY_OPTIONAL);

  const missing = Object.keys(UTILITY_REQUIRED).filter(k => cols[k] === undefined);

  const notes = {
    headers_seen: headers,
    columns_mapped: cols,
    optional_columns_mapped: opt,
    missing_required: missing
  };

  if (missing.length > 0) {
    return { rows: [], parserNotes: notes };
  }

  const parsedRows = [];
  for (let idx = 1; idx < rows.length; idx++) {
    const row = rows[idx];
    if (row.length === 0 || row.join("").trim() === "") continue;

    const col = (key, source = cols) => {
      const i = source[key];
      return (i !== undefined && i < row.length) ? row[i].trim() : "";
    };

    const rawPayload = {};
    headers.forEach((h, i) => {
      rawPayload[h] = i < row.length ? row[i] : "";
    });

    const parsed = { index: idx, raw_payload: rawPayload, canonical: null, error: "" };

    const meterId = col("meter_id");
    const site = col("site");
    const start = parseStandardDate(col("period_start"));
    const end = parseStandardDate(col("period_end"));
    const consumption = parseGermanDecimal(col("consumption"));
    const unitRaw = col("unit").toUpperCase() || "KWH";

    if (!start || !end) {
      parsed.error = "Unparseable billing period";
      parsedRows.push(parsed);
      continue;
    }
    if (consumption === null) {
      parsed.error = "Unparseable consumption value";
      parsedRows.push(parsed);
      continue;
    }

    const multiplier = UTILITY_UNIT_TO_KWH[unitRaw];
    if (multiplier === undefined) {
      parsed.error = `Unknown electricity unit '${unitRaw}'`;
      parsedRows.push(parsed);
      continue;
    }

    const findings = [];
    const dateStart = new Date(start);
    const dateEnd = new Date(end);
    
    if (dateEnd < dateStart) {
      findings.push(createFinding(
        "period_inverted",
        "Billing period end is before start",
        "error",
        { field: "period_end" }
      ));
    }

    const diffTime = Math.abs(dateEnd - dateStart);
    const periodDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    if (periodDays > 35 || periodDays < 25) {
      findings.push(createFinding(
        "period_atypical",
        `Billing period of ${periodDays} days is outside normal monthly range (25–35)`,
        "warning",
        { field: "period_end", observed: periodDays }
      ));
    }

    if (consumption < 0) {
      findings.push(createFinding(
        "negative_consumption",
        "Negative consumption — possible solar export / credit row",
        "warning",
        { field: "normalized_value", observed: String(consumption) }
      ));
    }

    const estimatedRaw = col("estimated", opt).toLowerCase();
    if (["true", "yes", "y", "1", "estimated"].includes(estimatedRaw)) {
      findings.push(createFinding(
        "estimated_reading",
        "Reading marked estimated by utility (no physical meter read)",
        "info",
        { field: "normalized_value" }
      ));
    }

    const country = col("country", opt).toUpperCase() || "";

    const normalizedValue = Math.round(consumption * multiplier * 10000) / 10000;

    parsed.canonical = {
      scope: "scope_2",
      activity_type: "electricity",
      period_start: start,
      period_end: end,
      original_value: consumption,
      original_unit: unitRaw,
      normalized_value: normalizedValue,
      normalized_unit: "kWh",
      site_name: site,
      country: country,
      description: `Meter ${meterId} ${site}`.trim(),
      parser_findings: findings
    };

    parsedRows.push(parsed);
  }

  return { rows: parsedRows, parserNotes: notes };
}

// -------------------------------------------------------------
// Corporate Travel Parser
// -------------------------------------------------------------
const TRAVEL_REQUIRED = {
  trip_id: ["trip id", "trip", "itinerary id"],
  traveller: ["traveller", "employee", "passenger", "traveler"],
  type: ["type", "segment type", "category"],
  date: ["date", "departure date", "check-in date", "start date"]
};

const TRAVEL_OPTIONAL = {
  origin: ["origin", "from", "from airport"],
  destination: ["destination", "to", "to airport"],
  cabin_class: ["cabin", "class", "fare class"],
  nights: ["nights", "room nights"],
  distance_km: ["distance km", "distance", "km"],
  city: ["city", "destination city"],
  country: ["country"],
  end_date: ["end date", "check-out date", "return date"]
};

const CABIN_MULTIPLIERS = {
  ECONOMY: 1.0,
  PREMIUM: 1.6,
  "PREMIUM ECONOMY": 1.6,
  BUSINESS: 2.9,
  FIRST: 4.0
};

function classifyFlight(distanceKm) {
  if (distanceKm < 1500) return "flight_short";
  if (distanceKm < 3700) return "flight_medium";
  return "flight_long";
}

export function parseTravel(text) {
  const rows = parseCSV(text, ",");

  if (rows.length === 0) {
    return { rows: [], parserNotes: { error: "empty file" } };
  }

  const headers = rows[0];
  const req = buildHeaderMap(headers, TRAVEL_REQUIRED);
  const opt = buildHeaderMap(headers, TRAVEL_OPTIONAL);

  const missing = Object.keys(TRAVEL_REQUIRED).filter(k => req[k] === undefined);

  const notes = {
    headers_seen: headers,
    required_columns: req,
    optional_columns: opt,
    missing_required: missing
  };

  if (missing.length > 0) {
    return { rows: [], parserNotes: notes };
  }

  const parsedRows = [];
  for (let idx = 1; idx < rows.length; idx++) {
    const row = rows[idx];
    if (row.length === 0 || row.join("").trim() === "") continue;

    const col = (key, source) => {
      const i = source[key];
      return (i !== undefined && i < row.length) ? row[i].trim() : "";
    };

    const rawPayload = {};
    headers.forEach((h, i) => {
      rawPayload[h] = i < row.length ? row[i] : "";
    });

    const parsed = { index: idx, raw_payload: rawPayload, canonical: null, error: "" };

    const segType = col("type", req).toLowerCase();
    const start = parseStandardDate(col("date", req));

    if (!start) {
      parsed.error = "Unparseable start date";
      parsedRows.push(parsed);
      continue;
    }

    const findings = [];

    if (["flight", "air"].includes(segType)) {
      const o = col("origin", opt).toUpperCase();
      const d = col("destination", opt).toUpperCase();
      const cabin = col("cabin_class", opt).toUpperCase() || "ECONOMY";
      const givenDistance = parseGermanDecimal(col("distance_km", opt));

      let distance = 0;
      let distanceSource = "";

      if (givenDistance !== null && givenDistance > 0) {
        distance = givenDistance;
        distanceSource = "source-provided";
      } else if (AIRPORTS[o] && AIRPORTS[d]) {
        const a = AIRPORTS[o];
        const b = AIRPORTS[d];
        distance = haversineKm(a.latitude, a.longitude, b.latitude, b.longitude);
        distanceSource = "computed-haversine";
      } else {
        const unknown = [o, d].filter(c => !AIRPORTS[c]);
        parsed.error = `Cannot compute flight distance: unknown IATA code(s) [${unknown.join(", ")}]`;
        parsedRows.push(parsed);
        continue;
      }

      const activity = classifyFlight(distance);
      let cabinMult = CABIN_MULTIPLIERS[cabin];
      if (cabinMult === undefined) {
        findings.push(createFinding(
          "cabin_class_unknown",
          `Unknown cabin class '${cabin}' — defaulted to economy multiplier`,
          "warning",
          { field: "activity_type", observed: cabin }
        ));
        cabinMult = 1.0;
      }

      parsed.canonical = {
        scope: "scope_3",
        activity_type: activity,
        period_start: start,
        period_end: start,
        original_value: distance,
        original_unit: `km (${distanceSource})`,
        normalized_value: distance,
        normalized_unit: "pkm",
        country: AIRPORTS[d] ? AIRPORTS[d].country : "",
        description: `${o}→${d} ${cabin}`,
        parser_findings: findings,
        parser_hints: { compute_multiplier: String(cabinMult), cabin_class: cabin }
      };

      parsedRows.push(parsed);
      continue;
    }

    if (segType === "hotel") {
      let nights = parseGermanDecimal(col("nights", opt));
      const end = parseStandardDate(col("end_date", opt));

      if (nights === null && end) {
        const dateStart = new Date(start);
        const dateEnd = new Date(end);
        nights = Math.ceil(Math.abs(dateEnd - dateStart) / (1000 * 60 * 60 * 24));
      }

      if (nights === null || nights <= 0) {
        parsed.error = "Hotel row missing nights and end date";
        parsedRows.push(parsed);
        continue;
      }

      let endDateStr = end;
      if (!endDateStr) {
        const dateStart = new Date(start);
        dateStart.setDate(dateStart.getDate() + parseInt(nights));
        const y = dateStart.getFullYear();
        const m = String(dateStart.getMonth() + 1).padStart(2, "0");
        const d = String(dateStart.getDate()).padStart(2, "0");
        endDateStr = `${y}-${m}-${d}`;
      }

      const city = col("city", opt);
      const country = col("country", opt).toUpperCase();

      if (!country) {
        findings.push(createFinding(
          "hotel_country_missing",
          "Hotel row has no country — will fall back to global average factor",
          "warning",
          { field: "country" }
        ));
      }

      parsed.canonical = {
        scope: "scope_3",
        activity_type: "hotel_night",
        period_start: start,
        period_end: endDateStr,
        original_value: nights,
        original_unit: "nights",
        normalized_value: nights,
        normalized_unit: "night",
        site_name: city,
        country: country,
        description: `Hotel ${city}`,
        parser_findings: findings
      };

      parsedRows.push(parsed);
      continue;
    }

    if (["ground", "taxi", "car", "rideshare"].includes(segType)) {
      const distance = parseGermanDecimal(col("distance_km", opt));
      if (distance === null || distance <= 0) {
        parsed.error = "Ground transport row missing distance — fare-based fallback is not implemented in the prototype";
        parsedRows.push(parsed);
        continue;
      }

      parsed.canonical = {
        scope: "scope_3",
        activity_type: "taxi",
        period_start: start,
        period_end: start,
        original_value: distance,
        original_unit: "km",
        normalized_value: distance,
        normalized_unit: "pkm",
        country: col("country", opt).toUpperCase(),
        description: `Ground ${col("city", opt)}`.trim(),
        parser_findings: findings
      };

      parsedRows.push(parsed);
      continue;
    }

    if (segType === "rail") {
      const distance = parseGermanDecimal(col("distance_km", opt));
      if (distance === null || distance <= 0) {
        parsed.error = "Rail row missing distance";
        parsedRows.push(parsed);
        continue;
      }

      parsed.canonical = {
        scope: "scope_3",
        activity_type: "rail",
        period_start: start,
        period_end: start,
        original_value: distance,
        original_unit: "km",
        normalized_value: distance,
        normalized_unit: "pkm",
        country: col("country", opt).toUpperCase(),
        description: `Rail ${col("city", opt)}`.trim(),
        parser_findings: findings
      };

      parsedRows.push(parsed);
      continue;
    }

    parsed.error = `Unknown segment type '${segType}'`;
    parsedRows.push(parsed);
  }

  return { rows: parsedRows, parserNotes: notes };
}
