import { v2 as cloudinary } from "cloudinary";

/** What the photo routes need from Cloudinary. Tests inject a fake; nothing else calls the network. */
export interface PhotoStore {
  /** Cloud name and API key: public values the phone needs to upload. */
  readonly cloudName: string;
  readonly apiKey: string;
  /** Signature for uploading one image with exactly this public id and `type: authenticated`. */
  sign(publicId: string, timestamp: number): string;
  /** Signed delivery URL of the 240 px square thumbnail. */
  thumbUrl(publicId: string): string;
  /** Signed delivery URL of the image fitted within 1600 px. */
  url(publicId: string): string;
  /** Removes the image from Cloudinary. Rejects when Cloudinary refuses or can't be reached. */
  destroy(publicId: string): Promise<void>;
}

export const UPLOAD_TYPE = "authenticated";

/** The real store. The secret lives only in this closure and is never returned or logged. */
export function createCloudinaryStore(account: {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}): PhotoStore {
  const { cloudName, apiKey, apiSecret } = account;
  const deliver = (publicId: string, transformation: Record<string, unknown>) =>
    cloudinary.url(publicId, {
      cloud_name: cloudName,
      api_secret: apiSecret,
      secure: true,
      type: UPLOAD_TYPE,
      resource_type: "image",
      sign_url: true,
      format: "jpg",
      transformation: [transformation],
    });

  return {
    cloudName,
    apiKey,
    sign: (publicId, timestamp) =>
      cloudinary.utils.api_sign_request(
        { public_id: publicId, timestamp, type: UPLOAD_TYPE },
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
      } as const;
      const result = (await cloudinary.uploader.destroy(publicId, options)) as { result?: string };
      // "not found" means it is already gone, which is what we wanted.
      if (result.result !== "ok" && result.result !== "not found") {
        throw new Error(`Cloudinary destroy answered "${String(result.result)}".`);
      }
    },
  };
}
