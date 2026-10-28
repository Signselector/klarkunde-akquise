import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CallbackReminder } from "./callback-reminder";
const fixture = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), { warning: vi.fn(), dismiss: vi.fn() }),
  navigate: vi.fn(),
  path: "/dashboard",
  rows: [
    {
      id: "callback-1",
      due_at: "2026-01-01T10:00:00Z",
      lead: { id: "lead-1", company: "Testfirma" },
    },
  ],
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: fixture.rows }) }));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => fixture.navigate,
  useLocation: () => ({ pathname: fixture.path }),
}));
vi.mock("@/lib/country", () => ({ useCountry: () => "AT" }));
vi.mock("sonner", () => ({ toast: fixture.toast }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  fixture.path = "/dashboard";
});
it("shows one persistent toast per due callback and links to the callbacks page", () => {
  const view = render(<CallbackReminder userId="caller" />);
  view.rerender(<CallbackReminder userId="caller" />);
  expect(fixture.toast.warning).toHaveBeenCalledTimes(1);
  const [title, options] = fixture.toast.warning.mock.calls[0]!;
  expect(title).toBe("Rückruf fällig");
  expect(options.id).toBe("callback-callback-1");
  expect(options.duration).toBe(Infinity);
  expect(options.closeButton).toBe(true);
  expect(options.action.label).toBe("Zu den Rückrufen");
  options.action.onClick();
  expect(fixture.toast.dismiss).toHaveBeenCalledWith("callback-callback-1");
  expect(fixture.navigate).toHaveBeenCalledWith({ to: "/callbacks" });
});
it("shows nothing on the callbacks page and closes existing reminders", () => {
  fixture.path = "/callbacks";
  render(<CallbackReminder userId="caller" />);
  expect(fixture.toast.warning).not.toHaveBeenCalled();
  expect(fixture.toast.dismiss).toHaveBeenCalledWith("callback-callback-1");
});
