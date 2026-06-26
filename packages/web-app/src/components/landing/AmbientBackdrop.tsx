/**
 * A subtle WebGL depth layer behind the graph scene: a slowly drifting field of
 * teal points with additive glow. Deliberately tiny — it adds atmosphere, not
 * spectacle, and never competes with the (crisp SVG/DOM) graph in front of it.
 *
 * Client-only (R3F can't SSR — mount it inside <ClientOnly>). DPR is capped and
 * the frameloop is gated by `paused` so it costs nothing once scrolled past.
 */
import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

const COUNT = 900;

function PointField({ dark }: { dark: boolean }): JSX.Element {
  const ref = useRef<THREE.Points>(null);

  const geometry = useMemo(() => {
    const positions = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 26; // x
      positions[i * 3 + 1] = (Math.random() - 0.5) * 16; // y
      positions[i * 3 + 2] = (Math.random() - 0.5) * 10; // z
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return geo;
  }, []);

  useFrame((state) => {
    const pts = ref.current;
    if (!pts) return;
    const t = state.clock.elapsedTime;
    pts.rotation.y = t * 0.04;
    pts.rotation.x = Math.sin(t * 0.12) * 0.08;
  });

  return (
    <points ref={ref} geometry={geometry}>
      <pointsMaterial
        size={dark ? 0.06 : 0.05}
        color={dark ? "#2dd4bf" : "#0d9488"}
        transparent
        opacity={dark ? 0.7 : 0.45}
        sizeAttenuation
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

export function AmbientBackdrop({ paused = false, dark = false }: { paused?: boolean; dark?: boolean }): JSX.Element {
  return (
    <Canvas
      dpr={[1, 1.5]}
      frameloop={paused ? "demand" : "always"}
      camera={{ position: [0, 0, 14], fov: 60 }}
      gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
    >
      <PointField dark={dark} />
    </Canvas>
  );
}
