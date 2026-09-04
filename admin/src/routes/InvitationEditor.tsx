import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link, Outlet, useBlocker, useLocation, useParams } from "react-router-dom";
import {
  Alert,
  Badge,
  Button,
  Card,
  Grid,
  Group,
  Loader,
  Modal,
  SegmentedControl,
  Skeleton,
  Stack,
  Tabs,
  Text,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconDeviceFloppy, IconEye, IconRefresh } from "@tabler/icons-react";

import { ApiError, type ThemeManifest } from "../lib/api";
import { useCreatePreview, useDraft, useInvitation, useSaveDraft } from "../lib/queries";
import { STATUS_COLOR, timeAgo } from "../lib/format";

/**
 * The draft the editor panels read and write (V2).
 *
 * Working copy is local state; persistence is debounced autosave guarded
 * by the server's optimistic-concurrency version (PUT expectedVersion).
 * Publishing stays explicit — autosave never publishes.
 */
export type SaveState = "saved" | "saving" | "offline" | "conflict" | "failed";

export interface EditorContextValue {
  invitationId: string;
  config: Record<string, any>;
  manifest: ThemeManifest;
  /** Merge a partial change into the working config. */
  update: (patch: Record<string, any>) => void;
  /** Replace the config wholesale (used by media/RSVP panels). */
  replace: (next: Record<string, any>) => void;
  dirty: boolean;
  save: () => void;
  saving: boolean;
  saveState: SaveState;
  draftVersion: number;
  fieldErrors: Record<string, string>;
  status: string;
}

const EditorContext = createContext<EditorContextValue | null>(null);

export function useEditor(): EditorContextValue {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error("useEditor must be used inside the invitation editor");
  return ctx;
}

/** Deep merge for partial patches; arrays replace wholesale. */
function merge(base: any, patch: any): any {
  if (patch === null || patch === undefined) return patch;
  if (Array.isArray(patch) || typeof patch !== "object") return patch;
  const out = { ...(base ?? {}) };
  for (const [k, v] of Object.entries(patch)) out[k] = merge(out[k], v);
  return out;
}

/** A config that satisfies the theme contract with nothing filled in. */
function emptyConfig(): Record<string, any> {
  return {
    couple: { groom: {}, bride: {} },
    date: { iso: "", durationHours: 4 },
    copy: {},
    venue: { tba: true },
    rsvp: { maxGuests: 12 },
    media: {},
    music: { assetId: null, enabled: false },
    motion: { driftPxPerSec: 46 },
  };
}

// Existing tabs keep their routes/labels (e2e + deep links depend on
// them); Guests and Design are additive (V2 §4.3).
const TABS = [
  { value: "content", label: "Content" },
  { value: "media", label: "Media" },
  { value: "motion", label: "Motion" },
  { value: "rsvp", label: "RSVP" },
  { value: "guests", label: "Guests" },
  { value: "responses", label: "Responses" },
  { value: "design", label: "Design" },
  { value: "sharing", label: "Sharing" },
  { value: "publish", label: "Publish" },
];

// Autosave fires after the user pauses. Long enough that typing does not
// generate a request per keystroke, short enough that a distracted user
// does not lose work. An explicit Save always pre-empts the timer.
const AUTOSAVE_MS = 2500;

