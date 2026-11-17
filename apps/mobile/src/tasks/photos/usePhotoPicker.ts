import * as ImagePicker from "expo-image-picker";
import { Linking } from "react-native";
import { useCallback, useState } from "react";

import { pickerOptions, pickerProblem, type PickSource } from "./photoUi";
import type { PickedPhoto } from "./prepare";

/**
 * Opens the camera or the photo library (several photos at once, up to the free places). A refused permission
 * is kept in `denied` so the screen can say so and offer `openSettings` (spec R25); cancelling is not a problem.
 */
export function usePhotoPicker(freePlaces: number) {
  const [denied, setDenied] = useState<PickSource | null>(null);

  const pick = useCallback(
    async (source: PickSource): Promise<PickedPhoto[]> => {
      setDenied(null);
      try {
        if (source === "camera") {
          const permission = await ImagePicker.requestCameraPermissionsAsync();
          if (!permission.granted) {
            setDenied("camera");
            return [];
          }
        }
        const options = pickerOptions(source, freePlaces);
        const result =
          source === "camera" ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
        if (result.canceled) return [];
        return result.assets.map((a) => ({ uri: a.uri, width: a.width, height: a.height }));
      } catch {
        // The system refused to open it (library access turned off): the same message and way out.
        setDenied(source);
        return [];
      }
    },
    [freePlaces],
  );

  return {
    pick,
    /** The i18n key of the refusal message, or null. */
    problemKey: denied ? pickerProblem(denied) : null,
    dismiss: useCallback(() => setDenied(null), []),
    openSettings: useCallback(() => {
      void Linking.openSettings();
    }, []),
  };
}
