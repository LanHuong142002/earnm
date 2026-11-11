/** Route names in the Home stack (the file names under app/(app)/(home)). */
export const HOME_ROUTE = "index";
export const LIST_ROUTE = "projects/index";

/** One step on the Home stack, in the form the stack router's `dispatch` takes. */
export type StackStep =
  | { type: "POP"; payload: { count: number } }
  | { type: "POP_TO_TOP" }
  | { type: "REPLACE"; payload: { name: string } }
  | { type: "PUSH"; payload: { name: string } };

/**
 * Steps that take the person to the Project list given the Home stack's current route names.
 * - The list is already in the stack: pop back to it (so no copy of it is added, and nothing above it stays).
 * - Otherwise reset to exactly [Home, List] (nothing of the screens that were open stays, for a
 *   deleted project).
 */
export function stepsToList(routeNames: string[]): StackStep[] {
  const at = routeNames.lastIndexOf(LIST_ROUTE);
  if (at >= 0) {
    const count = routeNames.length - 1 - at;
    return count > 0 ? [{ type: "POP", payload: { count } }] : [];
  }
  const push: StackStep = { type: "PUSH", payload: { name: LIST_ROUTE } };
  const steps: StackStep[] = [{ type: "POP_TO_TOP" }];
  if (routeNames[0] !== HOME_ROUTE) steps.push({ type: "REPLACE", payload: { name: HOME_ROUTE } });
  steps.push(push);
  return steps;
}

/**
 * Lets one tap through per `windowMs`, so a quick double tap navigates once.
 * `allow()` is true for the call that may proceed.
 */
export function createTapGuard(windowMs = 600, now: () => number = Date.now) {
  let last = Number.NEGATIVE_INFINITY;
  return {
    allow(): boolean {
      const t = now();
      if (t - last < windowMs) return false;
      last = t;
      return true;
    },
  };
}
