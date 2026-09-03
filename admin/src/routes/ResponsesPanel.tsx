import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Card,
  Group,
  Pagination,
  SegmentedControl,
  SimpleGrid,
  Skeleton,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconDownload, IconSearch } from "@tabler/icons-react";

import { api } from "../lib/api";
import { formatDateTime } from "../lib/format";

interface ResponseRow {
  id: string;
  contactName: string;
  attending: number | null;
  guestCount: number;
  contactPhone: string | null;
  contactEmail: string | null;
  contactInstagram: string | null;
  createdAt: number;
  answers: Array<{ label: string; value: string }>;
}

interface ResponsesPayload {
  ok: true;
  responses: ResponseRow[];
  total: number;
  summary: { total: number; attending: number; declined: number; guests: number };
}

const PAGE_SIZE = 25;

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card withBorder padding="sm">
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        {label}
      </Text>
      <Text size="xl" fw={700}>
        {value}
      </Text>
    </Card>
  );
}

export function ResponsesPanel() {
  const { id = "" } = useParams();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");

  // Pagination and filtering are server-side: an invitation with a
  // thousand replies must not ship all of them to the browser.
  const query = useQuery({
    queryKey: ["responses", id, page, search, filter],
    queryFn: () => {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String((page - 1) * PAGE_SIZE),
      });
      if (search) params.set("q", search);
      if (filter !== "all") params.set("attending", filter);
      return api.get<ResponsesPayload>(`/invitations/${id}/responses?${params}`);
    },
  });

  if (query.isLoading) return <Skeleton height={320} />;

  const data = query.data;
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={4}>Responses</Title>
        <Button
          component="a"
          href={`/api/v1/invitations/${id}/responses.csv`}
          variant="light"
          leftSection={<IconDownload size={16} />}
        >
          Export CSV
        </Button>
      </Group>

      <SimpleGrid cols={{ base: 2, sm: 4 }}>
        <Stat label="Replies" value={data?.summary.total ?? 0} />
        <Stat label="Attending" value={data?.summary.attending ?? 0} />
        <Stat label="Declined" value={data?.summary.declined ?? 0} />
        <Stat label="Total guests" value={data?.summary.guests ?? 0} />
      </SimpleGrid>

      <Group>
        <TextInput
          placeholder="Search name or contact"
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={(e) => {
            setSearch(e.currentTarget.value);
            setPage(1);
          }}
          style={{ flex: 1 }}
          aria-label="Search responses"
        />
        <SegmentedControl
          value={filter}
          onChange={(v) => {
            setFilter(v);
            setPage(1);
          }}
          data={[
            { label: "All", value: "all" },
            { label: "Attending", value: "yes" },
            { label: "Declined", value: "no" },
          ]}
        />
      </Group>

      <Card withBorder padding={0}>
        <Table.ScrollContainer minWidth={720}>
          <Table verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                <Table.Th>Attending</Table.Th>
                <Table.Th>Guests</Table.Th>
                <Table.Th>Contact</Table.Th>
                <Table.Th>Replied</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(data?.responses ?? []).map((r) => (
                <Table.Tr key={r.id}>
                  <Table.Td>
                    <Text size="sm" fw={500}>
                      {r.contactName}
                    </Text>
                    {r.answers.length > 0 && (
                      <Stack gap={2} mt={4}>
                        {r.answers.map((a, i) => (
                          <Text key={i} size="xs" c="dimmed">
                            {a.label}: {a.value}
                          </Text>
                        ))}
                      </Stack>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Badge
                      size="sm"
                      variant="light"
                      color={r.attending === 1 ? "green" : r.attending === 0 ? "red" : "gray"}
                    >
                      {r.attending === 1 ? "Yes" : r.attending === 0 ? "No" : "—"}
                    </Badge>
                  </Table.Td>
                  <Table.Td>{r.guestCount}</Table.Td>
                  <Table.Td>
                    <Text size="xs">{r.contactPhone ?? r.contactEmail ?? r.contactInstagram ?? "—"}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed">
                      {formatDateTime(r.createdAt)}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
              {!data?.responses.length && (
                <Table.Tr>
                  <Table.Td colSpan={5}>
                    <Text ta="center" c="dimmed" py="xl">
                      No responses yet.
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
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
