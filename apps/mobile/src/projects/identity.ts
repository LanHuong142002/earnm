import { projectColors } from "../theme/tokens";

/** One of the project colours, picked from the id so it never changes and needs no field. */
export function projectColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return projectColors[hash % projectColors.length];
}

/** Up to 2 letters: the first letter of the first two words. Keeps diacritics ("Đào Ánh" -> "ĐÁ"). */
export function projectInitials(name: string): string {
  const words = name.normalize("NFC").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const out = words
    .slice(0, 2)
    .map((w) => Array.from(w)[0].toLocaleUpperCase())
    .join("");
  return out === "" ? "?" : out;
}
