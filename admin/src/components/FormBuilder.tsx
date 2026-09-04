import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Group,
  Menu,
  Stack,
  Switch,
  TagsInput,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { IconGripVertical, IconPlus, IconTrash } from "@tabler/icons-react";

export interface BuilderField {
  id: string;
  key: string;
  kind: string;
  label: string;
  required: boolean;
  enabled: boolean;
  builtIn: boolean;
  options?: Array<{ value: string; label: string }>;
}

/** Fields whose presence the platform depends on for reporting. */
const LOCKED = new Set(["name", "attending"]);

const CUSTOM_KINDS = [
  { value: "text", label: "Short text" },
  { value: "textarea", label: "Long text" },
  { value: "number", label: "Number" },
  { value: "select", label: "Dropdown" },
  { value: "radio", label: "Single choice" },
  { value: "checkbox", label: "Multiple choice" },
];

const NEEDS_OPTIONS = new Set(["select", "radio", "checkbox"]);

function SortableField({
  field,
  onChange,
  onRemove,
}: {
  field: BuilderField;
  onChange: (next: BuilderField) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: field.id,
  });

  const locked = field.builtIn && LOCKED.has(field.key);

  return (
    <Card
      withBorder
      padding="sm"
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
      }}
    >
      <Group align="flex-start" wrap="nowrap">
        <ActionIcon
          variant="subtle"
          c="dimmed"
          {...attributes}
          {...listeners}
          aria-label={`Reorder ${field.label}`}
          style={{ cursor: "grab" }}
        >
          <IconGripVertical size={18} />
        </ActionIcon>

        <Stack gap="xs" style={{ flex: 1 }}>
          <Group wrap="nowrap" align="flex-end">
            <TextInput
              label="Label"
              value={field.label}
              onChange={(e) => onChange({ ...field, label: e.currentTarget.value })}
              style={{ flex: 1 }}
            />
            <Badge variant="light" size="sm" mb={6}>
              {field.builtIn ? field.key : (CUSTOM_KINDS.find((k) => k.value === field.kind)?.label ?? field.kind)}
            </Badge>
          </Group>

          {NEEDS_OPTIONS.has(field.kind) && (
            <TagsInput
              label="Options"
              description="Press Enter after each option."
              value={(field.options ?? []).map((o) => o.label)}
              onChange={(labels) =>
                onChange({
                  ...field,
                  // Keep existing values so renaming an option label does
                  // not orphan answers already recorded against it.
                  options: labels.map((label) => {
                    const existing = field.options?.find((o) => o.label === label);
                    return { value: existing?.value ?? label, label };
                  }),
                })
              }
            />
          )}

          <Group gap="lg">
            <Switch
              size="xs"
              label="Required"
              checked={field.required}
              disabled={locked}
              onChange={(e) => onChange({ ...field, required: e.currentTarget.checked })}
            />
            {field.builtIn && (
              <Tooltip
                label={locked ? "Needed to identify and count replies" : ""}
                disabled={!locked}
              >
                <Switch
                  size="xs"
                  label="Shown"
                  checked={field.enabled}
                  disabled={locked}
                  onChange={(e) => onChange({ ...field, enabled: e.currentTarget.checked })}
                />
              </Tooltip>
            )}
          </Group>
        </Stack>

        {!field.builtIn && (
          <ActionIcon
            variant="subtle"
            color="red"
            onClick={onRemove}
            aria-label={`Remove ${field.label}`}
          >
            <IconTrash size={16} />
          </ActionIcon>
        )}
      </Group>
    </Card>
  );
}

export function FormBuilder({
  fields,
  maxCustom,
  onChange,
}: {
  fields: BuilderField[];
  maxCustom: number;
  onChange: (next: BuilderField[]) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    // Keyboard sorting, so reordering does not require a pointer.
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const customCount = fields.filter((f) => !f.builtIn).length;

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = fields.findIndex((f) => f.id === active.id);
    const to = fields.findIndex((f) => f.id === over.id);
    onChange(arrayMove(fields, from, to));
  };

  const addField = (kind: string) => {
    // Client-side temporary ids/keys; the server assigns the durable ones.
    // crypto.randomUUID with a fallback (non-secure contexts).
    const uuid = (() => {
      try {
        return crypto.randomUUID();
      } catch {
        return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
      }
    })();
    const id = `new-${uuid}`;
    const key = `q_${uuid.replace(/-/g, "").slice(0, 8)}`;
    onChange([
      ...fields,
      {
        id,
        key,
        kind,
        label: CUSTOM_KINDS.find((k) => k.value === kind)?.label ?? "Question",
        required: false,
        enabled: true,
        builtIn: false,
        ...(NEEDS_OPTIONS.has(kind) ? { options: [] } : {}),
      },
    ]);
  };

  return (
    <Stack>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis]}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={fields.map((f) => f.id)} strategy={verticalListSortingStrategy}>
          <Stack gap="xs">
            {fields.map((field) => (
              <SortableField
                key={field.id}
                field={field}
                onChange={(next) => onChange(fields.map((f) => (f.id === field.id ? next : f)))}
                onRemove={() => onChange(fields.filter((f) => f.id !== field.id))}
              />
            ))}
          </Stack>
        </SortableContext>
      </DndContext>

      <Group justify="space-between">
        <Menu>
          <Menu.Target>
            <Button
              variant="light"
              leftSection={<IconPlus size={16} />}
              disabled={customCount >= maxCustom}
            >
              Add question
            </Button>
          </Menu.Target>
          <Menu.Dropdown>
            {CUSTOM_KINDS.map((kind) => (
              <Menu.Item key={kind.value} onClick={() => addField(kind.value)}>
                {kind.label}
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>

        <Text size="xs" c={customCount >= maxCustom ? "red" : "dimmed"}>
          {customCount} / {maxCustom} extra questions
        </Text>
      </Group>

      {customCount >= maxCustom && (
        <Text size="xs" c="dimmed">
          This theme's reply scene is designed to hold {maxCustom} extra questions and still read as
          an invitation rather than a survey.
        </Text>
      )}
    </Stack>
  );
}
