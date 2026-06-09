import { describe, expect, test, afterEach, spyOn } from "bun:test";
import { app } from "../src/App.js";

afterEach(() => {
  if (app.execute.mockRestore) {
    app.execute.mockRestore();
  }
});

describe("App.executeBatch", () => {
  test("returns zero-counts report for empty list and never invokes execute", async () => {
    const spy = spyOn(app, "execute").mockResolvedValue(undefined);
    const report = await app.executeBatch([]);
    expect(report).toEqual({ total: 0, ok: 0, failed: 0, results: [] });
    expect(spy).not.toHaveBeenCalled();
  });

  test("aggregates all successes when every URL succeeds", async () => {
    const spy = spyOn(app, "execute").mockResolvedValue(undefined);
    const urls = ["https://a.example/1", "https://b.example/2", "https://c.example/3"];
    const report = await app.executeBatch(urls);
    expect(spy).toHaveBeenCalledTimes(3);
    expect(report.total).toBe(3);
    expect(report.ok).toBe(3);
    expect(report.failed).toBe(0);
    expect(report.results.map((r) => r.status)).toEqual(["ok", "ok", "ok"]);
  });

  test("continues after a failure and aggregates failed URLs with messages", async () => {
    const spy = spyOn(app, "execute").mockImplementation(async (url) => {
      if (url.includes("/2")) {
        throw new Error("boom");
      }
    });
    const urls = ["https://a.example/1", "https://b.example/2", "https://c.example/3"];
    const report = await app.executeBatch(urls);
    expect(spy).toHaveBeenCalledTimes(3);
    expect(report.total).toBe(3);
    expect(report.ok).toBe(2);
    expect(report.failed).toBe(1);
    expect(report.results[1]).toEqual({
      url: "https://b.example/2",
      status: "fail",
      error: "boom",
    });
  });

  test("captures failures for all URLs when all fail", async () => {
    spyOn(app, "execute").mockRejectedValue(new Error("nope"));
    const report = await app.executeBatch(["https://a.example/1", "https://b.example/2"]);
    expect(report.ok).toBe(0);
    expect(report.failed).toBe(2);
    expect(report.results.every((r) => r.status === "fail" && r.error === "nope")).toBe(true);
  });
});
