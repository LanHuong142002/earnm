import { describe, expect, it } from "vitest";

import { productNoticeKeys } from "./outcomes";

describe("productNoticeKeys", () => {
  it("names a refused product change", () => {
    expect(productNoticeKeys({ entity: "product", kind: "update", name: "Trà", reason: "nameTaken" })).toEqual({
      headline: "products.rejected",
      reason: "products.reasons.nameTaken",
    });
  });

  it("has a headline without the name when the phone does not know it", () => {
    expect(productNoticeKeys({ entity: "product", kind: "delete", name: null, reason: "forbidden" }).headline).toBe("products.rejectedNoName");
  });

  it("uses the create headlines for a refused create, and says the project is gone on a 404", () => {
    expect(productNoticeKeys({ entity: "product", kind: "create", name: "Trà", reason: "limit" })).toEqual({
      headline: "products.rejectedCreate",
      reason: "products.reasons.limit",
    });
    expect(productNoticeKeys({ entity: "product", kind: "create", name: null, reason: "not_found" })).toEqual({
      headline: "products.rejectedCreateNoName",
      reason: "products.reasons.projectGone",
    });
  });

  it("has extra cost wording for the headline, what is gone and the limit", () => {
    expect(productNoticeKeys({ entity: "extraCost", kind: "update", name: "Đá", reason: "not_found" })).toEqual({
      headline: "products.rejectedExtra",
      reason: "products.reasons.notFoundExtra",
    });
    expect(productNoticeKeys({ entity: "extraCost", kind: "create", name: "Đá", reason: "limit" })).toEqual({
      headline: "products.rejectedExtraCreate",
      reason: "products.reasons.limitExtra",
    });
  });

  it("reads reasons that only other areas have as generic", () => {
    expect(productNoticeKeys({ entity: "product", kind: "update", name: "Trà", reason: "labelLimit" }).reason).toBe("products.reasons.generic");
  });
});
