import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  Group,
  Menu,
  Pagination,
  SegmentedControl,
  Skeleton,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { IconDots, IconSearch } from "@tabler/icons-react";

import { useRevokeSessions, useSetUserStatus, useUsers } from "./queries";
import { formatBytes, formatDate } from "../lib/format";

const PAGE_SIZE = 25;

export function UsersView() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");

  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String((page - 1) * PAGE_SIZE),
  });
  if (status !== "all") params.set("status", status);
  if (search) params.set("q", search);

  const users = useUsers(params);
  const setUserStatus = useSetUserStatus();
  const revoke = useRevokeSessions();

  if (users.isLoading) return <Skeleton height={320} />;
  const pages = Math.max(1, Math.ceil((users.data?.total ?? 0) / PAGE_SIZE));

  return (
    <Stack>
      <Title order={2}>Users</Title>

      <Group>
        <TextInput
          placeholder="Search email or name"
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={(e) => {
            setSearch(e.currentTarget.value);
            setPage(1);
          }}
          style={{ flex: 1 }}
          aria-label="Search users"
        />
        <SegmentedControl
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          data={[
            { label: "All", value: "all" },
            { label: "Active", value: "active" },
            { label: "Disabled", value: "disabled" },
          ]}
        />
      </Group>

      <Card withBorder padding={0}>
        <Table.ScrollContainer minWidth={860}>
          <Table verticalSpacing="sm" highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Email</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Workspaces</Table.Th>
                <Table.Th>Invitations</Table.Th>
                <Table.Th>Storage</Table.Th>
                <Table.Th>Sessions</Table.Th>
                <Table.Th>Created</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(users.data?.users ?? []).map((u) => (
                <Table.Tr key={u.id}>
                  <Table.Td>
                    <Text size="sm">{u.email}</Text>
                    {u.isPlatformAdmin === 1 && (
                      <Badge size="xs" color="violet" variant="light">
                        operator
                      </Badge>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Badge
                      size="sm"
                      variant="light"
                      color={u.status === "active" ? "green" : "red"}
                    >
                      {u.status}
                    </Badge>
                  </Table.Td>
                  <Table.Td>{u.tenantCount}</Table.Td>
                  <Table.Td>{u.invitationCount}</Table.Td>
                  <Table.Td>{formatBytes(u.storageBytes)}</Table.Td>
                  <Table.Td>{u.activeSessions}</Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed">
                      {formatDate(u.createdAt)}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Menu position="bottom-end">
                      <Menu.Target>
                        <Button variant="subtle" size="xs" aria-label={`Actions for ${u.email}`}>
                          <IconDots size={16} />
                        </Button>
                      </Menu.Target>
                      <Menu.Dropdown>
                        {u.status === "active" ? (
                          <Menu.Item
                            color="red"
                            onClick={() =>
                              modals.openConfirmModal({
                                title: "Disable user?",
                                children: (
                                  <Text size="sm">
                                    {u.email} will be signed out everywhere and unable to sign in.
                                    Nothing is deleted.
                                  </Text>
                                ),
                                labels: { confirm: "Disable", cancel: "Cancel" },
                                confirmProps: { color: "red" },
                                onConfirm: () =>
                                  setUserStatus.mutate(
                                    { userId: u.id, status: "disabled" },
                                    {
                                      onSuccess: () =>
                                        notifications.show({ message: "User disabled" }),
                                      onError: () =>
                                        notifications.show({
                                          message: "Could not disable user",
                                          color: "red",
                                        }),
                                    }
                                  ),
                              })
                            }
                          >
                            Disable user
                          </Menu.Item>
                        ) : (
                          <Menu.Item
                            onClick={() =>
                              setUserStatus.mutate({ userId: u.id, status: "active" })
                            }
                          >
                            Enable user
                          </Menu.Item>
                        )}
                        <Menu.Item onClick={() => revoke.mutate(u.id)}>
                          Revoke all sessions
                        </Menu.Item>
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
