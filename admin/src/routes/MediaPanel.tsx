import { useState } from "react";
import { Dropzone, IMAGE_MIME_TYPE } from "@mantine/dropzone";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Grid,
  Group,
  Progress,
  Skeleton,
  Stack,
  Switch,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { modals } from "@mantine/modals";
import { IconMusic, IconPhoto, IconTrash, IconUpload, IconX } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";

import { useEditor } from "./InvitationEditor";
import { FocalPicker } from "../components/FocalPicker";
import { api, ApiError, type MediaAsset } from "../lib/api";
import { keys, useDeleteMedia, useMedia } from "../lib/queries";
import { formatBytes } from "../lib/format";

function uploadMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return "Upload failed. Check your connection.";
  switch (error.payload.error) {
    case "unsupported_type":
      return "That file type is not supported. Use JPEG, PNG, WebP or AVIF for photos.";
    case "file_too_large":
      return error.payload.limit
        ? `That file is larger than the ${formatBytes(error.payload.limit)} limit.`
        : "That file is too large.";
    case "quota_invitation_storage":
      return "This invitation has reached its storage limit.";
    case "quota_tenant_storage":
      return "Your workspace has reached its storage limit.";
    case "slot_kind_mismatch":
      return "That file is the wrong kind for this slot.";
    case "empty_file":
      return "That file is empty.";
    case "storage_unavailable":
      return "Storage is temporarily unavailable. Please try again.";
    case "metadata_write_failed":
      return "The upload was stored but could not be registered. Please retry.";
    default:
      return "Upload failed.";
  }
}

const SLOT_LABELS: Record<string, { title: string; hint: string }> = {
  hero: { title: "Hero", hint: "Fills the opening screen, with the title over it." },
  portrait: { title: "Portrait", hint: "Between the two names." },
  story: { title: "Story", hint: "Square photograph in the story chapter." },
  landscape: { title: "Landscape", hint: "Full-bleed scenic frame." },
  venue: { title: "Venue", hint: "Shown with the venue details." },
  closing: { title: "Closing", hint: "Behind the closing words." },
};

function ImageSlot({
  slot,
  asset,
  onUploaded,
}: {
  slot: string;
  asset: MediaAsset | undefined;
  onUploaded: () => void;
}) {
  const { invitationId, config, update, manifest } = useEditor();
  const removeMedia = useDeleteMedia(invitationId);
  const [progress, setProgress] = useState<number | null>(null);

  const meta = manifest.mediaSlots[slot];
  const ratio = meta?.ratio ?? "1 / 1";
  const labels = SLOT_LABELS[slot] ?? { title: slot, hint: "" };
  const focal = config.media?.[slot]?.focal ?? manifest.focal.default;

  const upload = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setProgress(0);
    try {
      const res = await api.upload(invitationId, file, {
        slot,
        onProgress: setProgress,
      });
      // A replacement is a NEW asset: the old object is untouched, so a
      // published revision keeps the exact bytes it shipped with.
      update({ media: { [slot]: { assetId: res.asset.id } } });
      onUploaded();
      notifications.show({ message: `${labels.title} uploaded`, color: "green" });
    } catch (err) {
      notifications.show({ title: "Upload failed", message: uploadMessage(err), color: "red" });
    } finally {
      setProgress(null);
    }
  };

  const clear = () => {
    update({ media: { [slot]: { assetId: null } } });
    if (asset) {
      removeMedia.mutate(asset.id, {
        onError: (err) => {
          // A published asset is protected; that is correct, and the
          // draft still stops pointing at it.
          if (err instanceof ApiError && err.payload.error === "asset_published") {
            notifications.show({
              message: "Removed from the draft. The published version keeps its copy.",
              color: "blue",
            });
          }
        },
      });
    }
  };

  return (
    <Card withBorder padding="md">
      <Group justify="space-between" mb="xs">
        <div>
          <Text fw={600}>{labels.title}</Text>
          <Text size="xs" c="dimmed">
            {labels.hint}
          </Text>
        </div>
        <Badge variant="light" size="sm">
          {ratio.replace(/\s/g, "")}
        </Badge>
      </Group>

      {asset ? (
        <Stack gap="xs">
          <FocalEditor
            slot={slot}
            assetId={asset.id}
            ratio={ratio}
            focal={focal}
            onChange={(next) => update({ media: { [slot]: { assetId: asset.id, focal: next } } })}
          />
          <Group justify="space-between">
            <Text size="xs" c="dimmed">
              {asset.width && asset.height ? `${asset.width}×${asset.height} · ` : ""}
              {formatBytes(asset.byteSize)}
            </Text>
            <Group gap={4}>
              <Dropzone
                onDrop={upload}
                accept={IMAGE_MIME_TYPE}
                multiple={false}
                activateOnClick
                p={0}
                style={{ border: "none", background: "none" }}
              >
                <Button size="xs" variant="light">
                  Replace
                </Button>
              </Dropzone>
              <Tooltip label="Remove from draft">
                <ActionIcon variant="subtle" color="red" onClick={clear} aria-label="Remove">
                  <IconTrash size={16} />
                </ActionIcon>
              </Tooltip>
            </Group>
          </Group>
        </Stack>
      ) : (
        <Dropzone
          onDrop={upload}
          accept={IMAGE_MIME_TYPE}
          multiple={false}
          loading={progress !== null}
        >
          <Stack align="center" gap={4} py="lg" style={{ aspectRatio: ratio, justifyContent: "center" }}>
            <Dropzone.Accept>
              <IconUpload size={28} />
            </Dropzone.Accept>
            <Dropzone.Reject>
              <IconX size={28} />
            </Dropzone.Reject>
            <Dropzone.Idle>
              <IconPhoto size={28} opacity={0.5} />
            </Dropzone.Idle>
            <Text size="sm" c="dimmed">
              Drop a photo or click
            </Text>
            <Text size="xs" c="dimmed">
              Leave empty to keep the placeholder
            </Text>
          </Stack>
        </Dropzone>
      )}

      {progress !== null && <Progress value={progress} mt="xs" size="sm" animated />}
    </Card>
  );
}

