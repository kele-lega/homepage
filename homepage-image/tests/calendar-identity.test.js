import { afterEach, beforeEach, expect, it, vi } from "vitest";
import createMockRes from "test-utils/create-mock-res";

const { httpProxy, getServiceWidget } = vi.hoisted(() => ({ httpProxy: vi.fn(), getServiceWidget: vi.fn() }));
vi.mock("utils/config/service-helpers", () => ({ default: getServiceWidget }));
vi.mock("utils/proxy/http", () => ({ httpProxy }));
vi.mock("utils/logger", () => ({ default: () => ({ debug: vi.fn() }) }));
import calendarProxyHandler from "widgets/calendar/proxy";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("HOMEPAGE_CALENDAR_ORIGIN", "http://ical-proxy:8089");
  httpProxy.mockResolvedValue([200, "text/calendar", Buffer.from("BEGIN:VCALENDAR\nEND:VCALENDAR")]);
});
afterEach(() => vi.unstubAllEnvs());

it("forwards each user's identity only to the internal calendar service", async () => {
  getServiceWidget.mockResolvedValue({ integrations: [{ name: "calendar", url: "http://ical-proxy:8089/basic.ics" }] });
  for (const user of ["kele", "wzj"]) {
    await calendarProxyHandler({ query: { group: "甲", service: "Calendar", endpoint: "calendar" }, headers: { "x-authenticated-user": user } }, createMockRes());
    expect(httpProxy).toHaveBeenLastCalledWith("http://ical-proxy:8089/basic.ics", { headers: { "X-Authenticated-User": user } });
  }
});

it("refuses an internal calendar request without an authenticated identity", async () => {
  getServiceWidget.mockResolvedValue({ integrations: [{ name: "calendar", url: "http://ical-proxy:8089/basic.ics" }] });
  const res = createMockRes();
  await calendarProxyHandler({ query: { group: "甲", service: "Calendar", endpoint: "calendar" } }, res);
  expect(res.statusCode).toBe(401);
  expect(httpProxy).not.toHaveBeenCalled();
});

it("does not disclose identity to external calendar providers", async () => {
  getServiceWidget.mockResolvedValue({ integrations: [{ name: "calendar", url: "https://example.com/calendar.ics" }] });
  await calendarProxyHandler({ query: { group: "甲", service: "Calendar", endpoint: "calendar" }, headers: { "x-authenticated-user": "kele" } }, createMockRes());
  expect(httpProxy).toHaveBeenCalledWith("https://example.com/calendar.ics", {});
});