export function InvitationEditor() {
  const { id = "" } = useParams();
  const location = useLocation();
  const invitation = useInvitation(id);
  const draft = useDraft(id);
  const saveDraft = useSaveDraft(id);
  const createPreview = useCreatePreview(id);

  const [config, setConfig] = useState<Record<string, any> | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [savedKey, setSavedKey] = useState<string>("");
  const [version, setVersion] = useState<number>(1);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [conflictVersion, setConflictVersion] = useState<number | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewWidth, setPreviewWidth] = useState<string>("390");
  const saveTimer = useRef<number | null>(null);

  // Seed the working copy once the server draft arrives. Re-seeding on
  // every refetch would discard in-progress edits.
  useEffect(() => {
    if (!draft.data || config !== null) return;
    const initial = (draft.data.draft as Record<string, any>) ?? emptyConfig();
    setSavedKey(JSON.stringify(initial));
    setVersion(draft.data.draftVersion ?? 1);
    setConfig(initial);
  }, [draft.data, config]);

  // Deliberate change detection: one serialization per config identity
  // change (memoized), compared against the last saved baseline.
  const draftKey = useMemo(() => (config === null ? "" : JSON.stringify(config)), [config]);
  const dirty = config !== null && draftKey !== savedKey;

  const doSave = (
    snapshot: Record<string, any>,
    baseKey: string,
    opts: { announce?: boolean } = {}
  ) => {
    if (!navigator.onLine) {
      setSaveState("offline");
      return;
    }
    setSaveState("saving");
    setFieldErrors({});
    saveDraft.mutate(
      { config: snapshot, expectedVersion: version },
      {
        onSuccess: (res) => {
          setSavedKey(baseKey);
          setVersion(res.draftVersion);
          setSaveState("saved");
          // Explicit saves confirm; autosave stays silent (a toast every
          // 1.5s while typing would be noise, not feedback).
          if (opts.announce) {
            notifications.show({ message: "Draft saved", color: "green" });
          }
        },
        onError: (err) => {
          if (err instanceof ApiError && err.payload.error === "draft_conflict") {
            setConflictVersion(
              (err.payload as { draftVersion?: number }).draftVersion ?? version + 1
            );
            setSaveState("conflict");
            return;
          }
          if (err instanceof ApiError && err.payload.errors) {
            setFieldErrors(err.fieldErrors);
            if (opts.announce) {
              notifications.show({
                title: "Could not save",
                message: "Some fields need attention.",
                color: "red",
              });
            }
          } else if (opts.announce) {
            notifications.show({
              title: "Could not save",
              message: "Please try again.",
              color: "red",
            });
          }
          setSaveState(!navigator.onLine ? "offline" : "failed");
        },
      }
    );
  };

  const save = () => {
    if (!config || saveState === "conflict") return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    if (!dirty) return;
    doSave(config, draftKey, { announce: true });
  };

  // Debounced autosave: no request spam, no duplicate races (a pending
  // save suppresses the timer until it settles).
  useEffect(() => {
    if (!config || !dirty || saveState === "conflict" || saveDraft.isPending) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      // Route autosave through the same canonical save path so there is
      // one place where persistence, versioning and error mapping live.
      doSave(config, JSON.stringify(config));
    }, AUTOSAVE_MS);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  // Retry when coming back online.
  useEffect(() => {
    const onOnline = () => {
      if (saveState === "offline" && dirty) save();
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveState, dirty, draftKey]);

  const reloadLatest = async () => {
    const fresh = await draft.refetch();
    const remote = fresh.data?.draft as Record<string, any> | null;
    if (remote) {
      setConfig(remote);
      setSavedKey(JSON.stringify(remote));
      setVersion(fresh.data?.draftVersion ?? conflictVersion ?? version);
    }
    setConflictVersion(null);
    setSaveState("saved");
    setFieldErrors({});
  };

  // Router-level guard: leaving with unsaved edits is a real data loss,
  // so it is confirmed rather than silently discarded.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    return dirty && currentLocation.pathname !== nextLocation.pathname;
  });

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // Check for failure before loading: a missing or foreign invitation
  // fails both queries, and reporting it as "loading" would leave the
  // user on a skeleton forever.
  if (invitation.isError || draft.isError) {
    const error = invitation.error ?? draft.error;
    const gone = error instanceof ApiError && error.status === 404;
    return (
      <Card withBorder padding="xl">
        <Stack align="center">
          <Title order={3}>{gone ? "Invitation not found" : "Could not load invitation"}</Title>
          <Text c="dimmed">
            {gone
              ? "It may have been deleted, or it belongs to another workspace."
              : "Please try again."}
          </Text>
          <Button component={Link} to="/invitations" variant="light">
            Back to invitations
          </Button>
        </Stack>
      </Card>
    );
  }

  if (invitation.isLoading || draft.isLoading || config === null) {
    return <Skeleton height={400} />;
  }

  const inv = invitation.data!.invitation;
  const activeTab = location.pathname.split("/").pop() ?? "content";

  const refreshPreview = () => {
    const mint = () =>
      createPreview.mutate(undefined, {
        onSuccess: (res) => setPreviewUrl(res.url),
        onError: () =>
          notifications.show({ message: "Could not create a preview link", color: "red" }),
      });
    // The preview renders the SAVED draft through the real guest
    // renderer — never a fake approximation. Save first when dirty.
    if (dirty) {
      doSave(config, draftKey);
      const unsub = setInterval(() => {
        if (!saveDraft.isPending) {
          clearInterval(unsub);
          mint();
        }
      }, 300);
      setTimeout(() => clearInterval(unsub), 8000);
    } else {
      mint();
    }
  };

  const saveLabel: Record<SaveState, string> = {
    saved: dirty ? "Saved" : "Saved",
    saving: "Saving…",
    offline: "Offline — will retry",
    conflict: "Conflict — review needed",
    failed: "Save failed — retry",
  };

  const ctx: EditorContextValue = {
    invitationId: id,
    config,
    manifest: draft.data!.manifest,
    update: (patch) => setConfig((prev) => merge(prev, patch)),
    replace: (next) => setConfig(next),
    dirty,
    save,
    saving: saveDraft.isPending,
    saveState,
    draftVersion: version,
    fieldErrors,
    status: inv.status,
  };

  return (
    <EditorContext.Provider value={ctx}>
      <Stack>
        <Group justify="space-between" align="flex-start" wrap="wrap">
          <div>
            <Group gap="xs">
              <Title order={2}>{inv.title}</Title>
              <Badge color={STATUS_COLOR[inv.status]} variant="light">
                {inv.status}
              </Badge>
              <Badge
                color={
                  saveState === "saved" ? "green" : saveState === "saving" ? "blue" : saveState === "conflict" || saveState === "failed" ? "red" : "gray"
                }
                variant="dot"
                role="status"
              >
                {saveLabel[saveState]}
              </Badge>
            </Group>
            <Text size="sm" c="dimmed">
              /i/{inv.slug} · saved {timeAgo(draft.data?.draftUpdatedAt)}
            </Text>
          </div>

          <Group>
            <Button
              variant="default"
              leftSection={
                createPreview.isPending ? <Loader size={14} /> : <IconRefresh size={16} />
              }
              onClick={refreshPreview}
              title="Render the saved draft in the real guest renderer, side by side"
            >
              {previewUrl ? "Refresh preview" : "Live preview"}
            </Button>
            <Button
              leftSection={<IconDeviceFloppy size={16} />}
              onClick={save}
              loading={saveDraft.isPending}
              // Disabled once everything is persisted — that idle state is
              // the editor's "nothing outstanding" signal, and autosave
              // reaching it is the normal path.
              disabled={!dirty || saveState === "conflict"}
            >
              Save draft
            </Button>
          </Group>
        </Group>

        {saveState === "conflict" && (
          <Alert color="red" title="Someone else saved a newer draft" role="alert">
            <Text size="sm">
              This copy was saved in another tab or device (version {conflictVersion}). Saving
              over it would discard their work.
            </Text>
            <Group mt="sm">
              <Button size="xs" onClick={reloadLatest}>
                Load their version (discards my unsaved edits)
              </Button>
            </Group>
          </Alert>
        )}
        {(saveState === "offline" || saveState === "failed") && (
          <Alert color="yellow" title={saveState === "offline" ? "You are offline" : "Could not save"} role="alert">
            <Text size="sm">Your edits are kept here. We will retry automatically.</Text>
            <Group mt="sm">
              <Button size="xs" variant="default" onClick={save}>
                Retry now
              </Button>
            </Group>
          </Alert>
        )}

        <Tabs value={activeTab} keepMounted={false}>
          <Tabs.List>
            {TABS.map((tab) => (
              <Tabs.Tab
                key={tab.value}
                value={tab.value}
                component={Link}
                {...{ to: `/invitations/${id}/${tab.value}` }}
              >
                {tab.label}
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs>

        {previewUrl ? (
          <Grid>
            <Grid.Col span={{ base: 12, lg: 6 }}>
              <Outlet />
            </Grid.Col>
            <Grid.Col span={{ base: 12, lg: 6 }}>
              <Stack gap="xs">
                <Group justify="space-between">
                  <SegmentedControl
                    size="xs"
                    value={previewWidth}
                    onChange={setPreviewWidth}
                    data={[
                      { label: "375", value: "375" },
                      { label: "430", value: "430" },
                      { label: "Full", value: "100%" },
                    ]}
                    aria-label="Preview width"
                  />
                  <Button
                    size="xs"
                    variant="subtle"
                    leftSection={<IconEye size={14} />}
                    component="a"
                    href={previewUrl}
                    target="_blank"
                    rel="noopener"
                  >
                    Open full page
                  </Button>
                </Group>
                <Card withBorder padding={0} style={{ overflow: "hidden" }}>
                  <iframe
                    title="Live invitation preview"
                    src={previewUrl}
                    style={{
                      width: previewWidth === "100%" ? "100%" : `${previewWidth}px`,
                      maxWidth: "100%",
                      height: 720,
                      border: 0,
                      display: "block",
                      margin: "0 auto",
                      background: "#fff",
                    }}
                  />
                </Card>
              </Stack>
            </Grid.Col>
          </Grid>
        ) : (
          <Outlet />
        )}
      </Stack>

      <Modal
        opened={blocker.state === "blocked"}
        onClose={() => blocker.reset?.()}
        title="Discard unsaved changes?"
        centered
      >
        <Text size="sm" c="dimmed">
          Your edits have not been saved to the draft yet.
        </Text>
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={() => blocker.reset?.()}>
            Keep editing
          </Button>
          <Button color="red" onClick={() => blocker.proceed?.()}>
            Discard
          </Button>
        </Group>
      </Modal>
    </EditorContext.Provider>
  );
}
