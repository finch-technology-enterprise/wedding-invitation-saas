import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Group, NumberInput, Skeleton, Stack, Switch, Text, Title } from "@mantine/core";
import { DateTimePicker } from "@mantine/dates";
import { notifications } from "@mantine/notifications";

import { useEditor } from "./InvitationEditor";
import { LimitedField } from "../components/LimitedField";
import { FormBuilder, type BuilderField } from "../components/FormBuilder";
import { api, ApiError } from "../lib/api";

interface FormPayload {
  ok: true;
  form: {
    enabled: boolean;
    deadlineAt: number | null;
    guestLimit: number;
    fields: BuilderField[];
  };
}

/** The theme's declared capacity for extra questions. */
const MAX_CUSTOM_FIELDS = 6;

/** ISO-8601 with explicit offset, matching the theme contract. */
function toIsoWithOffset(date: Date | null): string {
  if (!date) return "";
  const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, "0");
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(offsetMin / 60)}:${pad(offsetMin % 60)}`
  );
}

function fromIso(iso: unknown): Date | null {
  if (typeof iso !== "string" || !iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The reply form: schema, not presentation. */
function FormEditor({ invitationId }: { invitationId: string }) {
  const qc = useQueryClient();
  const [fields, setFields] = useState<BuilderField[] | null>(null);
  const [enabled, setEnabled] = useState(true);

  const query = useQuery({
    queryKey: ["rsvp-form", invitationId],
    queryFn: () => api.get<FormPayload>(`/invitations/${invitationId}/rsvp`),
  });

  useEffect(() => {
    if (!query.data || fields !== null) return;
    setFields(query.data.form.fields);
    setEnabled(query.data.form.enabled);
  }, [query.data, fields]);

  const save = useMutation({
    mutationFn: () =>
      api.put<FormPayload>(`/invitations/${invitationId}/rsvp`, {
        enabled,
        guestLimit: query.data?.form.guestLimit ?? 12,
        deadlineAt: query.data?.form.deadlineAt ?? null,
        // Strip client-side temporary IDs so the server assigns durable
        // ones; existing IDs are sent back to preserve field identity.
        fields: (fields ?? []).map((f) => ({
          ...f,
          id: f.id.startsWith("new-") ? undefined : f.id,
        })),
      }),
    onSuccess: (res) => {
      setFields(res.form.fields);
      void qc.invalidateQueries({ queryKey: ["rsvp-form", invitationId] });
      notifications.show({ message: "Reply form saved", color: "green" });
    },
    onError: (err) => {
      const detail =
        err instanceof ApiError && err.payload.errors?.length
          ? Object.values(err.fieldErrors)[0]
          : undefined;
      notifications.show({
        title: "Could not save the form",
        message: detail ?? "Please check the fields and try again.",
        color: "red",
      });
    },
  });

  if (query.isLoading || fields === null) return <Skeleton height={280} />;

  return (
    <Card withBorder padding="md">
      <Group justify="space-between" align="flex-start">
        <div>
          <Title order={5}>Reply form</Title>
          <Text size="sm" c="dimmed" mt={4}>
            What you collect. How it looks belongs to the theme.
          </Text>
        </div>
        <Switch
          label="Accept replies"
          checked={enabled}
          onChange={(e) => setEnabled(e.currentTarget.checked)}
        />
      </Group>

      <Stack mt="md">
        <FormBuilder fields={fields} maxCustom={MAX_CUSTOM_FIELDS} onChange={setFields} />
        <Group justify="flex-end">
          <Button onClick={() => save.mutate()} loading={save.isPending}>
            Save reply form
          </Button>
        </Group>
      </Stack>

      <Alert variant="light" color="gray" mt="md">
        <Text size="xs">
          Changes take effect for guests when you next publish the invitation. Replies already
          received keep the questions they were asked.
        </Text>
      </Alert>
    </Card>
  );
}

export function RsvpPanel() {
  const { config, update, fieldErrors } = useEditor();
  const { id = "" } = useParams();

  return (
    <Stack maw={720}>
      <FormEditor invitationId={id} />

      <Card withBorder padding="md">
        <Title order={5}>Replies</Title>

        <Stack mt="md">
          <DateTimePicker
            label="Reply by"
            description="Shown on the invitation. Replies are refused after this moment."
            clearable
            value={fromIso(config.rsvp?.deadlineISO)}
            error={fieldErrors["rsvp.deadlineISO"]}
            onChange={(value) =>
              update({ rsvp: { deadlineISO: toIsoWithOffset(value ? new Date(value) : null) } })
            }
          />

          <NumberInput
            label="Maximum guests per reply"
            description="The largest number a guest can choose."
            min={1}
            max={50}
            value={config.rsvp?.maxGuests ?? 12}
            error={fieldErrors["rsvp.maxGuests"]}
            onChange={(v) => update({ rsvp: { maxGuests: Number(v) || 12 } })}
          />
        </Stack>
      </Card>

      <Card withBorder padding="md">
        <Title order={5}>Wording</Title>
        <Text size="sm" c="dimmed" mt={4}>
          The form's labels and messages. Keep them short — the composition was built for it.
        </Text>

        <Stack mt="md">
          <LimitedField path="copy.rsvp.heading" label="Heading" />
          <LimitedField
            path="copy.rsvp.deadlineLabel"
            label="Deadline line"
            description="Use {date} where the reply-by date should appear."
          />
          <LimitedField path="copy.rsvp.attending" label="Attendance question" />
          <LimitedField path="copy.rsvp.yes" label="Accept option" />
          <LimitedField path="copy.rsvp.no" label="Decline option" />
          <LimitedField path="copy.rsvp.guests" label="Guest count label" />
          <LimitedField path="copy.rsvp.message" label="Message label" />
          <LimitedField path="copy.rsvp.submit" label="Submit button" />
          <LimitedField path="copy.rsvp.successTitle" label="Thank-you title" />
          <LimitedField path="copy.rsvp.successBody" label="Thank-you message" />
        </Stack>
      </Card>

      <Alert variant="light" color="gray">
        <Text size="sm">
          The reply form's appearance belongs to the theme. These settings control what it says and
          what it collects, not how it looks.
        </Text>
      </Alert>
    </Stack>
  );
}
