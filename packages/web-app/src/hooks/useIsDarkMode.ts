/**
 * useIsDarkMode — tracks the *resolved* theme, i.e. the `.dark` class that
 * `applyTheme` toggles on <html>.
 *
 * Reading the class (rather than the `theme` setting) means "system" is
 * already resolved for us, and any component that can't reach the settings
 * state — a lazy chunk, a component in app-core — still stays in sync.
 *
 * Seeded to `false` and synced in an effect rather than read during render:
 * the server has no <html> class to read, so touching the DOM in the initial
 * render would be a hydration mismatch.
 */

import { useEffect, useState } from "react";

export function useIsDarkMode(): boolean {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const el = document.documentElement;
    const update = (): void => {
      setDark(el.classList.contains("dark"));
    };
    update();
    const obs = new MutationObserver(update);
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => {
      obs.disconnect();
    };
  }, []);

  return dark;
}
