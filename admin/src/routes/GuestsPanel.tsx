/** Guest management: parties, invitees, CSV import, check-in (V2 Phase 5–6). */
import { useState } from "react";
import { useParams } from "react-router-dom";
import {
  Alert,
  Badge,
  Button,
  Card,
  FileInput,
  Group,
  Modal,
  Pagination,
  SegmentedControl,
  Select,
  Skeleton,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";

import { useGuests, useGuestMutations, useImportCommit, useImportPreview, useParties } from "../lib/guests";

const PAGE_SIZE = 25;

function PartiesCard({ invitationId }: { invitationId: string }) {
  const parties = useParties(invitationId);
  const muts = useGuestMutations(invitationId);
  const [title, setTitle] = useState("");
  const [lastLink, setLastLink] = useState<string | null>(null);

  if (parties.isLoading) return <Skeleton height={120} />;

  return (
    <Card withBorder>
      <Title order={4}>Parties / households</Title>
      <Text size="sm" c="dimmed" mt={4}>
        Group guests into households. Each party gets a secure personal link; replies through it
        are tagged to the party.
      </Text>
      {(parties.data?.parties ?? []).map((p) => (
        <Group key={p.id} justify="space-between" mt="sm" wrap="wrap">
          <div>
            <Text size="sm" fw={600}>
              {p.title}{" "}
              <Badge size="xs" variant="light">
                {p.guestCount} guests
              </Badge>{" "}
              {p.attendingCount > 0 && (
                <Badge size="xs" color="green" variant="light">
                  {p.attendingCount} attending
                </Badge>
              )}
            </Text>
            <Text size="xs" c="dimmed">
              {p.hasToken ? "Personal link enabled" : "No link"} · {p.checkedInCount} checked in
            </Text>
          </div>
          <Group gap="xs">
            <Button
              size="xs"
              variant="default"
              onClick={() =>
                muts.rotateToken.mutate(p.id, {
                  onSuccess: (res) => setLastLink(res.url),
                  onError: () => notifications.show({ message: "Could not rotate link", color: "red" }),
                })
              }
            >
              New link
            </Button>
            <Button
              size="xs"
              variant="subtle"
              color="red"
              onClick={() => muts.deleteParty.mutate(p.id)}
            >
              Remove
            </Button>
          </Group>
        </Group>
      ))}
      {lastLink && (
        <Alert color="green" mt="sm">
          <Text size="sm">Personal link: {lastLink}</Text>
        </Alert>
      )}
      <Group mt="md" gap="xs">
        <TextInput
          aria-label="New party name"
          placeholder="e.g. Lee Family"
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
          style={{ flex: 1 }}
        />
        <Button
          size="sm"
          disabled={!title.trim()}
          onClick={() =>
            muts.createParty.mutate(
              { title: title.trim() },
              {
                onSuccess: (res) => {
                  setLastLink(res.url);
                  setTitle("");
                },
                onError: () => notifications.show({ message: "Could not create party", color: "red" }),
              }
            )
          }
        >
          Add party
        </Button>
      </Group>
    </Card>
  );
}

function ImportCard({ invitationId }: { invitationId: string }) {
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const preview = useImportPreview(invitationId);
  const commit = useImportCommit(invitationId);

  return (
    <Card withBorder>
      <Title order={4}>Import from CSV</Title>
      <Text size="sm" c="dimmed" mt={4}>
        Columns: name, phone, email, meal, dietary. Preview first — nothing is committed until
        you confirm.
      </Text>
      <Group mt="sm" gap="xs" wrap="wrap">
        <FileInput
          aria-label="CSV file"
          placeholder="Choose a .csv file"
          accept=".csv,text/csv,text/plain"
          value={null}
          onChange={async (file) => {
            if (!file) return;
            setFileName(file.name);
            setCsv(await file.text());
          }}
          style={{ flex: 1 }}
        />
        <Button
          size="sm"
          variant="default"
          disabled={!csv}
          loading={preview.isPending}
          onClick={() => csv && preview.mutate(csv)}
        >
          Preview
        </Button>
      </Group>
      {fileName && (
        <Text size="xs" c="dimmed" mt="xs">
          {fileName}
        </Text>
      )}
      {preview.data && (
        <Stack gap="xs" mt="sm">
          <Text size="sm">
            {preview.data.total} rows · {preview.data.valid} new · {preview.data.duplicates}{" "}
            duplicates · {preview.data.invalid} invalid
          </Text>
          {preview.data.rows.slice(0, 8).map((r) => (
            <Text key={r.index} size="xs" c={r.valid && !r.duplicate ? undefined : "red"}>
              Row {r.index + 1}: {r.name ?? "(no name)"}
              {r.duplicate ? " — duplicate" : ""}
              {!r.valid ? " — invalid" : ""}
            </Text>
          ))}
          <Button
            size="sm"
            disabled={!preview.data.valid}
            loading={commit.isPending}
            onClick={() =>
              csv &&
              commit.mutate(
                { csv, skipDuplicates: true },
                {
                  onSuccess: (res) => {
                    notifications.show({
                      message: `Imported ${res.imported}, skipped ${res.skipped}`,
                      color: "green",
                    });
                    preview.reset();
                    setCsv(null);
                  },
                }
              )
            }
          >
            Import {preview.data.valid} guests
          </Button>
        </Stack>
      )}
    </Card>
  );
}

export function GuestsPanel() {
  const { id = "" } = useParams();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [partyId, setPartyId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const parties = useParties(id);
  const list = useGuests(id, {
    q: search || undefined,
    status: status === "all" ? undefined : status,
    partyId: partyId ?? undefined,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });
  const muts = useGuestMutations(id);

  if (list.isLoading) return <Skeleton height={320} />;
  const pages = Math.max(1, Math.ceil((list.data?.total ?? 0) / PAGE_SIZE));

  return (
    <Stack>
      <PartiesCard invitationId={id} />

      <Card withBorder>
        <Group justify="space-between" wrap="wrap">
          <Title order={4}>Invitees</Title>
          <Group gap="xs">
            <Badge variant="light">{list.data?.summary.total ?? 0} invited</Badge>
            <Badge color="green" variant="light">
              {list.data?.summary.attending ?? 0} attending
            </Badge>
            <Badge color="red" variant="light">
              {list.data?.summary.declined ?? 0} declined
            </Badge>
            <Badge color="gray" variant="light">
              {list.data?.summary.pending ?? 0} pending
            </Badge>
            <Badge color="blue" variant="light">
              {list.data?.summary.checkedIn ?? 0} checked in
            </Badge>
          </Group>
        </Group>

        <Group mt="sm" gap="xs" wrap="wrap">
          <TextInput
            aria-label="Search invitees"
            placeholder="Search name, phone, email"
            value={search}
            onChange={(e) => {
              setSearch(e.currentTarget.value);
              setPage(1);
            }}
            style={{ flex: 1, minWidth: 180 }}
          />
          <SegmentedControl
            size="xs"
            value={status}
            onChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
            data={[
              { label: "All", value: "all" },
              { label: "Pending", value: "pending" },
              { label: "Attending", value: "attending" },
              { label: "Declined", value: "declined" },
            ]}
          />
          <Select
            aria-label="Filter by party"
            placeholder="All parties"
            clearable
            size="xs"
            w={160}
            data={(parties.data?.parties ?? []).map((p) => ({ value: p.id, label: p.title }))}
            value={partyId}
            onChange={(v) => {
              setPartyId(v);
              setPage(1);
            }}
          />
        </Group>

        <Group mt="sm" gap="xs">
          <TextInput
            aria-label="New invitee name"
            placeholder="New invitee name"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            style={{ flex: 1, minWidth: 180 }}
          />
          <Select
            aria-label="Party for new invitee"
            placeholder="No party"
            clearable
            size="sm"
            w={160}
            data={(parties.data?.parties ?? []).map((p) => ({ value: p.id, label: p.title }))}
            value={partyId}
            onChange={setPartyId}
          />
          <Button
            size="sm"
            disabled={!name.trim()}
            onClick={() =>
              muts.createGuest.mutate(
                { fullName: name.trim(), partyId },
                { onSuccess: () => setName("") }
              )
            }
          >
            Add
          </Button>
        </Group>

        <Table.ScrollContainer minWidth={760} mt="md">
          <Table verticalSpacing="sm" highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                <Table.Th>Party</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Check-in</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(list.data?.guests ?? []).map((g) => (
                <Table.Tr key={g.id}>
                  <Table.Td>
                    <Text size="sm">{g.fullName}</Text>
                    <Text size="xs" c="dimmed">
                      {[g.phone, g.email].filter(Boolean).join(" · ")}
                      {g.meal ? ` · ${g.meal}` : ""}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{g.partyTitle ?? "—"}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge
                      size="sm"
                      variant="light"
                      color={g.rsvpStatus === "attending" ? "green" : g.rsvpStatus === "declined" ? "red" : "gray"}
                    >
                      {g.rsvpStatus}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    {g.checkedInAt ? (
                      <Button size="xs" variant="light" onClick={() => muts.checkOut.mutate(g.id)}>
                        Undo
                      </Button>
                    ) : (
                      <Button size="xs" variant="default" onClick={() => muts.checkIn.mutate(g.id)}>
                        Check in
                      </Button>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Button size="xs" variant="subtle" color="red" onClick={() => setConfirmDelete(g.id)}>
                      Remove
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>

        {pages > 1 && (
          <Group justify="center" mt="md">
            <Pagination value={page} onChange={setPage} total={pages} />
          </Group>
        )}
      </Card>

      <ImportCard invitationId={id} />

      <Modal opened={confirmDelete !== null} onClose={() => setConfirmDelete(null)} title="Remove invitee?" centered>
        <Text size="sm" c="dimmed">
          The invitee is removed from the list. Their RSVP answers, if any, are kept.
        </Text>
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={() => setConfirmDelete(null)}>
            Cancel
          </Button>
          <Button
            color="red"
            onClick={() =>
              confirmDelete &&
              muts.deleteGuest.mutate(confirmDelete, { onSuccess: () => setConfirmDelete(null) })
            }
          >
            Remove
          </Button>
        </Group>
      </Modal>
    </Stack>
  );
}
