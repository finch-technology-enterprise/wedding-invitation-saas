import { Link, useOutletContext } from "react-router-dom";
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  CopyButton,
  Group,
  Skeleton,
  Stack,
  Table,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { IconCheck, IconCopy, IconExternalLink, IconPlus } from "@tabler/icons-react";

import type { ShellContext } from "../components/Shell";
import { useInvitations } from "../lib/queries";
import { formatBytes, STATUS_COLOR, timeAgo } from "../lib/format";

export function InvitationList() {
  const { tenantId } = useOutletContext<ShellContext>();
  const invitations = useInvitations(tenantId);

  if (invitations.isLoading) return <Skeleton height={280} />;
  const list = invitations.data?.invitations ?? [];

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Invitations</Title>
        <Button component={Link} to="/invitations/new" leftSection={<IconPlus size={16} />}>
          New invitation
        </Button>
      </Group>

      <Card withBorder padding={0}>
        <Table.ScrollContainer minWidth={720}>
          <Table highlightOnHover verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Title</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Updated</Table.Th>
                <Table.Th>Published</Table.Th>
                <Table.Th>Media</Table.Th>
                <Table.Th>Responses</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {list.map((inv) => {
                const publicUrl = `${window.location.origin}/i/${inv.slug}`;
                return (
                  <Table.Tr key={inv.id}>
                    <Table.Td>
                      <Text component={Link} to={`/invitations/${inv.id}`} fw={600} size="sm">
                        {inv.title}
                      </Text>
                      <Text size="xs" c="dimmed">
                        /i/{inv.slug} · {inv.themeId}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge color={STATUS_COLOR[inv.status]} variant="light" size="sm">
                        {inv.status}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{timeAgo(inv.updatedAt)}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{timeAgo(inv.publishedAt)}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{formatBytes(inv.mediaBytes)}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{inv.rsvpCount}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4} justify="flex-end" wrap="nowrap">
                        {inv.status === "published" && (
                          <>
                            <CopyButton value={publicUrl}>
                              {({ copied, copy }) => (
                                <Tooltip label={copied ? "Copied" : "Copy public link"}>
                                  <ActionIcon
                                    variant="subtle"
                                    onClick={copy}
                                    aria-label="Copy public link"
                                  >
                                    {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                                  </ActionIcon>
                                </Tooltip>
                              )}
                            </CopyButton>
                            <Tooltip label="Open public invitation">
                              <ActionIcon
                                variant="subtle"
                                component="a"
                                href={publicUrl}
                                target="_blank"
                                rel="noopener"
                                aria-label="Open public invitation"
                              >
                                <IconExternalLink size={16} />
                              </ActionIcon>
                            </Tooltip>
                          </>
                        )}
                        <Button
                          component={Link}
                          to={`/invitations/${inv.id}`}
                          size="xs"
                          variant="light"
                        >
                          Edit
                        </Button>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
              {!list.length && (
                <Table.Tr>
                  <Table.Td colSpan={7}>
                    <Text c="dimmed" ta="center" py="lg">
                      No invitations yet.
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Card>
    </Stack>
  );
}
