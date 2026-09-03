/**
 * RSVP form schema and submission validation.
 *
 * Hybrid model: the fields every wedding needs (name, attending, guest
 * count, contact) are first-class columns so reporting is a query rather
 * than a JSON scan, while tenant-defined questions live in the normalized
 * rsvp_fields / rsvp_answers tables.
 *
 * Custom fields carry stable opaque IDs. Renaming a label must never
 * invalidate historical answers, so answers reference the field row, not
 * its text.
 */

export const BUILT_IN_KEYS = [
  "name",
  "attending",
  "guests",
  "phone",
  "email",
  "instagram",
  "message",
] as const;

export type BuiltInKey = (typeof BUILT_IN_KEYS)[number];

export const CUSTOM_KINDS = ["text", "textarea", "number", "select", "radio", "checkbox"] as const;
export type CustomKind = (typeof CUSTOM_KINDS)[number];

/**
 * Fields whose semantics the platform depends on. Labels, visibility and
 * required-ness may be tuned; the machine key never changes, because
 * attendance drives reporting and guest count drives totals.
 */
const LOCKED_VISIBLE = new Set<BuiltInKey>(["name", "attending"]);

/**
 * Theme capacity.
 *
 * The cinematic RSVP scene occupies one full frame. Its default schema
 * fits exactly; beyond that the optional block grows and the scene must
 * grow with it. Six custom questions is the point where the form still
 * reads as an invitation rather than a survey, so it is the contract:
 * the theme guarantees layout integrity up to this number, and the
 * platform refuses more.
 */
export const MAX_CUSTOM_FIELDS = 6;

const MAX_OPTIONS = 12;
const MAX_LABEL = 40;
const MAX_OPTION_LABEL = 40;
const MAX_TEXT_ANSWER = 500;

export interface FieldDefinition {
  id: string;
  key: string;
  kind: BuiltInKey | CustomKind;
  label: string;
  required: boolean;
  position: number;
  /** Built-ins may be hidden; custom fields exist only when visible. */
  enabled: boolean;
  options?: Array<{ value: string; label: string }>;
  builtIn: boolean;
}

export interface FormDefinition {
  enabled: boolean;
  deadlineAt: number | null;
  guestLimit: number;
  successTitle: string | null;
  successBody: string | null;
  fields: FieldDefinition[];
}

export interface FieldError {
  path: string;
  code: string;
  limit?: number;
}

// ------------------------------------------------------- schema validation

function labelProblem(label: unknown, path: string, errors: FieldError[]): string | null {
  if (typeof label !== "string" || !label.trim()) {
    errors.push({ path, code: "label_required" });
    return null;
  }
  if ([...label].length > MAX_LABEL) {
    errors.push({ path, code: "label_too_long", limit: MAX_LABEL });
    return null;
  }
  return label.trim();
}

/**
 * Validate an admin-supplied form definition.
 *
 * Built-in fields keep their keys; custom fields are assigned stable IDs
 * by the caller if they do not already have one.
 */
