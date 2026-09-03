import { Card, Group, SimpleGrid, Skeleton, Stack, Text, Title } from "@mantine/core";

import { useOverview } from "./queries";
import { formatBytes } from "../lib/format";

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <Card withBorder padding="md">
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        {label}
      </Text>
      <Text size="xl" fw={700} mt={4}>
        {value}
      </Text>
    </Card>
  );
}

export function OverviewView() {
  const overview = useOverview();
  if (overview.isLoading) return <Skeleton height={320} />;

  const { totals, storage, statusCounts } = overview.data!;

  return (
    <Stack>
      <Title order={2}>Overview</Title>

      <SimpleGrid cols={{ base: 2, sm: 3, lg: 6 }}>
        <Stat label="Users" value={totals.users} />
        <Stat label="Workspaces" value={totals.tenants} />
        <Stat label="Invitations" value={totals.invitations} />
        <Stat label="Published" value={totals.published} />
        <Stat label="Responses" value={totals.submissions} />
        <Stat label="Media" value={totals.mediaAssets} />
      </SimpleGrid>

      <Card withBorder padding="md">
        <Title order={5}>Tracked storage</Title>
        <Text size="xs" c="dimmed" mt={2}>
          From media metadata in D1 — the bucket is not enumerated for reporting.
        </Text>
        <Group mt="md" gap="xl">
          <div>
            <Text size="xs" c="dimmed">
              Total
            </Text>
            <Text size="lg" fw={700}>
              {formatBytes(storage.totalBytes)}
            </Text>
          </div>
          <div>
            <Text size="xs" c="dimmed">
              Images
            </Text>
            <Text size="lg">{formatBytes(storage.imageBytes)}</Text>
          </div>
          <div>
            <Text size="xs" c="dimmed">
              Audio
            </Text>
            <Text size="lg">{formatBytes(storage.audioBytes)}</Text>
          </div>
        </Group>
      </Card>

      <Card withBorder padding="md">
        <Title order={5}>Invitations by status</Title>
        <Group mt="md" gap="xl">
          {statusCounts.map((s) => (
            <div key={s.status}>
              <Text size="xs" c="dimmed">
                {s.status}
              </Text>
              <Text size="lg" fw={600}>
                {s.count}
              </Text>
            </div>
          ))}
        </Group>
      </Card>
    </Stack>
  );
}
