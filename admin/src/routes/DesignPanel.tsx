/** Design: theme, locale, share metadata, theme tokens (V2 §2.3, §3.3–3.4). */
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Alert,
  Button,
  Card,
  ColorInput,
  Group,
  SegmentedControl,
  Select,
  Skeleton,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";

import { useEditor } from "./InvitationEditor";
import { api } from "../lib/api";
import { useInvitation } from "../lib/queries";

const LOCALES = [
  { value: "en", label: "English" },
  { value: "zh-CN", label: "简体中文" },
  { value: "zh-TW", label: "繁體中文" },
  { value: "ms", label: "Bahasa Melayu" },
];

export function DesignPanel() {
  const { id = "" } = useParams();
  const { config, update, save, dirty } = useEditor();
  const invitation = useInvitation(id);
  const [locale, setLocale] = useState<string>("zh-CN");
  const [shareTitle, setShareTitle] = useState("");
  const [shareDescription, setShareDescription] = useState("");

  useEffect(() => {
    const inv = invitation.data?.invitation as
      | { locale?: string; shareTitle?: string | null; shareDescription?: string | null }
      | undefined;
    if (inv) {
      setLocale(inv.locale ?? "zh-CN");
      setShareTitle(inv.shareTitle ?? "");
      setShareDescription(inv.shareDescription ?? "");
    }
  }, [invitation.data]);

  if (invitation.isLoading) return <Skeleton height={240} />;
  const inv = invitation.data?.invitation as { themeId?: string } | undefined;
  const themeId = inv?.themeId ?? "cinematic-classic";
  const isEditorial = themeId === "modern-editorial";
  const tokens = (config.tokens as Record<string, string> | undefined) ?? {};

  const saveMeta = async () => {
    try {
      await api.patch(`/invitations/${id}`, { locale, share_title: shareTitle || null, share_description: shareDescription || null });
      notifications.show({ message: "Design settings saved", color: "green" });
      void invitation.refetch();
    } catch {
      notifications.show({ message: "Could not save design settings", color: "red" });
    }
  };

  return (
    <Stack>
      <Card withBorder>
        <Title order={4}>Theme</Title>
        <Text size="sm" c="dimmed" mt={4}>
          {themeId === "cinematic-classic" ? "Cinematic Classic" : "Modern Editorial"} — chosen at
          creation. Switching themes after content is written would silently reinterpret it, so
          the theme is fixed once the invitation exists.
        </Text>
      </Card>

      <Card withBorder>
        <Title order={4}>Guest language</Title>
        <Text size="sm" c="dimmed" mt={4}>
          Controls system copy on the invitation — RSVP labels, countdown units, calendar and
          share text, accessibility labels. Your own names and stories stay exactly as written.
        </Text>
        <Select
          aria-label="Guest language"
          data={LOCALES}
          value={locale}
          onChange={(v) => v && setLocale(v)}
          mt="sm"
          maw={320}
          allowDeselect={false}
        />
      </Card>

      <Card withBorder>
        <Title order={4}>Sharing</Title>
        <Text size="sm" c="dimmed" mt={4}>
          Title and description for link previews (Open Graph), WhatsApp shares and search.
          Leave blank to use the invitation title.
        </Text>
        <Stack mt="sm" maw={520}>
          <TextInput
            label="Share title"
            value={shareTitle}
            onChange={(e) => setShareTitle(e.currentTarget.value.slice(0, 120))}
            placeholder="Alex & Jamie — Wedding Invitation"
          />
          <TextInput
            label="Share description"
            value={shareDescription}
            onChange={(e) => setShareDescription(e.currentTarget.value.slice(0, 300))}
            placeholder="Join us to celebrate…"
          />
        </Stack>
      </Card>

      {isEditorial ? (
        <Card withBorder>
          <Title order={4}>Editorial tokens</Title>
          <Text size="sm" c="dimmed" mt={4}>
            Bounded presentation settings declared by the theme. No custom CSS is accepted —
            these are the levers the design was built around.
          </Text>
          <Group mt="sm" grow>
            <ColorInput label="Accent" value={tokens.accent ?? "#1a1a1a"} onChange={(v) => update({ tokens: { accent: v } })} disallowInput={false} />
            <ColorInput label="Paper" value={tokens.paper ?? "#ffffff"} onChange={(v) => update({ tokens: { paper: v } })} disallowInput={false} />
            <ColorInput label="Ink" value={tokens.ink ?? "#1a1a1a"} onChange={(v) => update({ tokens: { ink: v } })} disallowInput={false} />
          </Group>
          <Group mt="sm">
            <div>
              <Text size="sm" mb={4}>Type</Text>
              <SegmentedControl
                value={tokens.typePreset ?? "mixed"}
                onChange={(v) => update({ tokens: { typePreset: v } })}
                data={[
                  { label: "Serif", value: "serif" },
                  { label: "Sans", value: "sans" },
                  { label: "Mixed", value: "mixed" },
                ]}
              />
            </div>
            <div>
              <Text size="sm" mb={4}>Motion</Text>
              <SegmentedControl
                value={(config.motion as { level?: string } | undefined)?.level ?? "subtle"}
                onChange={(v) => update({ motion: { level: v } })}
                data={[
                  { label: "Still", value: "still" },
                  { label: "Subtle", value: "subtle" },
                  { label: "Gentle", value: "gentle" },
                ]}
              />
            </div>
          </Group>
          {dirty && (
            <Alert color="blue" mt="sm">
              Token changes live in the draft — press Save draft, then Live preview to see them.
            </Alert>
          )}
        </Card>
      ) : (
        <Card withBorder>
          <Title order={4}>Motion</Title>
          <Text size="sm" c="dimmed" mt={4}>
            The canvas drift rate, in the theme's narrow readable range. Edited under Motion.
          </Text>
        </Card>
      )}

      <Group>
        <Button
          onClick={() => {
            void saveMeta();
            if (dirty) save();
          }}
        >
          Save design settings
        </Button>
      </Group>
    </Stack>
  );
}
