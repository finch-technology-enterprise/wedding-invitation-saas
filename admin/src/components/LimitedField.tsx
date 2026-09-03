import { Text, Textarea, TextInput } from "@mantine/core";

import { useEditor } from "../routes/InvitationEditor";

/**
 * A text field bound to a manifest-declared config path.
 *
 * Limits come from the theme manifest rather than being restated here, so
 * the admin cannot drift from what the server enforces. The counter is
 * advisory; the server remains authoritative and its errors are shown
 * against the same path.
 */
export function LimitedField({
  path,
  label,
  description,
  placeholder,
}: {
  path: string;
  label: string;
  description?: string;
  placeholder?: string;
}) {
  const { config, manifest, update, fieldErrors } = useEditor();

  const limit = manifest.fieldLimits[path];
  const max = limit?.max;
  const multiline = limit?.multiline === true;

  const parts = path.split(".");
  const value =
    parts.reduce<any>((node, key) => (node == null ? undefined : node[key]), config) ?? "";

  // Count code points: the limits were measured against CJK copy, where
  // UTF-16 length would be misleading.
  const length = [...String(value)].length;
  const over = max !== undefined && length > max;

  const setValue = (next: string) => {
    const patch: Record<string, any> = {};
    let node = patch;
    for (let i = 0; i < parts.length - 1; i++) node = node[parts[i]!] = {};
    node[parts[parts.length - 1]!] = next;
    update(patch);
  };

  const counter =
    max === undefined ? null : (
      <Text component="span" size="xs" c={over ? "red" : "dimmed"}>
        {length} / {max}
      </Text>
    );

  const shared = {
    label,
    description,
    placeholder,
    value: String(value),
    error: fieldErrors[path] ?? (over ? `Too long — ${length} of ${max} characters` : undefined),
    // Description under the field, so the label stays adjacent to the input.
    inputWrapperOrder: ["label", "input", "description", "error"] as Array<
      "label" | "input" | "description" | "error"
    >,
  };

  return (
    <div>
      {multiline ? (
        <Textarea
          {...shared}
          autosize
          minRows={2}
          maxRows={6}
          onChange={(e) => setValue(e.currentTarget.value)}
        />
      ) : (
        <TextInput {...shared} onChange={(e) => setValue(e.currentTarget.value)} />
      )}
      {counter && (
        <Text ta="right" mt={2}>
          {counter}
        </Text>
      )}
    </div>
  );
}

/**
 * A list of short lines (poem stanzas, letter lines). Entry count and
 * per-line length both come from the manifest.
 */
export function LimitedList({
  path,
  label,
  description,
}: {
  path: string;
  label: string;
  description?: string;
}) {
  const { config, manifest, update, fieldErrors } = useEditor();

  const perLine = manifest.fieldLimits[path]?.max;
  const maxItems = manifest.listLimits[path]?.max;

  const parts = path.split(".");
  const current: string[] =
    parts.reduce<any>((node, key) => (node == null ? undefined : node[key]), config) ?? [];

  const setValue = (next: string[]) => {
    const patch: Record<string, any> = {};
    let node = patch;
    for (let i = 0; i < parts.length - 1; i++) node = node[parts[i]!] = {};
    node[parts[parts.length - 1]!] = next;
    update(patch);
  };

  const text = current.join("\n");
  const lines = text.length ? text.split("\n") : [];
  const tooMany = maxItems !== undefined && lines.length > maxItems;
  const tooLong = perLine !== undefined && lines.some((l) => [...l].length > perLine);

  return (
    <div>
      <Textarea
        label={label}
        description={description}
        autosize
        minRows={3}
        maxRows={10}
        value={text}
        error={
          fieldErrors[path] ??
          (tooMany
            ? `Too many lines — limit is ${maxItems}`
            : tooLong
              ? `One line is over the ${perLine}-character limit`
              : undefined)
        }
        onChange={(e) => {
          const raw = e.currentTarget.value;
          setValue(raw.length ? raw.split("\n") : []);
        }}
      />
      <Text ta="right" size="xs" c={tooMany ? "red" : "dimmed"} mt={2}>
        {lines.length}
        {maxItems !== undefined ? ` / ${maxItems}` : ""} lines
        {perLine !== undefined ? ` · ${perLine} chars each` : ""}
      </Text>
    </div>
  );
}
