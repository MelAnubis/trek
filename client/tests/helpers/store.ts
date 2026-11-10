import { useAuthStore } from '../../src/store/authStore';
import { useTripStore } from '../../src/store/tripStore';
import { useSettingsStore } from '../../src/store/settingsStore';
import { useVacayStore } from '../../src/store/vacayStore';
import { useAddonStore } from '../../src/store/addonStore';
import { useInAppNotificationStore } from '../../src/store/inAppNotificationStore';
import { usePermissionsStore } from '../../src/store/permissionsStore';
// Journey store is reset individually in journey tests to avoid circular import issues

// Capture initial states at import time (before any test modifies them)
const initialAuthState = useAuthStore.getState();
const initialTripState = useTripStore.getState();
const initialSettingsState = useSettingsStore.getState();
const initialVacayState = useVacayStore.getState();
const initialAddonState = useAddonStore.getState();
const initialNotifState = useInAppNotificationStore.getState();
const initialPermsState = usePermissionsStore.getState();
export function resetAllStores(): void {
  useAuthStore.setState(initialAuthState, true);
  useTripStore.setState(initialTripState, true);
  useSettingsStore.setState(initialSettingsState, true);
  useVacayStore.setState(initialVacayState, true);
  useAddonStore.setState(initialAddonState, true);
  useInAppNotificationStore.setState(initialNotifState, true);
  usePermissionsStore.setState(initialPermsState, true);
}

/** Partial all the way down: a test seeds only the fields it cares about (settings: { dark_mode: true }). */
type DeepPartial<T> = T extends (...args: never[]) => unknown ? T
  : T extends readonly (infer U)[] ? readonly DeepPartial<U>[]
  : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> }
  : T;

export function seedStore<T extends object>(
  store: { setState: (partial: Partial<T>, replace?: boolean) => void },
  state: DeepPartial<T>,
): void {
  // Zustand merges the top level; nested objects are taken as given, as before.
  store.setState(state as Partial<T>);
}
