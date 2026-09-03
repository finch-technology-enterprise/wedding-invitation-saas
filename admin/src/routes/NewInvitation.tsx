import { useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { useForm } from "@mantine/form";
import {
  Alert,
  Button,
  Card,
  Group,
  Radio,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";

import type { ShellContext } from "../components/Shell";
import { useCreateInvitation } from "../lib/queries";
import { ApiError } from "../lib/api";

/**
 * Theme catalogue.
 *
 * One theme exists today. The chooser is a list rather than a hardcoded
 * constant so adding Theme #2 is a data change, not a rewrite of this
 * flow — but no fake themes are invented to make the list look fuller.
 */
const THEMES = [
  {
    id: "cinematic-classic",
    name: "Cinematic Classic",
    description:
      "A slow vertical film: full-bleed photography, Chinese typography and a countdown that ends on the RSVP.",
  },
];

/** Mirrors the server rule so the user is told before a round trip. */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function messageFor(error: unknown): string {
  if (!(error instanceof ApiError)) return "Could not create the invitation.";
  switch (error.payload.error) {
    case "slug_taken":
      return "That link is already in use. Try another.";
    case "slug_reserved":
      return "That link is reserved. Try another.";
    case "invalid_slug":
      return "Links may use lowercase letters, numbers and hyphens.";
    case "invalid_slug_length":
      return "Links must be between 3 and 60 characters.";
    case "quota_invitations":
      return "You have reached your plan's invitation limit.";
    default:
      return "Could not create the invitation.";
  }
}

export function NewInvitation() {
  const { tenantId } = useOutletContext<ShellContext>();
  const navigate = useNavigate();
  const create = useCreateInvitation(tenantId);
  const [error, setError] = useState<string | null>(null);
  const [slugTouched, setSlugTouched] = useState(false);

  const form = useForm({
    initialValues: { title: "", slug: "", themeId: THEMES[0]!.id },
    validate: {
      title: (v) => (v.trim().length ? null : "Give the invitation a name"),
      slug: (v) =>
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v) && v.length >= 3
          ? null
          : "Lowercase letters, numbers and hyphens; at least 3 characters",
    },
  });

  const submit = form.onSubmit((values) => {
    setError(null);
    create.mutate(values, {
      onSuccess: (res) => navigate(`/invitations/${res.invitationId}/content`),
      onError: (err) => setError(messageFor(err)),
    });
  });

  return (
    <Stack maw={640}>
      <Title order={2}>New invitation</Title>

      {error && (
        <Alert color="red" variant="light" role="alert">
          {error}
        </Alert>
      )}

      <form onSubmit={submit} noValidate>
        <Stack>
          <Card withBorder padding="md">
            <TextInput
              label="Name"
              description="Only you see this. It is not shown to guests."
              required
              {...form.getInputProps("title")}
              onChange={(e) => {
                form.setFieldValue("title", e.currentTarget.value);
                // Keep the link in step with the name until the user
                // edits it themselves, then stop interfering.
                if (!slugTouched) form.setFieldValue("slug", slugify(e.currentTarget.value));
              }}
            />
            <TextInput
              mt="md"
              label="Public link"
              required
              leftSection={<Text size="xs" c="dimmed" pl="xs">/i/</Text>}
              leftSectionWidth={40}
              {...form.getInputProps("slug")}
              onChange={(e) => {
                setSlugTouched(true);
                form.setFieldValue("slug", e.currentTarget.value.toLowerCase());
              }}
            />
          </Card>

          <Card withBorder padding="md">
            <Radio.Group
              label="Theme"
              description="Themes decide the layout and motion of the invitation."
              {...form.getInputProps("themeId")}
            >
              <Stack mt="sm" gap="xs">
                {THEMES.map((theme) => (
                  <Radio.Card key={theme.id} value={theme.id} p="md">
                    <Group align="flex-start" wrap="nowrap">
                      <Radio.Indicator />
                      <div>
                        <Text fw={600}>{theme.name}</Text>
                        <Text size="sm" c="dimmed">
                          {theme.description}
                        </Text>
                      </div>
                    </Group>
                  </Radio.Card>
                ))}
              </Stack>
            </Radio.Group>
          </Card>

          <Group justify="flex-end">
            <Button variant="subtle" onClick={() => navigate("/invitations")}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending}>
              Create invitation
            </Button>
          </Group>
        </Stack>
      </form>
    </Stack>
  );
}
