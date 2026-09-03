import { Alert, Card, Group, Slider, Stack, Text, Title } from "@mantine/core";

import { useEditor } from "./InvitationEditor";

/**
 * Motion.
 *
 * Only what the theme declares as safe. There is deliberately no control
 * to override prefers-reduced-motion: a guest who has asked their device
 * to stop animating should not be overridden by a tenant setting.
 */
export function MotionPanel() {
  const { config, manifest, update } = useEditor();
  const range = manifest.motion.driftPxPerSec;
  const value = config.motion?.driftPxPerSec ?? range.default;

  return (
    <Stack maw={640}>
      <Card withBorder padding="md">
        <Title order={5}>Reading pace</Title>
        <Text size="sm" c="dimmed" mt={4}>
          How fast the invitation drifts upward. The default is the rate at which the original
          composition's copy stays readable as it passes.
        </Text>

        <Slider
          mt="lg"
          min={range.min}
          max={range.max}
          step={1}
          value={value}
          onChange={(v) => update({ motion: { driftPxPerSec: v } })}
          marks={[
            { value: range.min, label: "Slower" },
            { value: range.default, label: "Default" },
            { value: range.max, label: "Faster" },
          ]}
        />

        <Group justify="space-between" mt="xl">
          <Text size="sm" c="dimmed">
            {value} px per second
          </Text>
          {value !== range.default && (
            <Text
              size="sm"
              c="blue"
              style={{ cursor: "pointer" }}
              onClick={() => update({ motion: { driftPxPerSec: range.default } })}
            >
              Reset to default
            </Text>
          )}
        </Group>
      </Card>

      <Alert variant="light" color="gray">
        <Text size="sm">
          A supplied soundtrack overrides this: the canvas is retimed to the track so the
          invitation and the music finish together.
        </Text>
      </Alert>

      <Alert variant="light" color="gray">
        <Text size="sm">
          Guests who have reduced motion enabled always get a still canvas they can explore by
          hand. That preference cannot be overridden here, by design.
        </Text>
      </Alert>
    </Stack>
  );
}
