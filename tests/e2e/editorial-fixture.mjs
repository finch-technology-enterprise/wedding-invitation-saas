/**
 * Modern Editorial visual/functional fixture.
 *
 * Deliberately NEUTRAL content (Alex & Jamie): unlike the frozen
 * cinematic fixture — which pins one real couple for regression — this
 * fixture must never carry anyone's real wedding. See AGENTS.md.
 */

export const EDITORIAL_SLUG = "editorial-demo";

export const EDITORIAL_BOOTSTRAP = {
  slug: EDITORIAL_SLUG,
  revisionId: "rev-editorial-fixture",
  isPreview: false,
  locale: "en",
  strings: {
    rsvpHeading: "Please reply",
    rsvpName: "Name",
    rsvpAttending: "Attending?",
    rsvpYes: "Joyfully accept",
    rsvpNo: "Cannot make it",
    rsvpGuests: "Number of guests",
    rsvpPhone: "Phone",
    rsvpMessage: "A note for us",
    rsvpSubmit: "Send",
    rsvpSubmitting: "Sending…",
    rsvpSuccessTitle: "Thank you",
    rsvpSuccessBody: "We have your reply. See you there.",
    rsvpDeadline: "Kindly reply by {date}",
    countdownDays: "days",
    countdownHours: "hours",
    countdownMinutes: "minutes",
    countdownSeconds: "seconds",
    addToCalendar: "Add to calendar",
    viewMap: "View map",
    shareTitle: "Share this invitation",
    copyLink: "Copy link",
    copied: "Copied",
    openInvitation: "Open invitation",
    attending: "Attending",
    declined: "Declined",
    pending: "Pending",
  },
  party: null,
  mediaUrls: {},
  config: {
    themeId: "modern-editorial",
    themeVersion: 1,
    couple: { partnerA: "Alex", partnerB: "Jamie", tagline: "Together with our families" },
    date: { iso: "2027-10-09T11:00:00+08:00", label: "", durationHours: 4 },
    copy: {
      hero: {
        kicker: "The Wedding Of",
        title: "Alex & Jamie",
        subtitle: "Together with our families, we invite you to celebrate with us",
      },
      couple: { heading: "The Couple", body: "Two stories, one beginning.\nWe cannot wait to celebrate with you." },
      schedule: { heading: "Schedule", note: "Doors open thirty minutes before the ceremony." },
      venue: { heading: "Venue", note: "" },
      rsvp: { heading: "RSVP", body: "Kindly let us know if you can join us." },
    },
    schedule: {
      items: [
        { time: "11:00", title: "Ceremony", note: "Garden pavilion" },
        { time: "12:30", title: "Lunch", note: "Grand ballroom" },
        { time: "15:00", title: "Tea ceremony", note: "Family suite" },
      ],
    },
    venue: { tba: false, name: "The Majestic Hall", address: "5 Jalan Sultan, Kuala Lumpur", mapsUrl: "https://maps.example.com/majestic" },
    rsvp: { deadlineISO: "2027-09-30T23:59:59+08:00", maxGuests: 4 },
    media: {
      cover: { assetId: null },
      gallery_1: { assetId: null },
      gallery_2: { assetId: null },
      gallery_3: { assetId: null },
      venue: { assetId: null },
    },
    music: { assetId: null, enabled: false, title: "" },
    motion: { level: "still" },
    tokens: { accent: "#1a1a1a", paper: "#ffffff", ink: "#1a1a1a", typePreset: "mixed" },
    sections: { hero: true, couple: true, schedule: true, gallery: true, venue: true, rsvp: true },
  },
};
