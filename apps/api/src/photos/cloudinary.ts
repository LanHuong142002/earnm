import { v2 as cloudinary } from "cloudinary";

/** What the photo routes need from Cloudinary. Tests inject a fake; nothing else calls the network. */
export interface PhotoStore {
  /** Cloud name and API key: public values the phone needs to upload. */
  readonly cloudName: string;
  readonly apiKey: string;
  /** Signature for uploading one image with exactly this public id, `type: authenticated` and `overwrite: false`. */
  sign(publicId: string, timestamp: number): string;
  /** Signed delivery URL of the 240 px square thumbnail. */
  thumbUrl(publicId: string): string;
  /** Signed delivery URL of the image fitted within 1600 px. */
  url(publicId: string): string;
  /** Removes the image from Cloudinary. Rejects when Cloudinary refuses or can't be reached. */
  destroy(publicId: string): Promise<void>;
  /**
   * Copies the stored original to a new image with its own public id (`type: authenticated`, never overwriting)
   * and answers the copy's pixel size. Rejects when Cloudinary refuses, times out or can't be reached.
   */
  copy(sourcePublicId: string, targetPublicId: string): Promise<{ width: number; height: number }>;
}

export const UPLOAD_TYPE = "authenticated";

/** A destroy or copy that hangs must not hold a connection forever. */
const DESTROY_TIMEOUT_MS = 10_000;

/** The real store. The secret lives only in this closure and is never returned or logged. */
export function createCloudinaryStore(account: {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}): PhotoStore {
  const { cloudName, apiKey, apiSecret } = account;
  const deliver = (publicId: string, transformation?: Record<string, unknown>) =>
    cloudinary.url(publicId, {
      cloud_name: cloudName,
      api_secret: apiSecret,
      secure: true,
      type: UPLOAD_TYPE,
      resource_type: "image",
      sign_url: true,
      format: "jpg",
      ...(transformation ? { transformation: [transformation] } : {}),
    });

  return {
    cloudName,
    apiKey,
    sign: (publicId, timestamp) =>
      cloudinary.utils.api_sign_request(
        { overwrite: false, public_id: publicId, timestamp, type: UPLOAD_TYPE },
        apiSecret,
      ),
    thumbUrl: (publicId) => deliver(publicId, { width: 240, height: 240, crop: "fill" }),
    url: (publicId) => deliver(publicId, { width: 1600, height: 1600, crop: "limit" }),
    async destroy(publicId) {
      // The SDK accepts account credentials per call, though its typings don't list them.
      const options = {
        cloud_name: cloudName,
        api_key: apiKey,
        api_secret: apiSecret,
        type: UPLOAD_TYPE,
        resource_type: "image",
        invalidate: true,
        timeout: DESTROY_TIMEOUT_MS,
      } as const;
      const result = (await cloudinary.uploader.destroy(publicId, options)) as { result?: string };
      // "not found" means it is already gone, which is what we wanted.
      if (result.result !== "ok" && result.result !== "not found") {
        throw new Error(`Cloudinary destroy answered "${String(result.result)}".`);
      }
    },
    async copy(sourcePublicId, targetPublicId) {
      const options = {
        cloud_name: cloudName,
        api_key: apiKey,
        api_secret: apiSecret,
        public_id: targetPublicId,
        type: UPLOAD_TYPE,
        resource_type: "image",
        overwrite: false,
        timeout: DESTROY_TIMEOUT_MS,
      } as const;
      let result: { width?: number; height?: number };
      try {
        // Cloudinary fetches the signed, untransformed original itself. The URL carries a signature, so it is never logged.
        result = await cloudinary.uploader.upload(deliver(sourcePublicId), options);
      } catch (cause) {
        // The SDK rejects with a plain object ({ error: { message, http_code } }), not an Error.
        const detail = (cause as { error?: { message?: string } } | undefined)?.error?.message;
        throw new Error(`Cloudinary copy failed${detail ? `: ${detail}` : "."}`);
      }
      if (typeof result.width !== "number" || typeof result.height !== "number") {
        throw new Error("Cloudinary copy answered without an image size.");
      }
      return { width: result.width, height: result.height };
    },
  };
}
