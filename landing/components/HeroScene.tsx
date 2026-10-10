"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

const INK = new THREE.Color("#0b0b0c");
const GOLD = new THREE.Color("#a8823f");

function useDotTexture() {
  return useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!;
    g.beginPath();
    g.arc(32, 32, 28, 0, Math.PI * 2);
    g.fillStyle = "#fff";
    g.fill();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
}

function hexPrismEdges(radius: number, height: number) {
  return new THREE.EdgesGeometry(new THREE.CylinderGeometry(radius, radius, height, 6, 1, true));
}

function hexLoop(radius: number, y: number) {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    pts.push(new THREE.Vector3(Math.cos(a) * radius, y, Math.sin(a) * radius));
  }
  return new THREE.BufferGeometry().setFromPoints(pts);
}

/* Particle data lives outside React: it is created once and then advanced every frame. */
function makeSwarm(count: number) {
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count * 4); // angle, radius, y, speed
  for (let i = 0; i < count; i++) {
    seed[i * 4] = Math.random() * Math.PI * 2;
    seed[i * 4 + 1] = 0.25 + Math.pow(Math.random(), 0.7) * 0.85;
    seed[i * 4 + 2] = (Math.random() - 0.5) * 2.0;
    seed[i * 4 + 3] = 0.15 + Math.random() * 0.5;
  }
  return { count, pos, seed };
}

function makeInflow(count: number) {
  const pos = new Float32Array(count * 3);
  const dir = new Float32Array(count * 3);
  const t = new Float32Array(count);
  const v = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    dir[i * 3] = s * Math.cos(th);
    dir[i * 3 + 1] = u * 0.55;
    dir[i * 3 + 2] = s * Math.sin(th);
    t[i] = Math.random();
    v[i] = 0.08 + Math.random() * 0.12;
  }
  return { count, pos, dir, t, v };
}

const SWARM = makeSwarm(1100);
const INFLOW = makeInflow(240);

function stepSwarm(dt: number, speed: number) {
  const { count, pos, seed } = SWARM;
  for (let i = 0; i < count; i++) {
    seed[i * 4] += seed[i * 4 + 3] * dt * speed;
    const a = seed[i * 4], r = seed[i * 4 + 1];
    pos[i * 3] = Math.cos(a) * r;
    pos[i * 3 + 1] = seed[i * 4 + 2] + Math.sin(a * 2 + r * 6) * 0.06;
    pos[i * 3 + 2] = Math.sin(a) * r;
  }
}

function stepInflow(dt: number, speed: number) {
  const { count, pos, dir, t, v } = INFLOW;
  for (let i = 0; i < count; i++) {
    t[i] += v[i] * dt * speed;
    if (t[i] > 1) t[i] -= 1;
    const r = 5.2 - t[i] * 4.0; // 5.2 → 1.2: ends at the core's wall
    pos[i * 3] = dir[i * 3] * r;
    pos[i * 3 + 1] = dir[i * 3 + 1] * r;
    pos[i * 3 + 2] = dir[i * 3 + 2] * r;
  }
}

/** Knowledge inside the core: a swarm orbiting the axis, held within the hexagon. */
function Swarm({ speed }: { speed: number }) {
  const tex = useDotTexture();
  const ref = useRef<THREE.Points>(null);
  useFrame((_, dt) => {
    stepSwarm(dt, speed);
    if (ref.current) ref.current.geometry.attributes.position.needsUpdate = true;
  });
  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[SWARM.pos, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.028} color={INK} map={tex} alphaTest={0.4} transparent opacity={0.75} sizeAttenuation depthWrite={false} />
    </points>
  );
}

/** Documents, scans and questions flowing in from the plant. Nothing flows out. */
function Inflow({ speed }: { speed: number }) {
  const tex = useDotTexture();
  const ref = useRef<THREE.Points>(null);
  useFrame((_, dt) => {
    stepInflow(dt, speed);
    if (ref.current) ref.current.geometry.attributes.position.needsUpdate = true;
  });
  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[INFLOW.pos, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.045} color={GOLD} map={tex} alphaTest={0.4} transparent opacity={0.9} sizeAttenuation depthWrite={false} />
    </points>
  );
}

