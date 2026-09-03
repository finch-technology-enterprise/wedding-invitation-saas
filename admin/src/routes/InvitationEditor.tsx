import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link, Outlet, useBlocker, useLocation, useParams } from "react-router-dom";
import {
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Modal,
  Skeleton,
  Stack,
  Tabs,
  Text,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconDeviceFloppy, IconEye } from "@tabler/icons-react";

import { ApiError, type ThemeManifest } from "../lib/api";
import { useCreatePreview, useDraft, useInvitation, useSaveDraft } from "../lib/queries";
import { STATUS_COLOR, timeAgo } from "../lib/format";

/**
 * The draft the editor panels read and write.
 *
 * One config object is edited in memory and saved explicitly. Autosave is
 * deliberately absent: publishing is explicit, and silently persisting
 * half-finished edits would make "what is in my draft" unpredictable.
 */
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

const TABS = [
  { value: "content", label: "Content" },
  { value: "media", label: "Media" },
  { value: "motion", label: "Motion" },
  { value: "rsvp", label: "RSVP" },
  { value: "responses", label: "Responses" },
  { value: "sharing", label: "Sharing" },
  { value: "publish", label: "Publish" },
];

export function InvitationEditor() {
  const { id = "" } = useParams();
  const location = useLocation();
  const invitation = useInvitation(id);
  const draft = useDraft(id);
  const saveDraft = useSaveDraft(id);
  const createPreview = useCreatePreview(id);

  const [config, setConfig] = useState<Record<string, any> | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const savedRef = useRef<string>("");

  // Seed the working copy once the server draft arrives. Re-seeding on
  // every refetch would discard in-progress edits.
  useEffect(() => {
    if (!draft.data || config !== null) return;
    const initial = (draft.data.draft as Record<string, any>) ?? emptyConfig();
    savedRef.current = JSON.stringify(initial);
    setConfig(initial);
  }, [draft.data, config]);

  const dirty = useMemo(
    () => config !== null && JSON.stringify(config) !== savedRef.current,
    [config]
  );

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

  const save = () => {
    setFieldErrors({});
    saveDraft.mutate(config, {
      onSuccess: () => {
        savedRef.current = JSON.stringify(config);
        // Force the dirty memo to recompute against the new baseline.
        setConfig({ ...config });
        notifications.show({ message: "Draft saved", color: "green" });
      },
      onError: (err) => {
        // Failed saves keep the user's values — only the errors are new.
        if (err instanceof ApiError && err.payload.errors) {
          setFieldErrors(err.fieldErrors);
          notifications.show({
            title: "Could not save",
            message: "Some fields need attention.",
            color: "red",
          });
        } else {
          notifications.show({
            title: "Could not save",
            message: "Please try again.",
            color: "red",
          });
        }
      },
    });
  };

  const openPreview = () => {
    createPreview.mutate(undefined, {
      onSuccess: (res) => window.open(res.url, "_blank", "noopener"),
      onError: () =>
        notifications.show({ message: "Could not create a preview link", color: "red" }),
    });
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
              {dirty && (
                <Badge color="orange" variant="dot">
                  Unsaved changes
                </Badge>
              )}
            </Group>
            <Text size="sm" c="dimmed">
              /i/{inv.slug} · saved {timeAgo(draft.data?.draftUpdatedAt)}
            </Text>
          </div>

          <Group>
            <Button
              variant="default"
              leftSection={
                createPreview.isPending ? <Loader size={14} /> : <IconEye size={16} />
              }
              onClick={openPreview}
              disabled={dirty}
              title={dirty ? "Save your draft first" : "Open a preview of the saved draft"}
            >
              Preview
            </Button>
            <Button
              leftSection={<IconDeviceFloppy size={16} />}
              onClick={save}
              loading={saveDraft.isPending}
              disabled={!dirty}
            >
              Save draft
            </Button>
          </Group>
        </Group>

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

        <Outlet />
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
