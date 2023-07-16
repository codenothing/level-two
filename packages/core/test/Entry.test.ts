import { Entry } from "../src/Entry";
import { wait } from "./utils";

describe("Entry", () => {
  test("isStale should indicate entry is still usable, but should be refreshed", async () => {
    const entry = new Entry({
      id: "abc123",
      source: "local-cache",
      ttl: 30,
      staleCacheThreshold: 100,
    });
    expect(entry.isStale).toStrictEqual(false);

    await wait(50);
    expect(entry.isStale).toStrictEqual(true);
  });

  test("isExpired should indicate entry is fully expired, past stale threshold", async () => {
    const entry = new Entry({
      id: "abc123",
      source: "local-cache",
      ttl: 30,
      staleCacheThreshold: 100,
    });
    expect(entry.isExpired).toStrictEqual(false);

    // Should still be usable after stale threshold
    await wait(50);
    expect(entry.isStale).toStrictEqual(true);
    expect(entry.isExpired).toStrictEqual(false);

    await wait(150);
    expect(entry.isExpired).toStrictEqual(true);
  });
});
