import { Badge, Card, Group, Skeleton, Stack, Table, Text, Title } from "@mantine/core";

import { useSystem } from "./queries";

export function SystemView() {
  const system = useSystem();
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
    </Stack>
  );
}
