import { createContext, useCallback, useContext, useMemo, useRef, type ComponentRef, type ReactNode, type RefObject } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";

import { useTheme } from "../theme/useTheme";
import { scrollTargetY } from "./scrollIntoView";

// In RN 0.88 `View` is a value, not a class: take the instance type from the component.
type ViewInstance = ComponentRef<typeof View>;
type ScrollViewInstance = ComponentRef<typeof ScrollView>;
type ScrollIntoView = (viewRef: RefObject<ViewInstance | null>) => void;

const ScrollIntoViewContext = createContext<ScrollIntoView>(() => {});

/** Scrolls the enclosing Screen so the given view is fully visible; a no-op outside a Screen. */
export function useScrollIntoView(): ScrollIntoView {
  return useContext(ScrollIntoViewContext);
}

// Safe area, screen padding, content at the top. `footer` (a form's main button) sits at the bottom.
export function Screen({
  children,
  footer,
  edges = ["top", "bottom"],
  keyboardOffset = 0,
}: {
  children: ReactNode;
  footer?: ReactNode;
  edges?: Edge[];
  /** Space above the screen the keyboard-avoiding view cannot see, e.g. a navigation header's height. */
  keyboardOffset?: number;
}) {
  const { colors, layout, spacing } = useTheme();
  const scrollRef = useRef<ScrollViewInstance>(null);
  const contentRef = useRef<ViewInstance>(null);
  const scrollY = useRef(0);
  const viewportHeight = useRef(0);

  const scrollIntoView = useCallback<ScrollIntoView>(
    (viewRef) => {
      const target = viewRef.current;
      const content = contentRef.current;
      if (!target || !content) return;
      target.measureLayout(
        content,
        (_x, y, _w, height) => {
          const to = scrollTargetY({
            targetY: y,
            targetHeight: height,
            viewportHeight: viewportHeight.current,
            currentY: scrollY.current,
            margin: spacing[3],
          });
          if (to !== null) scrollRef.current?.scrollTo({ y: to, animated: true });
        },
        () => {},
      );
    },
    [spacing],
  );
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.current = e.nativeEvent.contentOffset.y;
  }, []);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    viewportHeight.current = e.nativeEvent.layout.height;
  }, []);
  const contentStyle = useMemo(
    () => ({ padding: layout.screenPadding, paddingTop: spacing[3], gap: layout.sectionGap }),
    [layout, spacing],
  );

  return (
    <SafeAreaView edges={edges} style={[styles.flex, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        keyboardVerticalOffset={keyboardOffset}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          ref={scrollRef}
          style={styles.flex}
          keyboardShouldPersistTaps="handled"
          onScroll={onScroll}
          scrollEventThrottle={16}
          onLayout={onLayout}
        >
          <View ref={contentRef} collapsable={false} style={contentStyle}>
            <ScrollIntoViewContext.Provider value={scrollIntoView}>
              {children}
            </ScrollIntoViewContext.Provider>
          </View>
        </ScrollView>
        {footer ? (
          <View
            style={{
              paddingHorizontal: layout.screenPadding,
              paddingBottom: spacing[1],
              gap: spacing[0],
            }}
          >
            {footer}
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 } });
