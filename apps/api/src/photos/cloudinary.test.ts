import { createHash } from "node:crypto";
import { v2 as cloudinary } from "cloudinary";
import { describe, expect, it, vi } from "vitest";
import { createCloudinaryStore } from "./cloudinary.js";

const account = { cloudName: "demo", apiKey: "key123", apiSecret: "very-secret-value" };
const publicId = "earnm/p1/t1/0b7d2c2e-0000-4000-8000-000000000001";

describe("createCloudinaryStore", () => {
  const store = createCloudinaryStore(account);

  it("signs exactly overwrite=false, the public id, timestamp and authenticated type", () => {
    const expected = createHash("sha1")
      .update(`overwrite=false&public_id=${publicId}&timestamp=1700000000&type=authenticated${account.apiSecret}`)
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

  it("gives the destroy call a short timeout", async () => {
    const spy = vi.spyOn(cloudinary.uploader, "destroy").mockResolvedValue({ result: "ok" });
    try {
      await store.destroy(publicId);
      expect(spy).toHaveBeenCalledWith(publicId, expect.objectContaining({ timeout: 10_000 }));
    } finally {
      spy.mockRestore();
    }
  });
  describe("copy", () => {
    const target = "earnm/p1/d1/0b7d2c2e-0000-4000-8000-000000000002";

    it("uploads the signed original as a new authenticated image that never overwrites", async () => {
      const spy = vi.spyOn(cloudinary.uploader, "upload").mockResolvedValue({ width: 1200, height: 900 } as never);
      try {
        await expect(store.copy(publicId, target)).resolves.toEqual({ width: 1200, height: 900 });
        const [file, options] = spy.mock.calls[0] as unknown as [string, Record<string, unknown>];
        expect(file).toMatch(/^https:\/\/res\.cloudinary\.com\/demo\/image\/authenticated\/s--[\w-]{8}--\//);
        expect(file).toContain(publicId);
        expect(file).not.toMatch(/\/(w|h|c)_/);
        expect(file).not.toContain(account.apiSecret);
        expect(options).toMatchObject({
          public_id: target,
          type: "authenticated",
          overwrite: false,
          resource_type: "image",
          timeout: 10_000,
        });
      } finally {
        spy.mockRestore();
      }
    });

    it("rejects when Cloudinary answers with an error, without leaking the secret", async () => {
      const spy = vi
        .spyOn(cloudinary.uploader, "upload")
        .mockRejectedValue({ error: { message: "Resource already exists", http_code: 400 } });
      try {
        const error = await store.copy(publicId, target).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(Error);
        expect(String((error as Error).message)).not.toContain(account.apiSecret);
      } finally {
        spy.mockRestore();
      }
    });

    it("rejects when the upload answers without a size", async () => {
      const spy = vi.spyOn(cloudinary.uploader, "upload").mockResolvedValue({} as never);
      try {
        await expect(store.copy(publicId, target)).rejects.toThrow();
      } finally {
        spy.mockRestore();
      }
    });
  });
});
