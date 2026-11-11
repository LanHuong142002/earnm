/** True when Prisma rejected a write because of a unique constraint (error code P2002). */
export function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === "P2002";
}
