import { useParams } from "react-router-dom";
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  List,
  Skeleton,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { modals } from "@mantine/modals";
import { IconWorld, IconWorldOff } from "@tabler/icons-react";

import { useEditor } from "./InvitationEditor";
import { useDiff, useInvitation, usePublish, useUnpublish } from "../lib/queries";
import { ApiError } from "../lib/api";
import { formatDateTime } from "../lib/format";

const SECTION_LABELS: Record<string, string> = {
  couple: "Names",
  date: "Date and time",
  copy: "Copy",
  venue: "Venue",
  rsvp: "RSVP settings",
  music: "Music",
  motion: "Motion",
  everything: "Everything (first publish)",
};

export function PublishPanel() {
  const { id = "" } = useParams();
  const { dirty } = useEditor();
  const invitation = useInvitation(id);
  const diff = useDiff(id);
  const publish = usePublish(id);
  const unpublish = useUnpublish(id);

  if (invitation.isLoading || diff.isLoading) return <Skeleton height={280} />;

  const inv = invitation.data!.invitation;
  const isPublished = inv.status === "published";
  const publicUrl = `${window.location.origin}/i/${inv.slug}`;

  const doPublish = () =>
    publish.mutate(undefined, {
      onSuccess: () => notifications.show({ message: "Invitation published", color: "green" }),
      onError: (err) => {
        const validation = err instanceof ApiError && err.payload.errors?.length;
        notifications.show({
          title: "Could not publish",
          message: validation
            ? "Some content is not valid. Check the Content and Media tabs."
            : "Please try again.",
          color: "red",
        });
      },
    });

  return (
    <Stack maw={720}>
      <Card withBorder padding="md">
        <Group justify="space-between" align="flex-start">
          <div>
            <Group gap="xs">
              <Title order={5}>{isPublished ? "Live" : "Not published"}</Title>
              <Badge color={isPublished ? "green" : "gray"} variant="light">
                {inv.status}
              </Badge>
            </Group>
            <Text size="sm" c="dimmed" mt={4}>
              {isPublished
                ? `Last published ${formatDateTime(inv.publishedAt)}`
                : "Guests cannot see this invitation yet."}
            </Text>
            {isPublished && (
              <Text size="sm" mt={4}>
                <a href={publicUrl} target="_blank" rel="noopener">
                  {publicUrl}
                </a>
              </Text>
            )}
          </div>

          {isPublished && (
            <Button
              variant="default"
              leftSection={<IconWorldOff size={16} />}
              onClick={() =>
                modals.openConfirmModal({
                  title: "Unpublish invitation?",
                  children: (
                    <Text size="sm">
                      Guests visiting the link will no longer see it. Nothing is deleted — your
                      draft, media and history are kept, and you can publish again at any time.
                    </Text>
                  ),
                  labels: { confirm: "Unpublish", cancel: "Cancel" },
                  confirmProps: { color: "red" },
                  onConfirm: () => unpublish.mutate(),
                })
              }
            >
              Unpublish
            </Button>
          )}
        </Group>
      </Card>

      {dirty && (
        <Alert color="orange" variant="light">
          You have unsaved edits. Save the draft before publishing, or they will not be included.
        </Alert>
      )}

      <Card withBorder padding="md">
        <Title order={5}>What publishing will change</Title>

        {!diff.data?.hasChanges ? (
          <Text size="sm" c="dimmed" mt="sm">
            The draft matches what is live. Publishing again would create a new version with the
            same content.
          </Text>
        ) : (
          <Stack mt="sm" gap="xs">
            {diff.data.changed.length > 0 && (
              <div>
                <Text size="sm" fw={600}>
                  Content
                </Text>
                <List size="sm" c="dimmed">
                  {diff.data.changed.map((s) => (
                    <List.Item key={s}>{SECTION_LABELS[s] ?? s}</List.Item>
                  ))}
                </List>
              </div>
            )}
            {diff.data.mediaChanged.length > 0 && (
              <div>
                <Text size="sm" fw={600}>
                  Media
                </Text>
                <List size="sm" c="dimmed">
                  {diff.data.mediaChanged.map((s) => (
                    <List.Item key={s}>{s}</List.Item>
                  ))}
                </List>
              </div>
            )}
          </Stack>
        )}

        <Button
          mt="lg"
          leftSection={<IconWorld size={16} />}
          onClick={doPublish}
          loading={publish.isPending}
          disabled={dirty}
        >
          {isPublished ? "Publish changes" : "Publish invitation"}
        </Button>
      </Card>

      <Alert variant="light" color="gray">
        <Text size="sm">
          Each publish creates a new version. The previous one is kept exactly as guests saw it,
          so nothing you have shared changes retroactively.
        </Text>
      </Alert>
    </Stack>
  );
}
