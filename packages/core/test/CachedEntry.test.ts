import { CachedEntry } from "../src/CachedEntry";

describe("CachedEntry", () => {
  test("should enforce value to be required", () => {
    const entry = new CachedEntry({
      id: "abc123",
      source: "local-cache",
      ttl: 30,
      staleCacheThreshold: 100,
      value: "foobar123",
    });
    expect(entry.value).toStrictEqual("foobar123");
  });
});
