import { randomUUID } from "expo-crypto";

/** A fresh client-side project id (uuid). Kept separate so tests never import native code. */
export const newProjectId = (): string => randomUUID();