/** Split out so the picker only mounts when there is an image to position. */
function FocalEditor({
  assetId,
  ratio,
  focal,
  onChange,
}: {
  slot: string;
  assetId: string;
  ratio: string;
  focal: { x: number; y: number };
  onChange: (next: { x: number; y: number }) => void;
}) {
  return <FocalPicker src={`/media/${assetId}`} ratio={ratio} value={focal} onChange={onChange} />;
}

function MusicSlot({ asset, onUploaded }: { asset: MediaAsset | undefined; onUploaded: () => void }) {
  const { invitationId, config, update } = useEditor();
  const removeMedia = useDeleteMedia(invitationId);
  const [progress, setProgress] = useState<number | null>(null);

  const upload = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setProgress(0);
    try {
      const res = await api.upload(invitationId, file, {
        slot: "background_music",
        onProgress: setProgress,
      });
      update({ music: { assetId: res.asset.id, enabled: true } });
      onUploaded();
      notifications.show({ message: "Soundtrack uploaded", color: "green" });
    } catch (err) {
      notifications.show({ title: "Upload failed", message: uploadMessage(err), color: "red" });
    } finally {
      setProgress(null);
    }
  };

  return (
    <Card withBorder padding="md">
      <Group justify="space-between" mb="xs">
        <div>
          <Text fw={600}>Soundtrack</Text>
          <Text size="xs" c="dimmed">
            Plays behind the invitation and paces the canvas to its length.
          </Text>
        </div>
        <IconMusic size={18} opacity={0.5} />
      </Group>

      {asset ? (
        <Stack gap="sm">
          <Text size="sm">{asset.originalFilename}</Text>
          {/* The browser's own player: there is no reason to rebuild
              transport controls, and the public control stays frozen. */}
          <audio controls src={`/media/${asset.id}`} style={{ width: "100%" }} />
          <Group justify="space-between">
            <Text size="xs" c="dimmed">
              {formatBytes(asset.byteSize)}
            </Text>
            <Group gap="xs">
              <Dropzone
                onDrop={upload}
                accept={["audio/mpeg", "audio/mp4", "audio/ogg", "audio/wav"]}
                multiple={false}
                p={0}
                style={{ border: "none", background: "none" }}
              >
                <Button size="xs" variant="light">
                  Replace
                </Button>
              </Dropzone>
              <ActionIcon
                variant="subtle"
                color="red"
                aria-label="Remove soundtrack"
                onClick={() =>
                  modals.openConfirmModal({
                    title: "Remove soundtrack?",
                    children: <Text size="sm">The invitation will play in silence.</Text>,
                    labels: { confirm: "Remove", cancel: "Keep" },
                    confirmProps: { color: "red" },
                    onConfirm: () => {
                      update({ music: { assetId: null, enabled: false } });
                      removeMedia.mutate(asset.id);
                    },
                  })
                }
              >
                <IconTrash size={16} />
              </ActionIcon>
            </Group>
          </Group>
          <Switch
            label="Play music"
            description="When off, the control renders in its muted state."
            checked={config.music?.enabled === true}
            onChange={(e) => update({ music: { enabled: e.currentTarget.checked } })}
          />
        </Stack>
      ) : (
        <Dropzone
          onDrop={upload}
          accept={["audio/mpeg", "audio/mp4", "audio/ogg", "audio/wav"]}
          multiple={false}
          loading={progress !== null}
        >
          <Stack align="center" gap={4} py="lg">
            <IconMusic size={28} opacity={0.5} />
            <Text size="sm" c="dimmed">
              Drop an audio file or click
            </Text>
          </Stack>
        </Dropzone>
      )}

      {progress !== null && <Progress value={progress} mt="xs" size="sm" animated />}
    </Card>
  );
}

export function MediaPanel() {
  const { invitationId, config, manifest } = useEditor();
  const media = useMedia(invitationId);
  const qc = useQueryClient();

  if (media.isLoading) return <Skeleton height={320} />;

  const byId = new Map((media.data?.media ?? []).map((m) => [m.id, m]));
  const refresh = () => qc.invalidateQueries({ queryKey: keys.media(invitationId) });

  const imageSlots = Object.entries(manifest.mediaSlots)
    .filter(([, m]) => m.kind === "image")
    .map(([slot]) => slot);

  return (
    <Stack>
      <Alert variant="light" color="blue">
        <Text size="sm">
          Uploading never changes the live invitation. Photos go into your draft; guests see them
          once you publish.
        </Text>
      </Alert>

      <Title order={4}>Photography</Title>
      <Grid>
        {imageSlots.map((slot) => (
          <Grid.Col key={slot} span={{ base: 12, sm: 6, lg: 4 }}>
            <ImageSlot
              slot={slot}
              asset={byId.get(config.media?.[slot]?.assetId ?? "")}
              onUploaded={refresh}
            />
          </Grid.Col>
        ))}
      </Grid>

      <Title order={4} mt="md">
        Music
      </Title>
      <MusicSlot asset={byId.get(config.music?.assetId ?? "")} onUploaded={refresh} />
    </Stack>
  );
}
