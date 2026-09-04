/**
 * Starter content for a newly created invitation.
 *
 * This is NOT the frozen fixture.
 *
 * `public/themes/cinematic-classic/js/defaults.js` holds the accepted
 * baseline used by the visual regression suite, and its values must not
 * change — the screenshots depend on them. But those values are one
 * couple's real wedding, and a stranger who clones this repository should
 * not find their names in a new invitation.
 *
 * So the two are separated:
 *
 *   defaults.js   frozen renderer fallbacks + the regression fixture
 *   starter.ts    what a tenant's new invitation is seeded with
 *
 * Everything below is deliberately fictional and clearly placeholder, so
 * an unfinished invitation reads as unfinished rather than as somebody
 * else's wedding.
 */

/** Roughly a year out, so the countdown is meaningful on first render. */
function defaultCeremonyDate(): string {
  const d = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T11:00:00+00:00`;
}

export function starterConfig(themeId = "cinematic-classic"): Record<string, unknown> {
  const iso = defaultCeremonyDate();

  if (themeId === "modern-editorial") {
    return {
      themeId: "modern-editorial",
      themeVersion: 1,
      couple: { partnerA: "Alex", partnerB: "Jamie", tagline: "Together with our families" },
      date: { iso, label: "", durationHours: 4 },
      copy: {
        hero: { kicker: "The Wedding Of", title: "Alex & Jamie", subtitle: "Together with our families, we invite you to celebrate" },
        couple: { heading: "The Couple", body: "Two stories, one beginning. We cannot wait to celebrate with you." },
        schedule: { heading: "Schedule", note: "Doors open thirty minutes before the ceremony." },
        venue: { heading: "Venue", note: "" },
        rsvp: { heading: "RSVP", body: "Kindly let us know if you can join us." },
      },
      schedule: {
        items: [
          { time: "11:00", title: "Ceremony", note: "" },
          { time: "12:30", title: "Lunch", note: "" },
        ],
      },
      venue: { tba: true, name: "", address: "", mapsUrl: "" },
      rsvp: {
        deadlineISO: new Date(Date.parse(iso) - 14 * 24 * 60 * 60 * 1000)
          .toISOString()
          .replace(/\.\d{3}Z$/, "+00:00"),
        maxGuests: 12,
      },
      media: {
        cover: { assetId: null },
        gallery_1: { assetId: null },
        gallery_2: { assetId: null },
        gallery_3: { assetId: null },
        venue: { assetId: null },
      },
      music: { assetId: null, enabled: false, title: "" },
      motion: { level: "subtle" },
      tokens: { accent: "#1a1a1a", paper: "#ffffff", ink: "#1a1a1a", typePreset: "mixed" },
      sections: { hero: true, couple: true, schedule: true, gallery: true, venue: true, rsvp: true },
    };
  }

  return {
    themeId: "cinematic-classic",
    themeVersion: 1,
    couple: {
      groom: { zh: "Alex", en: "ALEX" },
      bride: { zh: "Jamie", en: "JAMIE" },
    },
    date: {
      iso,
      // Left empty: the lunar line is authored by hand and omitted
      // entirely when blank, rather than shown as a placeholder.
      lunar: "",
      timeLabel: "11:00",
      durationHours: 4,
    },
    copy: {
      cover: { bracket: "Our Wedding", welcome: "WELCOME TO OUR WEDDING" },
      poem: {
        heading: "Two stories, one beginning",
        lines: ["We found each other", "somewhere along the way", "and never looked back"],
        motif: "❦",
        after: ["Near or far", "you made us who we are", "please celebrate with us"],
      },
      portrait: { brideLabel: "Bride", groomLabel: "Groom" },
      story: {
        heading: "A new chapter\nbegins",
        announce: "We're getting married!",
        badge: "Invitation",
        invite: "We would love for you\nto be there",
        letter: [
          "You shaped who we became",
          "and the life we build.",
          "By the time this reaches you",
          "we are counting the days",
          "until we share the moment",
          "with the people who matter.",
        ],
        caption: "A lake, a summer, a moon, a home",
      },
      time: { heading: "When", quote: "I'm so happy I get to be next to you" },
      venue: {
        heading: "Where",
        tbaName: "Venue to be announced",
        tbaNote: "We will share the details soon",
        mapLabel: "View map",
        calendarLabel: "Add to calendar",
      },
      closing: {
        poem: ["Chasing the same horizon", "under the same warm sky", "our story is simple", "it is you"],
        thanks: "Thank you / for coming so far",
        thanksLine2: "See you there",
      },
      rsvp: {
        heading: "Please reply",
        deadlineLabel: "Kindly reply by {date}",
        name: "Name",
        attending: "Attending?",
        yes: "Joyfully accept",
        no: "Cannot make it",
        guests: "Number of guests",
        optionalToggle: "＋ Add contact details or a note",
        optionalToggleOpen: "－ Hide",
        phone: "Phone",
        instagram: "Instagram",
        contactHint: "A phone or Instagram helps us reach you",
        message: "A note for us",
        submit: "Send",
        submitting: "Sending…",
        successTitle: "Thank you",
        successBody: "We have your reply. See you there.",
        errors: {
          name: "Please enter your name",
          contact: "Please leave a phone or Instagram",
          network: "Could not send. Please try again",
          server: "Something went wrong. Try again",
        },
      },
    },
    venue: { tba: true, name: "", address: "", mapsUrl: "" },
    rsvp: {
      // Two weeks before the ceremony.
      deadlineISO: new Date(Date.parse(iso) - 14 * 24 * 60 * 60 * 1000)
        .toISOString()
        .replace(/\.\d{3}Z$/, "+00:00"),
      maxGuests: 12,
    },
    media: {
      hero: { assetId: null },
      portrait: { assetId: null },
      story: { assetId: null },
      landscape: { assetId: null },
      venue: { assetId: null },
      closing: { assetId: null },
    },
    music: { assetId: null, enabled: false, title: "" },
    motion: { driftPxPerSec: 46 },
  };
}
