import { Badge, Button, Card, Group, Skeleton, Stack, Table, Text, Title } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";

import { useSystem } from "./queries";
import { api } from "../lib/api";

export function SystemView() {
  const system = useSystem();
  const qc = useQueryClient();
  const runs = useQuery({
    queryKey: ["p", "housekeeping"],
    queryFn: () =>
      api.get<{
        ok: true;
        runs: Array<{ id: string; kind: string; startedAt: number; deleted: number; ok: number; error: string | null }>;
      }>("/platform/housekeeping/runs"),
  });
  const runNow = useMutation({
    mutationFn: () =>
      api.post<{ ok: true; deleted: number; results: Array<{ kind: string; deleted: number }> }>(
        "/platform/housekeeping/run"
      ),
    onSuccess: (res) => {
      notifications.show({
        message: `Housekeeping complete — ${res.deleted} rows reclaimed`,
        color: "green",
      });
      qc.invalidateQueries({ queryKey: ["p", "housekeeping"] });
    },
    onError: () => notifications.show({ message: "Housekeeping failed", color: "red" }),
  });

  if (system.isLoading) return <Skeleton height={280} />;

  const { mode, bindings, settings, passwordHashing } = system.data!;

  return (
    <Stack maw={720}>
      <Title order={2}>System</Title>

      <Card withBorder padding="md">
        <Title order={5}>Deployment</Title>
        <Group mt="md" gap="xl">
          <div>
            <Text size="xs" c="dimmed">
              Mode
            </Text>
            <Badge variant="light">{mode}</Badge>
          </div>
          <div>
            <Text size="xs" c="dimmed">
              Database
            </Text>
            <Badge color={bindings.d1 ? "green" : "red"} variant="light">
              {bindings.d1 ? "healthy" : "unreachable"}
            </Badge>
          </div>
          <div>
            <Text size="xs" c="dimmed">
              Object storage
            </Text>
            <Badge color={bindings.r2 ? "green" : "red"} variant="light">
              {bindings.r2 ? "healthy" : "unreachable"}
            </Badge>
          </div>
          <div>
            <Text size="xs" c="dimmed">
              Password hashing
            </Text>
            <Text size="sm">{passwordHashing}</Text>
          </div>
        </Group>
      </Card>

      <Card withBorder padding="md">
        <Title order={5}>Platform settings</Title>
        <Table mt="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Key</Table.Th>
              <Table.Th>Value</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {settings.map((s) => (
              <Table.Tr key={s.key}>
                <Table.Td>
                  <Text size="sm" ff="monospace">
                    {s.key}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{s.value}</Text>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        <Text size="xs" c="dimmed" mt="sm">
          Secrets and credentials are never exposed here.
        </Text>
      </Card>

      <Card withBorder padding="md">
        <Group justify="space-between" align="center">
          <Title order={5}>Retention housekeeping</Title>
          <Button size="xs" loading={runNow.isPending} onClick={() => runNow.mutate()}>
            Run now
          </Button>
        </Group>
        <Text size="sm" c="dimmed" mt={4}>
          Purges expired sessions, rate-limit buckets, used auth tokens, expired preview tokens
          and old audit events in bounded batches. Invitations, revisions, media, RSVPs and
          guests are never touched. Also runs on a schedule when a cron trigger is configured.
        </Text>
        {(runs.data?.runs ?? []).slice(0, 5).map((r) => (
          <Group key={r.id} justify="space-between" mt="xs">
            <Text size="sm">
              {r.kind} · {r.deleted} rows
            </Text>
            <Badge color={r.ok ? "green" : "red"} variant="light">
              {r.ok ? "ok" : "failed"}
            </Badge>
          </Group>
        ))}
      </Card>
    </Stack>
  );
}
