import { Link, useOutletContext } from "react-router-dom";
import {
  Alert,
  Badge,
  Button,
  Card,
  Grid,
  Group,
  Progress,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { IconPlus } from "@tabler/icons-react";

import type { ShellContext } from "../components/Shell";
import { useInvitations, useTenant } from "../lib/queries";
import { formatBytes, STATUS_COLOR, timeAgo } from "../lib/format";

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

export function Dashboard() {
  const { tenantId } = useOutletContext<ShellContext>();
  const tenant = useTenant(tenantId);
  const invitations = useInvitations(tenantId);

  if (invitations.isLoading || tenant.isLoading) {
    return <Skeleton height={320} />;
  }

  const list = invitations.data?.invitations ?? [];
  const limits = tenant.data?.limits;
  const published = list.filter((i) => i.status === "published").length;
  const storageUsed = list.reduce((sum, i) => sum + i.mediaBytes, 0);
  const responses = list.reduce((sum, i) => sum + i.rsvpCount, 0);

  // Quotas are hosted-mode policy. A self-hosted instance reports null
  // limits, and showing an empty meter there would be noise.
  const storageLimit = limits?.maxMediaBytesPerTenant ?? null;
  const invitationLimit = limits?.maxInvitations ?? null;
  const atInvitationLimit = invitationLimit !== null && list.length >= invitationLimit;

  return (
    <Stack>
      <Group justify="space-between" align="flex-end">
        <div>
          <Title order={2}>{tenant.data?.tenant.name}</Title>
          <Text c="dimmed" size="sm">
            {list.length} invitation{list.length === 1 ? "" : "s"}
          </Text>
        </div>
        <Button
          component={Link}
          to="/invitations/new"
          leftSection={<IconPlus size={16} />}
          disabled={atInvitationLimit}
        >
          New invitation
        </Button>
      </Group>

      {atInvitationLimit && (
        <Alert color="yellow" variant="light">
          You have reached your plan limit of {invitationLimit} invitation
          {invitationLimit === 1 ? "" : "s"}.
        </Alert>
      )}

      <SimpleGrid cols={{ base: 2, sm: 4 }}>
        <Stat label="Invitations" value={list.length} />
        <Stat label="Published" value={published} />
        <Stat label="Responses" value={responses} />
        <Stat label="Media" value={formatBytes(storageUsed)} />
      </SimpleGrid>

      {storageLimit !== null && (
        <Card withBorder padding="md">
          <Group justify="space-between" mb="xs">
            <Text size="sm" fw={600}>
              Media storage
            </Text>
            <Text size="sm" c="dimmed">
              {formatBytes(storageUsed)} / {formatBytes(storageLimit)}
            </Text>
          </Group>
          <Progress
            value={Math.min(100, (storageUsed / storageLimit) * 100)}
            color={storageUsed / storageLimit > 0.9 ? "red" : "blue"}
          />
        </Card>
      )}

      <Title order={4} mt="md">
        Your invitations
      </Title>

      {!list.length ? (
        <Card withBorder padding="xl">
          <Stack align="center" gap="sm">
            <Text c="dimmed">No invitations yet.</Text>
            <Button component={Link} to="/invitations/new" variant="light">
              Create your first invitation
            </Button>
          </Stack>
        </Card>
      ) : (
        <Grid>
          {list.map((inv) => (
            <Grid.Col key={inv.id} span={{ base: 12, sm: 6, lg: 4 }}>
              <Card withBorder padding="md" component={Link} to={`/invitations/${inv.id}`}>
                <Group justify="space-between" mb={6}>
                  <Text fw={600} lineClamp={1}>
                    {inv.title}
                  </Text>
                  <Badge color={STATUS_COLOR[inv.status]} variant="light" size="sm">
                    {inv.status}
                  </Badge>
                </Group>
                <Text size="xs" c="dimmed">
                  /i/{inv.slug}
                </Text>
                <Group justify="space-between" mt="sm">
                  <Text size="xs" c="dimmed">
                    Updated {timeAgo(inv.updatedAt)}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {formatBytes(inv.mediaBytes)}
                  </Text>
                </Group>
              </Card>
            </Grid.Col>
          ))}
        </Grid>
      )}
    </Stack>
  );
}
