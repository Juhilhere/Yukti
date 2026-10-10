"use client";

import dynamic from "next/dynamic";
import { motion, useInView, useMotionValue, useSpring } from "motion/react";
import { Component, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { ArrowRight, Cpu, Gauge, Languages, ShieldOff } from "lucide-react";
import { DownloadButtons, GithubIcon, YuktiMark, cx } from "./ui";
import { REPO, VERSION } from "@/lib/site";

const HeroScene = dynamic(() => import("./HeroScene"), { ssr: false, loading: () => <StaticCore /> });

/** Drawn instead of the 3D scene while it loads, or when the browser has no WebGL. */
function StaticCore() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <svg viewBox="0 0 200 200" className="h-[62%] w-[62%] opacity-90">
        <polygon points="100,18 171,59 171,141 100,182 29,141 29,59" fill="none" stroke="#0b0b0c" strokeOpacity="0.8" />
        <polygon points="100,58 136,79 136,121 100,142 64,121 64,79" fill="none" stroke="#a8823f" />
        {Array.from({ length: 36 }, (_, i) => {
          const a = (i / 36) * Math.PI * 2, r = 28 + (i % 4) * 9;
          return <circle key={i} cx={100 + Math.cos(a) * r} cy={100 + Math.sin(a) * r} r="1.2" fill="#0b0b0c" fillOpacity="0.6" />;
        })}
      </svg>
    </div>
  );
}

let webgl: boolean | undefined;
function hasWebGL() {
  if (webgl === undefined) {
    try {
      const c = document.createElement("canvas");
      webgl = !!(c.getContext("webgl2") || c.getContext("webgl"));
    } catch {
      webgl = false;
    }
  }
  return webgl;
}
const noSubscribe = () => () => {};

class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <StaticCore /> : this.props.children; }
}

function Scene() {
  // checked in the browser only; the server render and the first paint show the drawing
  const ok = useSyncExternalStore(noSubscribe, hasWebGL, () => false);
  if (!ok) return <StaticCore />;
  return <SceneBoundary><HeroScene /></SceneBoundary>;
}

const LINKS = [
  ["Flow", "#flow"],
  ["Trust", "#trust"],
  ["Features", "#features"],
  ["Architecture", "#architecture"],
  ["Performance", "#performance"],
  ["Start", "#start"],
] as const;

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <header className={cx("fixed inset-x-0 top-0 z-50 transition-colors", scrolled ? "border-b border-line bg-white/80 backdrop-blur-xl" : "border-b border-transparent")}>
      <div className="mx-auto flex h-16 max-w-[1200px] items-center gap-6 px-5 sm:px-10">
        <a href="#top" className="flex items-center gap-2.5">
          <YuktiMark size={26} />
          <span className="font-serif text-[24px] leading-none tracking-tight">Yukti</span>
        </a>
        <nav className="ml-6 hidden items-center gap-1 lg:flex">
          {LINKS.map(([l, h]) => (
            <a key={h} href={h} className="rounded-full px-3 py-1.5 text-[13px] text-mute transition-colors hover:bg-paper-2 hover:text-ink">{l}</a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <a href={REPO} target="_blank" rel="noreferrer" aria-label="GitHub" className="flex h-9 w-9 items-center justify-center rounded-full text-ink-2 hover:bg-paper-2">
            <GithubIcon size={17} />
          </a>
          <a href="#download" className="hidden h-9 items-center gap-2 rounded-full bg-ink px-4 text-[13px] font-medium text-white sm:inline-flex">
            Download <ArrowRight size={14} />
          </a>
        </div>
      </div>
    </header>
  );
}

/** Callouts around the 3D core, like annotations on a drawing. */
function Callout({ className, label, value, side = "left", delay }: { className: string; label: string; value: string; side?: "left" | "right"; delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.8 }}
      className={cx("pointer-events-none absolute hidden items-center gap-2 md:flex", side === "right" && "flex-row-reverse", className)}
    >
      <div className={cx("rounded-lg border border-line bg-white/85 px-2.5 py-1.5 backdrop-blur", side === "right" && "text-right")}>
        <div className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-mute">{label}</div>
        <div className="text-[13px] font-medium">{value}</div>
      </div>
      <span className="h-px w-14 bg-ink/30" />
      <span className="relative flex h-2 w-2">
        <span className="pulse-ring absolute inset-0 rounded-full bg-gold/60" />
        <span className="relative h-2 w-2 rounded-full bg-gold" />
      </span>
    </motion.div>
  );
}

