import {
  Alert,
  Button,
  Card,
  SimpleGrid,
  Skeleton,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconRefresh } from "@tabler/icons-react";

import { useConsistency, useRecalculate, useStorage } from "./queries";
import { formatBytes, formatDate } from "../lib/format";

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

export function StorageView() {
  const storage = useStorage();
  const consistency = useConsistency();
  const recalculate = useRecalculate();

  if (storage.isLoading) return <Skeleton height={360} />;
  const { totals, byTenant, byInvitation, largestAssets } = storage.data!;

  return (
    <Stack>
      <Title order={2}>Storage</Title>

      <SimpleGrid cols={{ base: 2, sm: 4 }}>
        <Stat label="Tracked bytes" value={formatBytes(totals.totalBytes)} />
        <Stat label="Assets" value={totals.assetCount} />
        <Stat label={`Images (${totals.imageCount})`} value={formatBytes(totals.imageBytes)} />
        <Stat label={`Audio (${totals.audioCount})`} value={formatBytes(totals.audioBytes)} />
      </SimpleGrid>

      {consistency.data && consistency.data.count > 0 && (
        <Alert color="yellow" variant="light" title="Counter drift detected">
          <Text size="sm">
            {consistency.data.count} invitation{consistency.data.count === 1 ? "" : "s"} have a
            stored byte counter that disagrees with the sum of their media. Recalculating repairs
            the counters from the assets themselves.
          </Text>
          <Button
            mt="sm"
            size="xs"
            variant="light"
            leftSection={<IconRefresh size={14} />}
            loading={recalculate.isPending}
            onClick={() =>
              recalculate.mutate(undefined, {
                onSuccess: (res) =>
                  notifications.show({
                    message: `Repaired ${res.count} counter${res.count === 1 ? "" : "s"}`,
                    color: "green",
                  }),
              })
            }
          >
            Recalculate counters
          </Button>
        </Alert>
      )}

      {consistency.data && consistency.data.count === 0 && (
        <Alert color="green" variant="light">
          <Text size="sm">Storage counters agree with media metadata.</Text>
        </Alert>
      )}

      <Card withBorder padding="md">
        <Title order={5}>Largest workspaces</Title>
        <Table mt="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Workspace</Table.Th>
              <Table.Th>Assets</Table.Th>
              <Table.Th>Bytes</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {byTenant.map((t) => (
              <Table.Tr key={t.id}>
                <Table.Td>{t.name}</Table.Td>
                <Table.Td>{t.assetCount}</Table.Td>
                <Table.Td>{formatBytes(t.bytes)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>

      <Card withBorder padding="md">
        <Title order={5}>Largest invitations</Title>
        <Table mt="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Invitation</Table.Th>
              <Table.Th>Workspace</Table.Th>
              <Table.Th>Assets</Table.Th>
              <Table.Th>Bytes</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {byInvitation.map((i) => (
              <Table.Tr key={i.id}>
                <Table.Td>
                  <Text size="sm">{i.title}</Text>
                  <Text size="xs" c="dimmed">
                    /i/{i.slug}
                  </Text>
                </Table.Td>
                <Table.Td>{i.tenantName}</Table.Td>
                <Table.Td>{i.assetCount}</Table.Td>
                <Table.Td>{formatBytes(i.bytes)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>

      <Card withBorder padding="md">
        <Title order={5}>Largest individual assets</Title>
        <Table.ScrollContainer minWidth={760}>
          <Table mt="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Invitation</Table.Th>
                <Table.Th>Workspace</Table.Th>
                <Table.Th>Kind</Table.Th>
                <Table.Th>Type</Table.Th>
                <Table.Th>Dimensions</Table.Th>
                <Table.Th>Size</Table.Th>
                <Table.Th>Created</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {largestAssets.map((a) => (
                <Table.Tr key={a.id}>
                  <Table.Td>{a.invitationTitle}</Table.Td>
                  <Table.Td>{a.tenantName}</Table.Td>
                  <Table.Td>{a.kind}</Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed">
                      {a.mimeType}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs">{a.width && a.height ? `${a.width}×${a.height}` : "—"}</Text>
                  </Table.Td>
                  <Table.Td>{formatBytes(a.byteSize)}</Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed">
                      {formatDate(a.createdAt)}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Card>
    </Stack>
  );
}
