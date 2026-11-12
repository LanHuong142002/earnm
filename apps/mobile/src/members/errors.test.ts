import { describe, expect, it } from "vitest";

import { ApiError } from "../lib/api";
import { memberErrorKey } from "./errors";

describe("memberErrorKey", () => {
  it.each([
    ["network", "errors.network"],
    ["invalid_invite", "errors.invalid_invite"],
    ["already_member", "errors.already_member"],
    ["project_full", "errors.project_full"],
    ["too_many_invites", "errors.too_many_invites"],
    ["too_many_attempts", "errors.too_many_attempts"],
    ["forbidden", "errors.forbidden"],
    ["not_found", "errors.not_found_member"],
    ["validation_failed", "errors.generic"],
    ["internal_error", "errors.generic"],
    ["something_new", "errors.generic"],
  ])("maps %s to %s", (code, key) => {
    expect(memberErrorKey(new ApiError(code))).toBe(key);
  });

  it("maps last_owner to the Owner hint when there are other members", () => {
    expect(memberErrorKey(new ApiError("last_owner", 409), { memberCount: 3 })).toBe(
      "errors.last_owner",
    );
  });

  it("maps last_owner to the delete hint when the person is the only member", () => {
    expect(memberErrorKey(new ApiError("last_owner", 409), { memberCount: 1 })).toBe(
      "errors.last_owner_only_member",
    );
  });

  it("maps last_owner without a member count to the Owner hint", () => {
    expect(memberErrorKey(new ApiError("last_owner", 409))).toBe("errors.last_owner");
  });

  it("maps anything that is not an ApiError to the generic key", () => {
    expect(memberErrorKey(new Error("boom"))).toBe("errors.generic");
    expect(memberErrorKey("nope")).toBe("errors.generic");
    expect(memberErrorKey(undefined)).toBe("errors.generic");
  });
});
