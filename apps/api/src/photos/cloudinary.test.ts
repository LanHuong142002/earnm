import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createCloudinaryStore } from "./cloudinary.js";

const account = { cloudName: "demo", apiKey: "key123", apiSecret: "very-secret-value" };
const publicId = "earnm/p1/t1/0b7d2c2e-0000-4000-8000-000000000001";

describe("createCloudinaryStore", () => {
  const store = createCloudinaryStore(account);

  it("signs exactly the public id, timestamp and authenticated type", () => {
    const expected = createHash("sha1")
      .update(`public_id=${publicId}&timestamp=1700000000&type=authenticated${account.apiSecret}`)
      .digest("hex");
    expect(store.sign(publicId, 1700000000)).toBe(expected);
  });

  it("builds signed authenticated delivery URLs that never contain the secret", () => {
    for (const url of [store.thumbUrl(publicId), store.url(publicId)]) {
      expect(url).toMatch(/^https:\/\/res\.cloudinary\.com\/demo\/image\/authenticated\/s--[\w-]{8}--\//);
      expect(url).toContain(publicId);
      expect(url).not.toContain(account.apiSecret);
    }
    expect(store.thumbUrl(publicId)).toContain("w_240");
    expect(store.thumbUrl(publicId)).toContain("c_fill");
    expect(store.url(publicId)).toContain("w_1600");
    expect(store.url(publicId)).toContain("c_limit");
  });
});
