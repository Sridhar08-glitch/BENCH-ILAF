import { describe, expect, it } from "vitest";
import { cleanDomainInput, cleanReplyTo, isFreeMailDomain, mailboxChoices } from "./company-trust";

describe("company trust helpers", () => {
  it("cleans a typed domain", () => {
    expect(cleanDomainInput(" @WWW.Northgate.com ")).toBe("northgate.com");
    expect(cleanDomainInput("https://northgate.com/about")).toBe("northgate.com");
    expect(cleanDomainInput("northgate.com")).toBe("northgate.com");
  });

  it("offers the three standard mailboxes once there is a domain", () => {
    expect(mailboxChoices("northgate.com")).toEqual(["admin", "postmaster", "webmaster"]);
    expect(mailboxChoices("")).toEqual(["admin"]);
  });

  it("cleans a reply-to address and spots free mail domains", () => {
    expect(cleanReplyTo(" People @Northgate.com ")).toBe("people@northgate.com");
    expect(cleanReplyTo("")).toBe("");
    expect(isFreeMailDomain("Gmail.com")).toBe(true);
    expect(isFreeMailDomain("northgate.com")).toBe(false);
  });
});
