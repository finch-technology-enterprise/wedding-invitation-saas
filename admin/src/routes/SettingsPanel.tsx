import { useOutletContext } from "react-router-dom";
import { useState } from "react";
import {
  Alert,
  Button,
  Card,
  Group,
  PasswordInput,
  Skeleton,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";

import type { ShellContext } from "../components/Shell";
import { api, ApiError } from "../lib/api";
import { useTenant } from "../lib/queries";
import { formatBytes } from "../lib/format";

interface Member {
  id: string;
  email: string;
  displayName: string | null;
  status: string;
  role: string;
  createdAt: number;
}

export function SettingsPanel() {
  const { tenantId, session } = useOutletContext<ShellContext>();
  const tenant = useTenant(tenantId);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [busy, setBusy] = useState(false);

  if (!members) {
    void api
      .get<{ ok: true; members: Member[] }>(`/tenants/${tenantId}/members`)
      .then((r) => setMembers(r.members))
      .catch(() => setMembers([]));
  }

  const passwordForm = useForm({
    initialValues: { currentPassword: "", newPassword: "" },
    validate: {
      newPassword: (v) => (v.length >= 10 ? null : "At least 10 characters"),
    },
  });

  const changePassword = passwordForm.onSubmit(async (values) => {
    setBusy(true);
    try {
      await api.post("/auth/password", values);
      passwordForm.reset();
      notifications.show({ message: "Password changed. Other sessions were signed out.", color: "green" });
    } catch (err) {
      const wrong = err instanceof ApiError && err.status === 401;
      notifications.show({
        title: "Could not change password",
        message: wrong ? "Your current password is not correct." : "Please try again.",
        color: "red",
      });
    } finally {
      setBusy(false);
    }
  });

  if (tenant.isLoading) return <Skeleton height={280} />;

  const limits = tenant.data?.limits;
  const isOwner = tenant.data?.role === "owner";

  return (
    <Stack maw={720}>
      <Title order={2}>Settings</Title>

      <Card withBorder padding="md">
        <Title order={5}>Workspace</Title>
        <TextInput mt="sm" label="Name" defaultValue={tenant.data?.tenant.name} readOnly={!isOwner} />
        {!isOwner && (
          <Text size="xs" c="dimmed" mt={4}>
            Only workspace owners can change this.
          </Text>
        )}
      </Card>

      <Card withBorder padding="md">
        <Title order={5}>Members</Title>
        <Table mt="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Email</Table.Th>
              <Table.Th>Role</Table.Th>
              <Table.Th>Status</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(members ?? []).map((m) => (
              <Table.Tr key={m.id}>
                <Table.Td>{m.email}</Table.Td>
                <Table.Td>{m.role}</Table.Td>
                <Table.Td>{m.status}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>

      {limits && limits.maxMediaBytesPerTenant !== null && (
        <Card withBorder padding="md">
          <Title order={5}>Plan limits</Title>
          <Stack mt="sm" gap={4}>
            <Group justify="space-between">
              <Text size="sm" c="dimmed">
                Invitations
              </Text>
              <Text size="sm">{limits.maxInvitations ?? "Unlimited"}</Text>
            </Group>
            <Group justify="space-between">
              <Text size="sm" c="dimmed">
                Media storage
              </Text>
              <Text size="sm">{formatBytes(limits.maxMediaBytesPerTenant)}</Text>
            </Group>
            <Group justify="space-between">
              <Text size="sm" c="dimmed">
                Responses per invitation
              </Text>
              <Text size="sm">{limits.maxRsvpResponses ?? "Unlimited"}</Text>
            </Group>
          </Stack>
        </Card>
      )}

      <Card withBorder padding="md">
        <Title order={5}>Your account</Title>
        <Text size="sm" c="dimmed" mt={4}>
          {session.user.email}
        </Text>

        <form onSubmit={changePassword}>
          <Stack mt="md">
            <PasswordInput
              label="Current password"
              required
              autoComplete="current-password"
              {...passwordForm.getInputProps("currentPassword")}
            />
            <PasswordInput
              label="New password"
              required
              autoComplete="new-password"
              {...passwordForm.getInputProps("newPassword")}
            />
            <Alert variant="light" color="gray">
              <Text size="xs">
                Changing your password signs out every other device.
              </Text>
            </Alert>
            <Group justify="flex-end">
              <Button type="submit" loading={busy}>
                Change password
              </Button>
            </Group>
          </Stack>
        </form>
      </Card>
    </Stack>
  );
}