function DocCard({ i, n }: { i: number; n: number }) {
  const ref = useRef<THREE.Group>(null);
  const base = (i / n) * Math.PI * 2;
  const r = 2.35 + (i % 3) * 0.28;
  const y = ((i * 37) % 9) / 9 * 1.8 - 0.9;
  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.PlaneGeometry(0.34, 0.46)), []);
  const lines = useMemo(() => {
    const pts: number[] = [];
    for (let k = 0; k < 4; k++) {
      const yy = 0.14 - k * 0.075;
      pts.push(-0.11, yy, 0.001, k === 3 ? 0.02 : 0.11, yy, 0.001);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, []);
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    const a = base + clock.elapsedTime * 0.06;
    g.position.set(Math.cos(a) * r, y + Math.sin(clock.elapsedTime * 0.5 + i) * 0.06, Math.sin(a) * r);
    g.lookAt(0, g.position.y, 0);
  });
  return (
    <group ref={ref}>
      <mesh>
        <planeGeometry args={[0.34, 0.46]} />
        <meshBasicMaterial color="#ffffff" side={THREE.DoubleSide} transparent opacity={0.92} />
      </mesh>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color={INK} transparent opacity={0.55} />
      </lineSegments>
      <lineSegments geometry={lines}>
        <lineBasicMaterial color={INK} transparent opacity={0.3} />
      </lineSegments>
    </group>
  );
}

function Loop({ geometry, color, opacity }: { geometry: THREE.BufferGeometry; color: THREE.Color; opacity: number }) {
  const line = useMemo(() => new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity })), [geometry, color, opacity]);
  return <primitive object={line} />;
}

function Core({ speed }: { speed: number }) {
  const root = useRef<THREE.Group>(null);
  const inner = useRef<THREE.Group>(null);
  const rings = useRef<THREE.Group>(null);
  const outer = useMemo(() => hexPrismEdges(1.25, 2.3), []);
  const innerG = useMemo(() => hexPrismEdges(0.62, 1.3), []);
  const loops = useMemo(() => [-1.15, -0.4, 0.4, 1.15].map((y) => hexLoop(1.25, y)), []);
  const halo = useMemo(() => [hexLoop(2.05, 0), hexLoop(3.3, -1.6), hexLoop(3.3, 1.6)], []);
  const perimeter = useMemo(() => {
    const g = hexPrismEdges(3.3, 3.2);
    return g;
  }, []);
  useFrame(({ pointer }, dt) => {
    if (root.current) {
      root.current.rotation.y += dt * 0.12 * speed;
      root.current.rotation.x = THREE.MathUtils.lerp(root.current.rotation.x, 0.32 + pointer.y * 0.12, 0.05);
      root.current.rotation.z = THREE.MathUtils.lerp(root.current.rotation.z, -pointer.x * 0.08, 0.05);
    }
    if (inner.current) inner.current.rotation.y -= dt * 0.5 * speed;
    if (rings.current) rings.current.rotation.y -= dt * 0.08 * speed;
  });
  return (
    <group ref={root}>
      <lineSegments geometry={outer}>
        <lineBasicMaterial color={INK} transparent opacity={0.85} />
      </lineSegments>
      {loops.map((g, i) => <Loop key={i} geometry={g} color={INK} opacity={0.18} />)}
      <group ref={inner}>
        <lineSegments geometry={innerG}>
          <lineBasicMaterial color={GOLD} transparent opacity={1} />
        </lineSegments>
      </group>
      <group ref={rings}>
        {halo.map((g, i) => <Loop key={i} geometry={g} color={INK} opacity={i === 0 ? 0.22 : 0.1} />)}
        <lineSegments geometry={perimeter}>
          <lineBasicMaterial color={INK} transparent opacity={0.07} />
        </lineSegments>
      </group>
      <Swarm speed={speed} />
      <Inflow speed={speed} />
      {Array.from({ length: 11 }, (_, i) => <DocCard key={i} i={i} n={11} />)}
    </group>
  );
}

export default function HeroScene() {
  const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ position: [0, 0.4, 10.2], fov: 34 }}
      flat
      gl={{ antialias: true, alpha: true }}
      style={{ background: "transparent" }}
    >
      <Core speed={reduce ? 0.15 : 1} />
    </Canvas>
  );
}
