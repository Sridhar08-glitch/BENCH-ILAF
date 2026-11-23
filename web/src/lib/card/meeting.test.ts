import { describe, expect, it } from "vitest";
import { hrefFor } from "./href";
import { itemLabel, platformOf } from "./catalogue";
import { MEETING_FORM_HREF, isMeetingForm, meetingProblem, meetingProvider, meetingUrl } from "./meeting";

describe("meeting links", () => {
  it("keeps https links and adds https to bare domains", () => {
    expect(meetingUrl("https://calendly.com/sara/30min")).toBe("https://calendly.com/sara/30min");
    expect(meetingUrl("cal.com/sara")).toBe("https://cal.com/sara");
    expect(meetingUrl("//cal.com/sara")).toBe("https://cal.com/sara");
  });
  it("refuses http, other schemes, spaces and hosts without a dot", () => {
    for (const v of ["http://calendly.com/a", "javascript:alert(1)", "tel:+97455550000", "mailto:a@b.co", "not a link", "localhost", "ftp://x.example.com", "https://user:pw@cal.com/a", ""]) {
      expect(meetingUrl(v), v).toBeNull();
    }
  });
  it("recognises the booking providers and nothing else", () => {
    expect(meetingProvider("calendly.com/sara")?.name).toBe("Calendly");
    expect(meetingProvider("https://calendar.app.google/abc123")?.name).toBe("Google Calendar");
    expect(meetingProvider("https://calendar.google.com/calendar/appointments/schedules/x")?.name).toBe("Google Calendar");
    expect(meetingProvider("https://cal.com/sara")?.name).toBe("Cal.com");
    expect(meetingProvider("https://app.cal.com/sara")?.name).toBe("Cal.com");
    expect(meetingProvider("https://outlook.office365.com/owa/calendar/x/bookings/")?.name).toBe("Microsoft Bookings");
    expect(meetingProvider("https://bookings.example.com/me")).toBeNull();
    expect(meetingProvider("https://evilcalendly.com/me")).toBeNull();
    expect(meetingProvider("http://calendly.com/me")).toBeNull();
  });
  it("explains a bad link in plain words and accepts empty and the form word", () => {
    expect(meetingProblem("")).toBeNull();
    expect(meetingProblem("form")).toBeNull();
    expect(meetingProblem("FORM")).toBeNull();
    expect(meetingProblem("https://calendly.com/a")).toBeNull();
    expect(meetingProblem("http://calendly.com/a")).toMatch(/https/);
    expect(meetingProblem("hello there")).toMatch(/booking page/);
  });
  it("turns into a link, or the form link", () => {
    expect(hrefFor("Meeting", "calendly.com/sara")).toBe("https://calendly.com/sara");
    expect(hrefFor("Meeting", "form")).toBe(MEETING_FORM_HREF);
    expect(hrefFor("Meeting", "http://x.example.com")).toBeNull();
    expect(hrefFor("Meeting", "javascript:alert(1)")).toBeNull();
    expect(isMeetingForm(" Form ")).toBe(true);
  });
  it("labels the button after the provider", () => {
    expect(itemLabel({ kind: "Meeting", value: "calendly.com/sara" })).toBe("Book on Calendly");
    expect(itemLabel({ kind: "Meeting", value: "example.com/book" })).toBe("Book a meeting");
    expect(itemLabel({ kind: "Meeting", value: "form" })).toBe("Book a meeting");
    expect(itemLabel({ kind: "Meeting", value: "form", label: "Let us talk" })).toBe("Let us talk");
    expect(platformOf("Meeting").name).toBe("Book a meeting");
  });
});
