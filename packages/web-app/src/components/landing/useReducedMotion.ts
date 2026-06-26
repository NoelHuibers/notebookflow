import { useEffect, useState } from "react";

/**
 * Tracks `prefers-reduced-motion`. Lazily seeded from matchMedia so the very
 * first client render already knows the answer (this hook only runs inside the
 * client island, so `window` is always present). When true, the landing scene
 * skips its GSAP timeline + WebGL backdrop and shows the static composed graph.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return reduced;
}