export function validateFormDefinition(input: unknown): {
  ok: boolean;
  errors: FieldError[];
  form?: FormDefinition;
} {
  const errors: FieldError[] = [];

  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, errors: [{ path: "", code: "expected_object" }] };
  }
  const raw = input as Record<string, any>;

  const guestLimit = Number(raw.guestLimit ?? 12);
  if (!Number.isInteger(guestLimit) || guestLimit < 1 || guestLimit > 50) {
    errors.push({ path: "guestLimit", code: "out_of_range" });
  }

  let deadlineAt: number | null = null;
  if (raw.deadlineAt !== null && raw.deadlineAt !== undefined && raw.deadlineAt !== "") {
    const parsed = typeof raw.deadlineAt === "number" ? raw.deadlineAt : Date.parse(raw.deadlineAt);
    if (!Number.isFinite(parsed)) errors.push({ path: "deadlineAt", code: "invalid_datetime" });
    else deadlineAt = parsed;
  }

  const rawFields = Array.isArray(raw.fields) ? raw.fields : [];
  const fields: FieldDefinition[] = [];
  const seenKeys = new Set<string>();
  let customCount = 0;

  rawFields.forEach((entry: any, index: number) => {
    const path = `fields[${index}]`;
    if (typeof entry !== "object" || entry === null) {
      errors.push({ path, code: "expected_object" });
      return;
    }

    const kind = entry.kind;
    const builtIn = (BUILT_IN_KEYS as readonly string[]).includes(kind);
    const custom = (CUSTOM_KINDS as readonly string[]).includes(kind);

    if (!builtIn && !custom) {
      errors.push({ path: `${path}.kind`, code: "unknown_field_kind" });
      return;
    }

    const key = builtIn ? kind : String(entry.key ?? "");
    if (!builtIn && !/^[a-z][a-z0-9_]{0,30}$/.test(key)) {
      errors.push({ path: `${path}.key`, code: "invalid_key" });
      return;
    }
    if (seenKeys.has(key)) {
      errors.push({ path: `${path}.key`, code: "duplicate_key" });
      return;
    }
    seenKeys.add(key);

    const label = labelProblem(entry.label, `${path}.label`, errors);
    if (label === null) return;

    // Name and attendance identify and classify a response; hiding them
    // would break reporting, so visibility is not negotiable for them.
    const enabled = builtIn && LOCKED_VISIBLE.has(kind as BuiltInKey) ? true : entry.enabled !== false;
    const required =
      builtIn && LOCKED_VISIBLE.has(kind as BuiltInKey) ? true : entry.required === true;

    let options: FieldDefinition["options"];
    if (kind === "select" || kind === "radio" || kind === "checkbox") {
      const rawOptions = Array.isArray(entry.options) ? entry.options : [];
      if (!rawOptions.length) {
        errors.push({ path: `${path}.options`, code: "options_required" });
        return;
      }
      if (rawOptions.length > MAX_OPTIONS) {
        errors.push({ path: `${path}.options`, code: "too_many_options", limit: MAX_OPTIONS });
        return;
      }
      const values = new Set<string>();
      options = [];
      for (let i = 0; i < rawOptions.length; i++) {
        const opt = rawOptions[i];
        const optLabel = typeof opt === "string" ? opt : opt?.label;
        // Stable value, so renaming an option label does not orphan
        // answers already recorded against it.
        const optValue = typeof opt === "string" ? opt : (opt?.value ?? optLabel);

        if (typeof optLabel !== "string" || !optLabel.trim()) {
          errors.push({ path: `${path}.options[${i}]`, code: "option_empty" });
          return;
        }
        if ([...optLabel].length > MAX_OPTION_LABEL) {
          errors.push({
            path: `${path}.options[${i}]`,
            code: "option_too_long",
            limit: MAX_OPTION_LABEL,
          });
          return;
        }
        if (values.has(String(optValue))) {
          errors.push({ path: `${path}.options[${i}]`, code: "duplicate_option" });
          return;
        }
        values.add(String(optValue));
        options.push({ value: String(optValue), label: optLabel.trim() });
      }
    }

    if (custom && enabled) customCount++;

    fields.push({
      id: typeof entry.id === "string" && entry.id ? entry.id : "",
      key,
      kind,
      label,
      required,
      enabled,
      position: fields.length,
      builtIn,
      ...(options ? { options } : {}),
    });
  });

  if (customCount > MAX_CUSTOM_FIELDS) {
    errors.push({ path: "fields", code: "too_many_fields", limit: MAX_CUSTOM_FIELDS });
  }

  // Name and attendance must exist even if the client omitted them.
  for (const required of LOCKED_VISIBLE) {
    if (!seenKeys.has(required)) {
      errors.push({ path: `fields.${required}`, code: "field_required" });
    }
  }

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    errors: [],
    form: {
      enabled: raw.enabled !== false,
      deadlineAt,
      guestLimit,
      successTitle: typeof raw.successTitle === "string" ? raw.successTitle.slice(0, 80) : null,
      successBody: typeof raw.successBody === "string" ? raw.successBody.slice(0, 200) : null,
      fields,
    },
  };
}

// --------------------------------------------------- submission validation

export interface ParsedSubmission {
  contactName: string;
  attending: number | null;
  guestCount: number;
  contactPhone: string | null;
  contactEmail: string | null;
  contactInstagram: string | null;
  /** fieldId → one or more values (checkbox yields several). */
  answers: Array<{ fieldId: string; values: string[] }>;
}

