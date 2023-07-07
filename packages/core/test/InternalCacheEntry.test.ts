import { InternalCacheEntry } from "../src/InternalCacheEntry";

describe("InternalCacheEntry", () => {
  test("getters should map to the entry properties", () => {
    const entry = new InternalCacheEntry({
      id: "abc123",
      source: "local-cache",
      value: "val123",
    });
    expect(entry.id).toStrictEqual(entry.entry.id);
    expect(entry.createdAt).toStrictEqual(entry.entry.createdAt);
    expect(entry.source).toStrictEqual(entry.entry.source);
    expect(entry.isStale).toStrictEqual(entry.entry.isStale);
    expect(entry.isExpired).toStrictEqual(entry.entry.isExpired);
  });

  test("upsert should extend the ttl and update the value", () => {
    const entry = new InternalCacheEntry({
      id: "abc123",
      source: "local-cache",
      value: "val123",
      ttl: 50,
    });

    const touchSpy = jest.spyOn(entry, "touch");

    entry.upsert("val654", 100, 500);
    expect(touchSpy).toHaveBeenCalledTimes(1);
    expect(touchSpy).toHaveBeenLastCalledWith(100, 500);
    expect(entry.value).toStrictEqual("val654");
  });

  test("touch should extend the ttl", () => {
    const entry = new InternalCacheEntry({
      id: "abc123",
      source: "local-cache",
      value: "val123",
      ttl: 50,
      staleCacheThreshold: 75,
    });
    expect(entry.ttl).toStrictEqual(50);
    expect(entry.staleCacheThreshold).toStrictEqual(75);

    entry.touch(100, 150);
    expect(entry.ttl).toStrictEqual(100);
    expect(entry.staleCacheThreshold).toStrictEqual(150);
  });
});
