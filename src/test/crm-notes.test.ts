import { describe, expect, it } from "vitest";
import { dimensionsNote, websiteCategoryNote } from "@/lib/crm-sync";

const lead = (extra: Record<string, unknown>) => ({ id: "l", company: null, contact_name: null, email: null, phone: null, extra });

describe("extra Pipedrive notes", () => {
  it("dimensions become an own note headed 'Maße:'", () => {
    expect(dimensionsNote({ dimensions: "200cm Breite\n200cm Höhe" })).toBe("Maße:\n\n200cm Breite\n200cm Höhe");
    expect(dimensionsNote({ dimensions: "  " })).toBeNull();
  });
  it("website and category go into one note, only known lines", () => {
    expect(websiteCategoryNote(lead({ Website: "http://www.reese-kfz.de/", Category: "Fahrzeughändler" }))).toBe(
      "🌐 Website: http://www.reese-kfz.de/\n📁 Category: Fahrzeughändler",
    );
    expect(websiteCategoryNote(lead({ branche: "Bäckerei" }))).toBe("📁 Category: Bäckerei");
    expect(websiteCategoryNote(lead({}))).toBeNull();
  });
});