const PHONE_RE = /^\+?[0-9 ()-]{8,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const IG_RE = /^@?[A-Za-z0-9._]{1,30}$/;

/**
 * Validate a guest submission against the PUBLISHED form definition.
 *
 * The schema is supplied by the caller from the published revision, never
 * read from the mutable draft: a guest must be judged against the form
 * they were actually shown.
 */
export function validateSubmission(
  body: unknown,
  form: FormDefinition,
  now: number
): { ok: boolean; errors: FieldError[]; value?: ParsedSubmission } {
  const errors: FieldError[] = [];

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, errors: [{ path: "", code: "invalid_body" }] };
  }
  const raw = body as Record<string, any>;

  if (!form.enabled) return { ok: false, errors: [{ path: "", code: "rsvp_disabled" }] };
  if (form.deadlineAt !== null && now > form.deadlineAt) {
    return { ok: false, errors: [{ path: "", code: "rsvp_closed" }] };
  }

  const visible = form.fields.filter((f) => f.enabled);
  const byKey = new Map(visible.map((f) => [f.key, f]));

  // Unknown keys are rejected rather than ignored, so a client cannot
  // probe for fields or smuggle data into an unpublished question.
  const reserved = new Set(["website", "answers"]);
  for (const key of Object.keys(raw)) {
    if (reserved.has(key)) continue;
    if (!byKey.has(key)) errors.push({ path: key, code: "unknown_field" });
  }

  // --- built-ins ---
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) errors.push({ path: "name", code: "required" });
  else if ([...name].length > 80) errors.push({ path: "name", code: "too_long", limit: 80 });

  let attending: number | null = null;
  if (typeof raw.attending === "boolean") attending = raw.attending ? 1 : 0;
  else if (raw.attending === "yes") attending = 1;
  else if (raw.attending === "no") attending = 0;
  else errors.push({ path: "attending", code: "required" });

  let guestCount = 1;
  if (raw.guests !== undefined && raw.guests !== null && raw.guests !== "") {
    const n = Number(raw.guests);
    if (!Number.isInteger(n) || n < 1) errors.push({ path: "guests", code: "invalid" });
    else if (n > form.guestLimit) {
      errors.push({ path: "guests", code: "over_limit", limit: form.guestLimit });
    } else guestCount = n;
  }
  // A decline is one person's regret, not a party of six.
  if (attending === 0) guestCount = 1;

  const optionalText = (key: string, re: RegExp, max: number): string | null => {
    const value = raw[key];
    if (value === undefined || value === null || value === "") return null;
    const str = String(value).trim();
    if (!str) return null;
    if (str.length > max || !re.test(str)) {
      errors.push({ path: key, code: "invalid" });
      return null;
    }
    return str;
  };

  const phone = byKey.has("phone") ? optionalText("phone", PHONE_RE, 20) : null;
  const email = byKey.has("email") ? optionalText("email", EMAIL_RE, 254) : null;
  const instagram = byKey.has("instagram") ? optionalText("instagram", IG_RE, 31) : null;

  for (const field of visible) {
    if (!field.required || field.builtIn === false) continue;
    if (field.key === "phone" && !phone) errors.push({ path: "phone", code: "required" });
    if (field.key === "email" && !email) errors.push({ path: "email", code: "required" });
    if (field.key === "instagram" && !instagram) {
      errors.push({ path: "instagram", code: "required" });
    }
  }

  // --- custom answers ---
  const answers: ParsedSubmission["answers"] = [];
  for (const field of visible) {
    if (field.builtIn) continue;

    const value = raw[field.key];
    const missing = value === undefined || value === null || value === "";

    if (missing) {
      if (field.required) errors.push({ path: field.key, code: "required" });
      continue;
    }

    if (field.kind === "checkbox") {
      const list = Array.isArray(value) ? value : [value];
      const allowed = new Set((field.options ?? []).map((o) => o.value));
      const picked: string[] = [];
      for (const entry of list) {
        const str = String(entry);
        if (!allowed.has(str)) {
          errors.push({ path: field.key, code: "invalid_option" });
          break;
        }
        if (!picked.includes(str)) picked.push(str);
      }
      if (picked.length) answers.push({ fieldId: field.id, values: picked });
      continue;
    }

    if (field.kind === "select" || field.kind === "radio") {
      const str = String(value);
      const allowed = new Set((field.options ?? []).map((o) => o.value));
      if (!allowed.has(str)) errors.push({ path: field.key, code: "invalid_option" });
      else answers.push({ fieldId: field.id, values: [str] });
      continue;
    }

    if (field.kind === "number") {
      const n = Number(value);
      if (!Number.isFinite(n)) errors.push({ path: field.key, code: "invalid" });
      else answers.push({ fieldId: field.id, values: [String(n)] });
      continue;
    }

    // text / textarea
    const str = String(value).trim();
    const max = field.kind === "textarea" ? MAX_TEXT_ANSWER : 200;
    if ([...str].length > max) errors.push({ path: field.key, code: "too_long", limit: max });
    else if (str) answers.push({ fieldId: field.id, values: [str] });
  }

  // The message field is a built-in textarea rather than a custom answer.
  let message: string | null = null;
  if (byKey.has("message") && typeof raw.message === "string") {
    message = raw.message.trim().slice(0, MAX_TEXT_ANSWER) || null;
    if ([...String(raw.message)].length > MAX_TEXT_ANSWER) {
      errors.push({ path: "message", code: "too_long", limit: MAX_TEXT_ANSWER });
    }
  }
  if (message) {
    const field = byKey.get("message");
    if (field?.id) answers.push({ fieldId: field.id, values: [message] });
  }

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    errors: [],
    value: {
      contactName: name,
      attending,
      guestCount,
      contactPhone: phone,
      contactEmail: email,
      contactInstagram: instagram,
      answers,
    },
  };
}

/** The default schema: exactly the frozen cinematic form. */
export function defaultFormDefinition(): FormDefinition {
  const field = (
    kind: BuiltInKey,
    label: string,
    required: boolean,
    position: number
  ): FieldDefinition => ({
    id: "",
    key: kind,
    kind,
    label,
    required,
    enabled: true,
    position,
    builtIn: true,
  });

  return {
    enabled: true,
    deadlineAt: null,
    guestLimit: 12,
    successTitle: null,
    successBody: null,
    fields: [
      field("name", "姓名", true, 0),
      field("attending", "是否出席", true, 1),
      field("guests", "出席人数", false, 2),
      field("phone", "电话号码", false, 3),
      field("instagram", "Instagram", false, 4),
      field("message", "祝福留言", false, 5),
    ],
  };
}
