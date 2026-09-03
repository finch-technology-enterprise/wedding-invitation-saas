import { useParams } from "react-router-dom";
import {
  Alert,
  Button,
  Card,
  CopyButton,
  Group,
  Skeleton,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconCheck, IconCopy, IconEye } from "@tabler/icons-react";

import { useCreatePreview, useInvitation } from "../lib/queries";
import { formatDateTime } from "../lib/format";

export function SharingPanel() {
  const { id = "" } = useParams();
  const invitation = useInvitation(id);
  const createPreview = useCreatePreview(id);

  if (invitation.isLoading) return <Skeleton height={240} />;

  const inv = invitation.data!.invitation;
  const publicUrl = `${window.location.origin}/i/${inv.slug}`;
  const isPublished = inv.status === "published";

  return (
    <Stack maw={720}>
      <Card withBorder padding="md">
        <Title order={5}>Public link</Title>
        <Text size="sm" c="dimmed" mt={4}>
          {isPublished
            ? "Share this with your guests."
            : "This link goes live once you publish the invitation."}
        </Text>

        <Group mt="md" align="flex-end" wrap="nowrap">
          <TextInput readOnly value={publicUrl} style={{ flex: 1 }} aria-label="Public link" />
          <CopyButton value={publicUrl}>
            {({ copied, copy }) => (
              <Button
                variant={copied ? "filled" : "default"}
                color={copied ? "green" : undefined}
                leftSection={copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                onClick={copy}
              >
                {copied ? "Copied" : "Copy"}
              </Button>
            )}
          </CopyButton>
        </Group>

        {!isPublished && (
          <Alert color="yellow" variant="light" mt="md">
            Not published yet — anyone opening this link sees a "not found" page.
          </Alert>
        )}
      </Card>

      <Card withBorder padding="md">
        <Title order={5}>Preview link</Title>
        <Text size="sm" c="dimmed" mt={4}>
          A private link to your unpublished draft. Anyone with it can see the invitation without
          signing in, so share it only with people you trust. Links expire after seven days.
        </Text>

        <Button
          mt="md"
          variant="light"
          leftSection={<IconEye size={16} />}
          loading={createPreview.isPending}
          onClick={() =>
            createPreview.mutate(undefined, {
              onSuccess: async (res) => {
                const url = `${window.location.origin}${res.url}`;
                try {
                  await navigator.clipboard.writeText(url);
                  notifications.show({
                    message: `Preview link copied · expires ${formatDateTime(res.expiresAt)}`,
                    color: "green",
                  });
                } catch {
                  // Clipboard can be blocked; opening it is still useful.
                  window.open(url, "_blank", "noopener");
                }
              },
              onError: () =>
                notifications.show({ message: "Could not create a preview link", color: "red" }),
            })
          }
        >
          Create preview link
        </Button>
      </Card>
    </Stack>
  );
}
