import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it } from "vitest";
import { LeadContact } from "./workspace-parts";

afterEach(cleanup);

it("does not turn an executable imported website into a link", () => {
  render(
    <LeadContact
      phone={null}
      email={null}
      city={null}
      extra={{ website: "javascript:alert(1)" }}
    />,
  );
  expect(screen.getByText("javascript:alert(1)")).toBeInTheDocument();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});

it("normalizes a website without protocol and safely opens it separately", () => {
  render(
    <LeadContact
      phone={null}
      email={null}
      city={null}
      extra={{ Website: "example.test/kontakt" }}
    />,
  );
  const link = screen.getByRole("link");
  expect(link).toHaveAttribute("href", "https://example.test/kontakt");
  expect(link).toHaveAttribute("rel", "noopener noreferrer");
});

it("encodes an imported address in the map link", () => {
  render(
    <LeadContact
      phone={null}
      email={null}
      city="Wien"
      extra={{ Adresse: "Beispielgasse 1 & 2" }}
    />,
  );
  const url = new URL(screen.getByRole("link").getAttribute("href")!);
  expect(url.origin).toBe("https://www.google.com");
  expect(url.searchParams.get("query")).toBe("Beispielgasse 1 & 2, Wien");
});
