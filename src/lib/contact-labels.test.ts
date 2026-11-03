import { describe, expect, it } from "vitest";
import { contactLabel, contactLabelText } from "./contact-labels";

describe("contact labels", () => {
  it("maps Privat to Pipedrive home and defaults to Büro", () => {
    expect(contactLabel({ phone_label: "home" }, "phone_label")).toBe("home");
    expect(contactLabelText("home")).toBe("Privat");
    expect(contactLabel({}, "email_label")).toBe("work");
    expect(contactLabelText("work")).toBe("Büro");
    expect(contactLabelText("other")).toBe("Sonstige");
  });
});
