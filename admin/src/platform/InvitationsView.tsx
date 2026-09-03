import { useState } from "react";
import {
  Badge,
  Card,
  Checkbox,
  Group,
  Pagination,
  Select,
  Skeleton,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconSearch } from "@tabler/icons-react";

import { useInvitations } from "./queries";
import { formatBytes, formatDate, STATUS_COLOR, timeAgo } from "../lib/format";

const PAGE_SIZE = 25;

const SORTS = [
  { value: "newest", label: "Newest created" },
  { value: "oldest", label: "Oldest created" },
  { value: "stale", label: "Least recently updated" },
  { value: "updated", label: "Recently updated" },
  { value: "storage", label: "Largest storage" },
  { value: "media", label: "Most media" },
  { value: "responses", label: "Most responses" },
];

const STATUSES = [
  { value: "", label: "Any status" },
  { value: "draft", label: "Draft" },
  { value: "published", label: "Published" },
  { value: "unpublished", label: "Unpublished" },
  { value: "disabled", label: "Disabled" },
  { value: "delete_failed", label: "Delete failed" },
];

/**
 * The platform invitation inventory.
 *
 * Sorting and filtering are server-side; the browser never receives more
 * than a page. Also the selection surface the cleanup view builds on.
 */
export function InvitationsView({
  selectable = false,
  selected,
  onSelectedChange,
}: {
  selectable?: boolean;
  selected?: string[];
  onSelectedChange?: (next: string[]) => void;
}) {
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState("newest");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [noRsvp, setNoRsvp] = useState(false);

  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String((page - 1) * PAGE_SIZE),
    sort,
  });
  if (status) params.set("status", status);
  if (search) params.set("q", search);
  if (noRsvp) params.set("noRsvp", "true");

  const invitations = useInvitations(params);
  if (invitations.isLoading) return <Skeleton height={320} />;

  const rows = invitations.data?.invitations ?? [];
  const pages = Math.max(1, Math.ceil((invitations.data?.total ?? 0) / PAGE_SIZE));
  const selectedSet = new Set(selected ?? []);

  const toggle = (id: string) => {
    if (!onSelectedChange) return;
    const next = new Set(selectedSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectedChange([...next]);
  };

  const pageIds = rows.map((r) => r.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selectedSet.has(id));

  return (
    <Stack>
      {!selectable && <Title order={2}>Invitations</Title>}

      <Group align="flex-end" wrap="wrap">
        <TextInput
          placeholder="Search title or link"
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={(e) => {
            setSearch(e.currentTarget.value);
            setPage(1);
          }}
          style={{ flex: 1, minWidth: 200 }}
          aria-label="Search invitations"
        />
        <Select
          data={SORTS}
          value={sort}
          onChange={(v) => {
            if (v) setSort(v);
            setPage(1);
          }}
          w={210}
          allowDeselect={false}
          aria-label="Sort"
        />
        <Select
          data={STATUSES}
          value={status}
          onChange={(v) => {
            setStatus(v ?? "");
            setPage(1);
          }}
          w={160}
          aria-label="Status filter"
        />
        <Checkbox
          label="No responses"
          checked={noRsvp}
          onChange={(e) => {
            setNoRsvp(e.currentTarget.checked);
            setPage(1);
          }}
        />
      </Group>

      <Card withBorder padding={0}>
        <Table.ScrollContainer minWidth={1000}>
          <Table verticalSpacing="sm" highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                {selectable && (
                  <Table.Th w={40}>
                    <Checkbox
                      aria-label="Select all on this page"
                      checked={allOnPage}
                      onChange={() => {
                        if (!onSelectedChange) return;
                        const next = new Set(selectedSet);
                        if (allOnPage) pageIds.forEach((id) => next.delete(id));
                        else pageIds.forEach((id) => next.add(id));
                        onSelectedChange([...next]);
                      }}
                    />
                  </Table.Th>
                )}
                <Table.Th>Invitation</Table.Th>
                <Table.Th>Workspace</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Created</Table.Th>
                <Table.Th>Updated</Table.Th>
                <Table.Th>Rev</Table.Th>
                <Table.Th>Media</Table.Th>
                <Table.Th>Storage</Table.Th>
                <Table.Th>Replies</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((inv) => (
                <Table.Tr key={inv.id}>
                  {selectable && (
                    <Table.Td>
                      <Checkbox
                        aria-label={`Select ${inv.title}`}
                        checked={selectedSet.has(inv.id)}
                        onChange={() => toggle(inv.id)}
                      />
                    </Table.Td>
                  )}
                  <Table.Td>
                    <Text size="sm" fw={500}>
                      {inv.title}
                    </Text>
                    <Text size="xs" c="dimmed">
                      /i/{inv.slug} · {inv.themeId}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs">{inv.tenantName}</Text>
                    <Text size="xs" c="dimmed">
                      {inv.ownerEmail ?? "—"}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge size="sm" variant="light" color={STATUS_COLOR[inv.status] ?? "gray"}>
                      {inv.status}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed">
                      {formatDate(inv.createdAt)}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed">
                      {timeAgo(inv.updatedAt)}
                    </Text>
                  </Table.Td>
                  <Table.Td>{inv.revisionCount}</Table.Td>
                  <Table.Td>{inv.mediaCount}</Table.Td>
                  <Table.Td>{formatBytes(inv.storageBytes)}</Table.Td>
                  <Table.Td>{inv.rsvpCount}</Table.Td>
                </Table.Tr>
              ))}
              {!rows.length && (
                <Table.Tr>
                  <Table.Td colSpan={selectable ? 10 : 9}>
                    <Text ta="center" c="dimmed" py="xl">
                      Nothing matches these filters.
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Card>

      <Group justify="space-between">
        <Text size="xs" c="dimmed">
          {invitations.data?.total ?? 0} total
        </Text>
        {pages > 1 && <Pagination value={page} onChange={setPage} total={pages} />}
      </Group>
    </Stack>
  );
}
