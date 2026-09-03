import { Accordion, Alert, Card, Grid, NumberInput, Stack, Switch, Text, TextInput } from "@mantine/core";
import { DateTimePicker } from "@mantine/dates";

import { useEditor } from "./InvitationEditor";
import { LimitedField, LimitedList } from "../components/LimitedField";

/** ISO-8601 with an explicit offset, which is what the theme requires.
 *  Derived from the picker's local value plus the browser's offset. */
function toIsoWithOffset(date: Date | null): string {
  if (!date) return "";
  const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, "0");
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(offsetMin / 60)}:${pad(offsetMin % 60)}`
  );
}

function fromIso(iso: unknown): Date | null {
  if (typeof iso !== "string" || !iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function ContentPanel() {
  const { config, update, fieldErrors } = useEditor();

  return (
    <Stack>
      <Alert variant="light" color="blue">
        <Text size="sm">
          This theme was composed for short, bounded copy. Each field shows its limit — staying
          within it is what keeps the layout looking the way it was designed.
        </Text>
      </Alert>

      <Accordion multiple defaultValue={["couple", "date"]} variant="separated">
        <Accordion.Item value="couple">
          <Accordion.Control>Names</Accordion.Control>
          <Accordion.Panel>
            <Grid>
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <Stack>
                  <LimitedField path="couple.groom.zh" label="Partner 1 — name" />
                  <LimitedField
                    path="couple.groom.en"
                    label="Partner 1 — Latin name"
                    description="Optional. Shown in small capitals beneath the name."
                  />
                </Stack>
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <Stack>
                  <LimitedField path="couple.bride.zh" label="Partner 2 — name" />
                  <LimitedField path="couple.bride.en" label="Partner 2 — Latin name" />
                </Stack>
              </Grid.Col>
            </Grid>
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="date">
          <Accordion.Control>Date and time</Accordion.Control>
          <Accordion.Panel>
            <Stack>
              <Card withBorder padding="sm" bg="var(--mantine-color-gray-0)">
                <Text size="xs" c="dimmed">
                  The weekday, calendar grid, countdown and calendar download are all derived from
                  this one value — there is nothing else to keep in step.
                </Text>
              </Card>

              <DateTimePicker
                label="Ceremony starts"
                required
                value={fromIso(config.date?.iso)}
                error={fieldErrors["date.iso"]}
                onChange={(value) =>
                  update({ date: { iso: toIsoWithOffset(value ? new Date(value) : null) } })
                }
              />

              <NumberInput
                label="Duration (hours)"
                description="Used for the calendar download."
                min={1}
                max={24}
                value={config.date?.durationHours ?? 4}
                error={fieldErrors["date.durationHours"]}
                onChange={(v) => update({ date: { durationHours: Number(v) || 4 } })}
              />

              <LimitedField
                path="date.timeLabel"
                label="Time label"
                description="Shown beside the date, e.g. 11:00"
              />
              <LimitedField
                path="date.lunar"
                label="Lunar date"
                description="Optional. Not computable without a lunar table, so it is written by hand."
              />
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="cover">
          <Accordion.Control>Cover</Accordion.Control>
          <Accordion.Panel>
            <Stack>
              <LimitedField path="copy.cover.bracket" label="Bracketed title" />
              <LimitedField path="copy.cover.welcome" label="Welcome line" />
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="poem">
          <Accordion.Control>Opening poem</Accordion.Control>
          <Accordion.Panel>
            <Stack>
              <LimitedField path="copy.poem.heading" label="Heading" />
              <LimitedList path="copy.poem.lines" label="Lines before the motif" description="One line per row." />
              <LimitedField path="copy.poem.motif" label="Motif" />
              <LimitedList path="copy.poem.after" label="Lines after the motif" />
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="portrait">
          <Accordion.Control>Portrait labels</Accordion.Control>
          <Accordion.Panel>
            <Grid>
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <LimitedField path="copy.portrait.brideLabel" label="Left label" />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <LimitedField path="copy.portrait.groomLabel" label="Right label" />
              </Grid.Col>
            </Grid>
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="story">
          <Accordion.Control>Story</Accordion.Control>
          <Accordion.Panel>
            <Stack>
              <LimitedField path="copy.story.heading" label="Heading" />
              <LimitedField path="copy.story.announce" label="Announcement" />
              <LimitedField path="copy.story.badge" label="Badge" />
              <LimitedField path="copy.story.invite" label="Invitation line" />
              <LimitedList path="copy.story.letter" label="Letter" />
              <LimitedField path="copy.story.caption" label="Caption" />
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="time">
          <Accordion.Control>Wedding time section</Accordion.Control>
          <Accordion.Panel>
            <Stack>
              <LimitedField path="copy.time.heading" label="Heading" />
              <LimitedField path="copy.time.quote" label="Quote" />
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="venue">
          <Accordion.Control>Venue</Accordion.Control>
          <Accordion.Panel>
            <Stack>
              <Switch
                label="Venue is not announced yet"
                description="Shows a graceful 'to be announced' treatment instead of an address."
                checked={config.venue?.tba !== false}
                onChange={(e) => update({ venue: { tba: e.currentTarget.checked } })}
              />

              {config.venue?.tba !== false ? (
                <>
                  <LimitedField path="copy.venue.tbaName" label="Placeholder name" />
                  <LimitedField path="copy.venue.tbaNote" label="Placeholder note" />
                </>
              ) : (
                <>
                  <LimitedField path="venue.name" label="Venue name" />
                  <LimitedField path="venue.address" label="Address" />
                  <TextInput
                    label="Maps link"
                    description="Optional. Adds a 'view map' action."
                    placeholder="https://maps.google.com/..."
                    value={config.venue?.mapsUrl ?? ""}
                    error={fieldErrors["venue.mapsUrl"]}
                    onChange={(e) => update({ venue: { mapsUrl: e.currentTarget.value } })}
                  />
                </>
              )}

              <LimitedField path="copy.venue.heading" label="Section heading" />
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="closing">
          <Accordion.Control>Closing</Accordion.Control>
          <Accordion.Panel>
            <Stack>
              <LimitedList path="copy.closing.poem" label="Closing poem" />
              <LimitedField path="copy.closing.thanks" label="Thanks" />
              <LimitedField path="copy.closing.thanksLine2" label="Sign-off" />
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Stack>
  );
}