export function Hero() {
  return (
    <section id="top" className="relative overflow-hidden pt-16">
      <div className="bp-grid fade-mask pointer-events-none absolute inset-0" />
      <div className="relative mx-auto grid max-w-[1200px] grid-cols-1 border-x border-line lg:min-h-[calc(100vh-4rem)] lg:grid-cols-[1fr_1.1fr]">
        <div className="relative z-10 flex flex-col justify-center px-5 pb-6 pt-14 sm:px-10 lg:pb-20 lg:pt-10">
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line-2 bg-white px-2.5 py-1 font-mono text-[11px]">
              <span className="h-1.5 w-1.5 rounded-full bg-ok" /> v{VERSION}
            </span>
            <span className="rounded-full border border-line-2 bg-white px-2.5 py-1 font-mono text-[11px] text-ink-2">air-gapped</span>
            <span className="rounded-full border border-line-2 bg-white px-2.5 py-1 font-mono text-[11px] text-ink-2">SIH 2026 · SIH26117</span>
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.1, ease: [0.2, 0.7, 0.2, 1] }}
            className="mt-7 text-[52px] font-semibold leading-[0.95] tracking-[-0.045em] sm:text-[76px]"
          >
            Plant knowledge,
            <br />
            <span className="font-serif text-[60px] font-normal italic tracking-[-0.01em] sm:text-[88px]">kept inside.</span>
          </motion.h1>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35, duration: 0.8 }} className="mt-7 flex max-w-md items-center gap-3 text-[15px] text-mute">
            <span className="flex -space-x-1.5">
              {[0, 1, 2, 3].map((i) => <span key={i} className="h-5 w-4 rounded-[3px] border border-line-2 bg-white" style={{ transform: `rotate(${(i - 1.5) * 9}deg)` }} />)}
            </span>
            <ArrowRight size={16} className="shrink-0 text-ink" />
            <span className="relative flex h-6 w-6 items-center justify-center"><YuktiMark size={22} /></span>
            <ArrowRight size={16} className="shrink-0 text-ink" />
            <span className="rounded-md border border-ok/30 bg-ok-soft px-2 py-0.5 font-mono text-[11px] text-ok">cited · authorized</span>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5, duration: 0.7 }} className="mt-10 flex flex-wrap items-center gap-4">
            <DownloadButtons size="lg" />
          </motion.div>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.7 }} className="mt-5 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[11px] text-mute">
            <span>Windows 10 / 11</span><span>macOS 13.3+ · Apple silicon</span><span>works offline</span>
            <a href={REPO} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline-offset-4 hover:text-ink hover:underline"><GithubIcon size={11} /> source</a>
          </motion.div>
        </div>

        <div className="relative h-[460px] sm:h-[560px] lg:h-auto">
          <div className="absolute inset-0 [mask-image:radial-gradient(ellipse_62%_58%_at_50%_50%,#000_62%,transparent_100%)]">
            <Scene />
          </div>
          <Callout className="left-[4%] top-[18%]" label="router" value="Laya · ~1 ms" delay={0.9} side="left" />
          <Callout className="right-[3%] top-[30%]" label="access" value="Policy, not prompts" delay={1.1} side="right" />
          <Callout className="left-[6%] bottom-[22%]" label="egress" value="0 bytes out" delay={1.3} side="left" />
          <Callout className="right-[6%] bottom-[14%]" label="evidence" value="known · missing · conflicting" delay={1.5} side="right" />
        </div>
      </div>
      <Stats />
    </section>
  );
}

function CountUp({ to, decimals = 0, prefix = "", suffix = "" }: { to: number; decimals?: number; prefix?: string; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const mv = useMotionValue(0);
  const spring = useSpring(mv, { duration: 1600, bounce: 0 });
  const [v, setV] = useState(0);
  useEffect(() => { if (inView) mv.set(to); }, [inView, mv, to]);
  useEffect(() => spring.on("change", (x) => setV(x)), [spring]);
  return <span ref={ref} className="tabular-nums">{prefix}{v.toFixed(decimals)}{suffix}</span>;
}

function Stats() {
  const cells = [
    { icon: <Gauge size={16} />, big: <><span className="text-mute">~</span><CountUp to={1} /><span className="ml-1 text-[16px] text-mute sm:text-[24px]">ms</span></>, cap: "Laya routes before any LLM call" },
    { icon: <Cpu size={16} />, big: <><CountUp to={44} />–<CountUp to={58} /><span className="ml-1 text-[16px] text-mute sm:text-[24px]">tok/s</span></>, cap: "Gemma 3 4B · 6 GB laptop GPU" },
    {
      icon: <Languages size={16} />,
      big: (
        <span className="flex items-baseline gap-3">
          <span>En</span><span className="font-deva text-[30px] sm:text-[40px]">हिं</span><span className="font-knda text-[28px] sm:text-[38px]">ಕ</span>
        </span>
      ),
      cap: "English · Hindi · Kannada, offline speech",
    },
    { icon: <ShieldOff size={16} />, big: <><CountUp to={0} /><span className="ml-1 text-[16px] text-mute sm:text-[24px]">bytes out</span></>, cap: "Offline guard blocks and counts egress" },
  ];
  return (
    <div className="relative border-t border-line bg-white">
      <div className="relative mx-auto grid max-w-[1200px] grid-cols-2 border-x border-line lg:grid-cols-4">
        <span className="cross -left-[6px] -top-[6px]" />
        <span className="cross -right-[6px] -top-[6px]" />
        {cells.map((c, i) => (
          <div key={i} className={cx("px-5 py-8 sm:px-8", i % 2 === 1 && "border-l border-line", i >= 2 && "border-t border-line lg:border-t-0", i === 2 && "lg:border-l")}>
            <div className="flex items-center gap-2 text-mute">{c.icon}<span className="font-mono text-[10.5px] uppercase tracking-[0.16em]">0{i + 1}</span></div>
            <div className="mt-4 flex items-baseline text-[32px] font-semibold leading-none tracking-[-0.04em] sm:text-[44px]">{c.big}</div>
            <div className="mt-3 text-[12.5px] text-mute">{c.cap}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
