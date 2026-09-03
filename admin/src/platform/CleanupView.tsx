import { useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Divider,
  Group,
  List,
  Modal,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconAlertTriangle, IconScan, IconTrash } from "@tabler/icons-react";

import { InvitationsView } from "./InvitationsView";
import {
  useDeleteInvitations,
  useDeleteOrphans,
  useImpact,
  useOrphanScan,
  type Impact,
  type ImpactTotals,
  type OrphanCandidate,
} from "./queries";
import { formatBytes, formatDate } from "../lib/format";

/** Exactly what the server will require. */
function confirmationPhrase(count: number): string {
  return `DELETE ${count} INVITATION${count === 1 ? "" : "S"}`;
}

function ImpactTable({ impacts, totals }: { impacts: Impact[]; totals: ImpactTotals }) {
  return (
    <Stack gap="sm">
      <Alert color="red" variant="light" icon={<IconAlertTriangle size={18} />}>
        <Text size="sm" fw={600}>
          This permanently removes:
        </Text>
        <List size="sm" mt={4}>
          <List.Item>
            {totals.invitations} invitation{totals.invitations === 1 ? "" : "s"}
          </List.Item>
          <List.Item>{totals.revisions} revisions</List.Item>
          <List.Item>
            {totals.media} media assets · {formatBytes(totals.bytes)}
          </List.Item>
          <List.Item>{totals.submissions} RSVP responses</List.Item>
          <List.Item>{totals.answers} RSVP answers</List.Item>
          <List.Item>{totals.fields} RSVP fields</List.Item>
          <List.Item>{totals.previewTokens} preview links</List.Item>
        </List>
        <Text size="xs" mt="sm">
          Counted live from the database, not from cached totals. This cannot be undone.
        </Text>
      </Alert>

      <Table.ScrollContainer minWidth={720}>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Invitation</Table.Th>
              <Table.Th>Workspace</Table.Th>
              <Table.Th>Created</Table.Th>
              <Table.Th>Rev</Table.Th>
              <Table.Th>Media</Table.Th>
              <Table.Th>Bytes</Table.Th>
              <Table.Th>Replies</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {impacts.map((i) => (
              <Table.Tr key={i.invitationId}>
                <Table.Td>
                  <Text size="sm">{i.title}</Text>
                  <Text size="xs" c="dimmed">
                    /i/{i.slug}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="xs">{i.tenantName}</Text>
                  <Text size="xs" c="dimmed">
                    {i.ownerEmail ?? "—"}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="xs" c="dimmed">
                    {formatDate(i.createdAt)}
                  </Text>
                </Table.Td>
                <Table.Td>{i.revisionCount}</Table.Td>
                <Table.Td>{i.mediaCount}</Table.Td>
                <Table.Td>{formatBytes(i.storageBytes)}</Table.Td>
                <Table.Td>{i.rsvpSubmissionCount}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Stack>
  );
}

function InvitationCleanup() {
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typed, setTyped] = useState("");

  const impact = useImpact();
  const remove = useDeleteInvitations();

  const phrase = confirmationPhrase(selected.length);

  const openPreview = () => {
    setTyped("");
    impact.mutate(selected, {
      onSuccess: () => setConfirmOpen(true),
      onError: () =>
        notifications.show({ message: "Could not compute impact", color: "red" }),
    });
  };

  return (
    <Stack>
      <Alert variant="light" color="gray">
        <Text size="sm">
          These are <strong>cleanup candidates</strong> — invitations matching the filters you
          chose. Nothing here expires or is removed on its own; an invitation stays until you
          deliberately delete it.
        </Text>
      </Alert>

      <InvitationsView selectable selected={selected} onSelectedChange={setSelected} />

      <Card withBorder padding="md">
        <Group justify="space-between">
          <Text size="sm">
            {selected.length} selected
            {selected.length > 20 && (
              <Text component="span" c="red" size="sm">
                {" "}
                · batches are limited to 20
              </Text>
            )}
          </Text>
          <Group>
            <Button variant="subtle" onClick={() => setSelected([])} disabled={!selected.length}>
              Clear
            </Button>
            <Button
              color="red"
              leftSection={<IconTrash size={16} />}
              disabled={!selected.length || selected.length > 20}
              loading={impact.isPending}
              onClick={openPreview}
            >
              Review deletion
            </Button>
          </Group>
        </Group>
      </Card>

      <Modal
        opened={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Permanently delete invitations"
        size="lg"
        centered
      >
        {impact.data && <ImpactTable impacts={impact.data.impacts} totals={impact.data.totals} />}

        <Divider my="md" />

        <Text size="sm">
          Type <strong>{phrase}</strong> to confirm.
        </Text>
        <TextInput
          mt="xs"
          value={typed}
          onChange={(e) => setTyped(e.currentTarget.value)}
          placeholder={phrase}
          aria-label="Confirmation phrase"
        />

        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={() => setConfirmOpen(false)}>
            Cancel
          </Button>
          <Button
            color="red"
            disabled={typed !== phrase}
            loading={remove.isPending}
            onClick={() =>
              remove.mutate(
                { invitationIds: selected, confirm: phrase },
                {
                  onSuccess: (res) => {
                    setConfirmOpen(false);
                    setSelected([]);
                    notifications.show({
                      title: `Removed ${res.removed}`,
                      message:
                        res.failed > 0
                          ? `${res.failed} failed and can be retried.`
                          : `Freed ${formatBytes(res.bytesFreed)}.`,
                      color: res.failed > 0 ? "orange" : "green",
                    });
                  },
                  onError: () =>
                    notifications.show({ message: "Deletion failed", color: "red" }),
                }
              )
            }
          >
            Delete permanently
          </Button>
        </Group>
      </Modal>
    </Stack>
  );
}

function OrphanScanner() {
  const [candidates, setCandidates] = useState<OrphanCandidate[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [scanned, setScanned] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [started, setStarted] = useState(false);

  const scan = useOrphanScan();
  const remove = useDeleteOrphans();

  const runScan = (next?: string) => {
    scan.mutate(next, {
      onSuccess: (res) => {
        setStarted(true);
        setCandidates((prev) => (next ? [...prev, ...res.candidates] : res.candidates));
        setScanned((prev) => (next ? prev + res.scanned : res.scanned));
        setCursor(res.cursor);
      },
      onError: () => notifications.show({ message: "Scan failed", color: "red" }),
    });
  };

  const phrase = `DELETE ${selected.length} OBJECT${selected.length === 1 ? "" : "S"}`;

  return (
    <Stack>
      <Alert variant="light" color="gray">
        <Text size="sm">
          Compares objects in the bucket against media records. Results are{" "}
          <strong>orphan candidates</strong>, not confirmed garbage — an object may belong to an
          upload that is still in flight. This is the only operation that enumerates storage, and
          it runs only when you start it.
        </Text>
      </Alert>

      <Group>
        <Button
          leftSection={<IconScan size={16} />}
          loading={scan.isPending}
          onClick={() => runScan()}
        >
          {started ? "Rescan" : "Start scan"}
        </Button>
        {cursor && (
          <Button variant="light" loading={scan.isPending} onClick={() => runScan(cursor)}>
            Scan next page
          </Button>
        )}
        {started && (
          <Text size="sm" c="dimmed">
            {scanned} objects scanned · {candidates.length} candidate
            {candidates.length === 1 ? "" : "s"}
          </Text>
        )}
      </Group>

      {started && candidates.length === 0 && (
        <Alert color="green" variant="light">
          <Text size="sm">No orphan candidates in the scanned range.</Text>
        </Alert>
      )}

      {candidates.length > 0 && (
        <>
          <Card withBorder padding={0}>
            <Table.ScrollContainer minWidth={820}>
              <Table verticalSpacing="sm">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th w={40} />
                    <Table.Th>Object</Table.Th>
                    <Table.Th>Workspace</Table.Th>
                    <Table.Th>Invitation</Table.Th>
                    <Table.Th>Size</Table.Th>
                    <Table.Th>Uploaded</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {candidates.map((c) => (
                    <Table.Tr key={c.key}>
                      <Table.Td>
                        <Checkbox
                          aria-label={`Select ${c.key}`}
                          checked={selected.includes(c.key)}
                          onChange={() =>
                            setSelected((prev) =>
                              prev.includes(c.key)
                                ? prev.filter((k) => k !== c.key)
                                : [...prev, c.key]
                            )
                          }
                        />
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs" ff="monospace">
                          {c.key}
                        </Text>
                        <Badge size="xs" color="orange" variant="light" mt={2}>
                          orphan candidate
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs">{c.tenantName ?? "unresolved"}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs">{c.invitationTitle ?? "unresolved"}</Text>
                      </Table.Td>
                      <Table.Td>{formatBytes(c.size)}</Table.Td>
                      <Table.Td>
                        <Text size="xs" c="dimmed">
                          {c.uploaded ? formatDate(c.uploaded) : "—"}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Card>

          <Group justify="flex-end">
            <Button
              color="red"
              variant="light"
              disabled={!selected.length}
              loading={remove.isPending}
              onClick={() =>
                remove.mutate(
                  { keys: selected, confirm: phrase },
                  {
                    onSuccess: (res) => {
                      setCandidates((prev) => prev.filter((c) => !selected.includes(c.key)));
                      setSelected([]);
                      notifications.show({
                        message: `Deleted ${res.deleted}${
                          res.skipped.length ? `, skipped ${res.skipped.length} now in use` : ""
                        }`,
                        color: "green",
                      });
                    },
                    onError: () =>
                      notifications.show({ message: "Could not delete objects", color: "red" }),
                  }
                )
              }
            >
              Delete {selected.length} selected
            </Button>
          </Group>
        </>
      )}
    </Stack>
  );
}

export function CleanupView() {
  return (
    <Stack>
      <Title order={2}>Cleanup</Title>
      <Tabs defaultValue="invitations">
        <Tabs.List>
          <Tabs.Tab value="invitations">Invitations</Tabs.Tab>
          <Tabs.Tab value="orphans">Storage orphans</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="invitations" pt="md">
          <InvitationCleanup />
        </Tabs.Panel>
        <Tabs.Panel value="orphans" pt="md">
          <OrphanScanner />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
