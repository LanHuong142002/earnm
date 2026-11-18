import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import type { T } from "./labels";

/** The translate function in the plain shape the label helpers take (i18next's own `t` has stricter overloads). */
export function useReminderT(): T {
  const { t } = useTranslation();
  return useCallback<T>((key, options) => String(options ? t(key, options) : t(key)), [t]);
}
