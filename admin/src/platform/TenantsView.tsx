import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  Group,
  Menu,
  Pagination,
  Select,
  Skeleton,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { IconDots } from "@tabler/icons-react";

import { useSetTenantStatus, useTenants } from "./queries";
import { formatBytes, formatDate } from "../lib/format";

const PAGE_SIZE = 25;

const SORTS = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "storage", label: "Largest storage" },
  { value: "invitations", label: "Most invitations" },
  { value: "responses", label: "Most responses" },
];

export function TenantsView() {
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState("newest");

  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String((page - 1) * PAGE_SIZE),
    sort,
  });

  const tenants = useTenants(params);
  const setStatus = useSetTenantStatus();

  if (tenants.isLoading) return <Skeleton height={320} />;
  const pages = Math.max(1, Math.ceil((tenants.data?.total ?? 0) / PAGE_SIZE));

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Workspaces</Title>
        <Select
          data={SORTS}
          value={sort}
          onChange={(v) => {
            if (v) setSort(v);
            setPage(1);
          }}
          w={200}
          allowDeselect={false}
          aria-label="Sort workspaces"
        />
      </Group>

      <Card withBorder padding={0}>
        <Table.ScrollContainer minWidth={900}>
          <Table verticalSpacing="sm" highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Workspace</Table.Th>
                <Table.Th>Owner</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Members</Table.Th>
                <Table.Th>Invitations</Table.Th>
                <Table.Th>Published</Table.Th>
                <Table.Th>Responses</Table.Th>
                <Table.Th>Storage</Table.Th>
                <Table.Th>Created</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(tenants.data?.tenants ?? []).map((t) => (
                <Table.Tr key={t.id}>
                  <Table.Td>
                    <Text size="sm" fw={500}>
                      {t.name}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {t.slug}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs">{t.ownerEmail ?? "—"}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge
                      size="sm"
                      variant="light"
                      color={t.status === "active" ? "green" : "orange"}
                    >
                      {t.status}
                    </Badge>
                  </Table.Td>
                  <Table.Td>{t.memberCount}</Table.Td>
                  <Table.Td>{t.invitationCount}</Table.Td>
                  <Table.Td>{t.publishedCount}</Table.Td>
                  <Table.Td>{t.rsvpCount}</Table.Td>
                  <Table.Td>{formatBytes(t.storageBytes)}</Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed">
                      {formatDate(t.createdAt)}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Menu position="bottom-end">
                      <Menu.Target>
                        <Button variant="subtle" size="xs" aria-label={`Actions for ${t.name}`}>
                          <IconDots size={16} />
                        </Button>
                      </Menu.Target>
                      <Menu.Dropdown>
                        {t.status === "active" ? (
                          <Menu.Item
                            color="orange"
                            onClick={() =>
                              modals.openConfirmModal({
                                title: "Suspend workspace?",
                                children: (
                                  <Text size="sm">
                                    Members lose access until it is unsuspended. Invitations,
                                    media and responses are all kept.
                                  </Text>
                                ),
                                labels: { confirm: "Suspend", cancel: "Cancel" },
                                confirmProps: { color: "orange" },
                                onConfirm: () =>
                                  setStatus.mutate(
                                    { tenantId: t.id, status: "suspended" },
                                    {
                                      onSuccess: () =>
                                        notifications.show({ message: "Workspace suspended" }),
                                    }
                                  ),
                              })
                            }
                          >
                            Suspend
                          </Menu.Item>
                        ) : (
                          <Menu.Item
                            onClick={() => setStatus.mutate({ tenantId: t.id, status: "active" })}
                          >
                            Unsuspend
                          </Menu.Item>
                        )}
                      </Menu.Dropdown>
                    </Menu>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Card>

      {pages > 1 && (
        <Group justify="center">
          <Pagination value={page} onChange={setPage} total={pages} />
        </Group>
      )}
    </Stack>
  );
}
