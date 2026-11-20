/** Queue entity names of the products code. Every one is registered with the shared queue. */
export const PRODUCT_ENTITY = "product";
/** One size's selling price. `entityId` is `${productId}|${size}`, so edits of one size merge and sizes stay apart. */
export const PRODUCT_PRICE_ENTITY = "productPrice";
/** One size's recipe (lines and extras together, replaced as a whole). `entityId` is `${productId}|${size}`. */
export const PRODUCT_LINES_ENTITY = "productLines";
export const EXTRA_COST_ENTITY = "extraCost";
/** One fixed cost (rent, wages, equipment...). Edits of one cost merge field by field. */
export const FIXED_COST_ENTITY = "fixedCost";
