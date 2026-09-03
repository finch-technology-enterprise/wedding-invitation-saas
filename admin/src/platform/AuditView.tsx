import { Badge, Card, Skeleton, Stack, Table, Text, Title } from "@mantine/core";

import { useAudit } from "./queries";
import { formatDateTime } from "../lib/format";

export function AuditView() {
  const audit = useAudit();
  if (audit.isLoading) return <Skeleton height={320} />;

  return (
    <Stack>
      <Title order={2}>Audit</Title>
      <Text size="sm" c="dimmed">
        Operator actions. Records identifiers, counts and outcome — never invitation content or
        guest replies.
      </Text>

      <Card withBorder padding={0}>
        <Table.ScrollContainer minWidth={760}>
          <Table verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>When</Table.Th>
                <Table.Th>Actor</Table.Th>
                <Table.Th>Action</Table.Th>
                <Table.Th>Target</Table.Th>
                <Table.Th>Detail</Table.Th>
                <Table.Th>Result</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(audit.data?.events ?? []).map((e) => (
                <Table.Tr key={e.id}>
                  <Table.Td>
                    <Text size="xs" c="dimmed">
                      {formatDateTime(e.createdAt)}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs">{e.actorEmail ?? "system"}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" ff="monospace">
                      {e.action}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed">
                      {e.targetType}
                    </Text>
                    <Text size="xs" ff="monospace">
                      {e.targetId.slice(0, 12)}…
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed">
                      {e.metaJson ?? "—"}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge size="sm" variant="light" color={e.ok ? "green" : "red"}>
                      {e.ok ? "ok" : "failed"}
                    </Badge>
                  </Table.Td>
                </Table.Tr>
              ))}
              {!audit.data?.events.length && (
                <Table.Tr>
                  <Table.Td colSpan={6}>
                    <Text ta="center" c="dimmed" py="xl">
                      No operator actions recorded yet.
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
