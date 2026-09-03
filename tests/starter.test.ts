/**
 * The starter content a new invitation is seeded with must satisfy the
 * theme it is seeded into. It is English placeholder copy, while the
 * limits were measured against CJK — so it is easy to exceed them by
 * accident, and a stranger's first invitation would fail to save.
 */
import { describe, expect, test } from "vitest";
import { starterConfig } from "../src/themes/starter.js";
import { validateConfig } from "../src/themes/cinematic-classic.js";

describe("starter content", () => {
  test("validates against the cinematic theme", () => {
    const result = validateConfig(starterConfig());
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  test("contains no real names from the frozen fixture", () => {
    const json = JSON.stringify(starterConfig());
    expect(json).not.toContain("李天豪");
    expect(json).not.toContain("刘蔼蕴");
    expect(json).not.toContain("LEE THEAN HOW");
    expect(json).not.toContain("LAW HAI YEUN");
  });

  test("uses clearly fictional placeholders", () => {
    const config = starterConfig() as any;
    expect(config.couple.groom.zh).toBe("Alex");
    expect(config.couple.bride.zh).toBe("Jamie");
    // Venue unset, so a half-finished invitation reads as unfinished.
    expect(config.venue.tba).toBe(true);
  });

  test("the ceremony date is in the future so the countdown works", () => {
    const config = starterConfig() as any;
    expect(Date.parse(config.date.iso)).toBeGreaterThan(Date.now());
    expect(Date.parse(config.rsvp.deadlineISO)).toBeLessThan(Date.parse(config.date.iso));
  });
});
