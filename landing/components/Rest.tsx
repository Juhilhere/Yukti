"use client";

import { motion } from "motion/react";
import {
  ArrowRight, Box, Camera, CheckCircle2, ClipboardCheck, Cpu, Download, Factory, FlaskConical, Gauge, HardHat, KeyRound,
  Landmark, LineChart, Link2, Lock, Map, Mic, MousePointerClick, Package, PlugZap, Search, Settings, ShieldCheck, ShieldOff,
  SlidersHorizontal, Sparkles, UserRoundCog, Users, Zap,
} from "lucide-react";
import { useState } from "react";
import { Chip, DownloadButtons, GithubIcon, Reveal, Section, YuktiMark, cx } from "./ui";
import { DOCS_URL, RELEASES_URL, REPO, VERSION } from "@/lib/site";

/* ---------------------------------------------------------------- performance */
const BARS = [
  { l: "llama.cpp CUDA 12.4", v: 51.7, tag: "3.9× CPU", dark: true },
  { l: "llama.cpp Vulkan", v: 50.8 },
  { l: "CPU only", v: 13.4 },
];

export function Performance() {
  return (
    <Section id="performance" index="07" label="Measured" icon={<Gauge size={12} />} title={<>No cluster. No cloud. <span className="italic text-mute">A 6 GB laptop GPU.</span></>}>
      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <Reveal className="rounded-2xl border border-line bg-white p-6 sm:p-8">
          <div className="mb-8 flex flex-wrap items-center gap-2">
            <Chip tone="ink">tok/s</Chip><Chip>Gemma 2 2B Q8_0</Chip><Chip>RTX 4050 · 6 GB</Chip>
          </div>
          <div className="space-y-6">
            {BARS.map((b, i) => (
              <div key={b.l}>
                <div className="mb-2 flex items-baseline justify-between">
                  <span className="font-mono text-[11.5px] text-ink-2">{b.l}</span>
                  <span className="flex items-baseline gap-2">
                    {b.tag && <Chip tone="gold">{b.tag}</Chip>}
                    <span className="text-[26px] font-semibold tabular-nums tracking-tight">{b.v}</span>
                  </span>
                </div>
                <div className="relative h-3 overflow-hidden rounded-full bg-paper-3">
                  <motion.div className={cx("absolute inset-y-0 left-0 rounded-full", b.dark ? "bg-ink" : i === 1 ? "bg-ink/55" : "bg-ink/20")}
                    initial={{ width: 0 }} whileInView={{ width: `${(b.v / 55) * 100}%` }} viewport={{ once: true }} transition={{ duration: 1.3, delay: i * 0.15, ease: [0.2, 0.7, 0.2, 1] }} />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-8 grid grid-cols-[repeat(20,1fr)] gap-[3px]">
            {Array.from({ length: 60 }, (_, i) => (
              <motion.span key={i} className="h-1.5 rounded-sm bg-ink" initial={{ opacity: 0.08 }} whileInView={{ opacity: [0.08, 0.9, 0.25] }}
                viewport={{ once: true }} transition={{ delay: 0.6 + i * 0.02, duration: 0.6 }} />
            ))}
          </div>
          <div className="mt-2 font-mono text-[10px] text-faint">Gemma 3 4B · 44–58 tok/s</div>
        </Reveal>
        <div className="grid grid-cols-2 gap-4">
          {[
            { i: Zap, v: "0.2 s", l: "first token" },
            { i: Sparkles, v: "~1 ms", l: "Laya routing" },
            { i: Camera, v: "4–10 s", l: "photo question" },
            { i: Mic, v: "0.3 s", l: "speech → text" },
            { i: Cpu, v: "5.1 / 6 GB", l: "Gemma + Whisper VRAM", wide: true },
          ].map(({ i: I, v, l, wide }, k) => (
            <Reveal key={l} delay={k * 0.07} className={cx("flex flex-col justify-between rounded-2xl border border-line bg-white p-5", wide && "col-span-2")}>
              <I size={17} className="text-mute" />
              <div className="mt-6">
                <div className="text-[28px] font-semibold leading-none tracking-[-0.03em]">{v}</div>
                <div className="mt-2 font-mono text-[10.5px] text-mute">{l}</div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </Section>
  );
}

/* ---------------------------------------------------------------- roles */
const ROLES = [
  { i: HardHat, n: "Employee", c: "cited chat · workbench · request access" },
  { i: UserRoundCog, n: "Head of Dept.", c: "own docs · approve access · findings" },
  { i: ClipboardCheck, n: "Approver lanes", c: "decide their lane" },
  { i: Factory, n: "Plant manager", c: "approvals · escalations · audit" },
  { i: Landmark, n: "Top management", c: "only role with company-level info" },
  { i: LineChart, n: "Planner", c: "plant model · forecast · scenarios" },
  { i: Package, n: "Stores", c: "register items in the ledger" },
  { i: Search, n: "Auditor", c: "audit log · chain verification" },
  { i: FlaskConical, n: "Researcher", c: "isolated research layer only" },
  { i: Settings, n: "Administrator", c: "LLM config · users — no plant documents" },
];

export function Roles() {
  const [hover, setHover] = useState<number | null>(null);
  const active = hover ?? 0;
  return (
    <Section id="roles" index="08" label="Roles" icon={<Users size={12} />} title={<>Ten roles. <span className="italic text-mute">Need-to-know, by design.</span></>}>
      <div className="grid items-center gap-10 lg:grid-cols-[1fr_320px]">
        <Reveal className="relative mx-auto hidden aspect-square w-full max-w-[540px] sm:block">
          <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full">
            <circle cx="50" cy="50" r="40" fill="none" stroke="#0b0b0c" strokeOpacity="0.1" strokeDasharray="0.6 1.4" />
            <circle cx="50" cy="50" r="24" fill="none" stroke="#0b0b0c" strokeOpacity="0.06" />
            {ROLES.map((_, i) => {
              const a = (i / ROLES.length) * Math.PI * 2 - Math.PI / 2;
              return <line key={i} x1="50" y1="50" x2={50 + Math.cos(a) * 40} y2={50 + Math.sin(a) * 40}
                stroke={i === active ? "#a8823f" : "#0b0b0c"} strokeOpacity={i === active ? 0.9 : 0.08} strokeWidth={i === active ? 0.35 : 0.25}
                className={i === active ? "dash-flow" : ""} />;
            })}
          </svg>
          <div className="absolute left-1/2 top-1/2 flex h-28 w-28 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border border-line bg-white shadow-sm">
            <ShieldCheck size={26} strokeWidth={1.5} />
            <span className="mt-1 font-mono text-[9.5px] text-mute">policy</span>
          </div>
          {ROLES.map((r, i) => {
            const a = (i / ROLES.length) * Math.PI * 2 - Math.PI / 2;
            const I = r.i;
            return (
              <button key={r.n} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} aria-label={`${r.n}: ${r.c}`}
                className={cx("absolute flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-2xl border transition-all",
                  i === active ? "scale-110 border-ink bg-ink text-white shadow-lg" : "border-line bg-white text-ink hover:border-ink")}
                style={{ left: `${50 + Math.cos(a) * 40}%`, top: `${50 + Math.sin(a) * 40}%` }}>
                <I size={20} strokeWidth={1.6} />
              </button>
            );
          })}
        </Reveal>
        <div>
          <div className="hidden rounded-2xl border border-line bg-white p-6 sm:block">
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-mute">role {String(active + 1).padStart(2, "0")} / 10</div>
            <motion.div key={active} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
              <div className="mt-3 text-[22px] font-semibold tracking-tight">{ROLES[active].n}</div>
              <div className="mt-2 font-mono text-[12px] leading-relaxed text-ink-2">{ROLES[active].c}</div>
            </motion.div>
          </div>
          <ul className="grid grid-cols-2 gap-2 sm:hidden">
            {ROLES.map(({ i: I, n }) => <li key={n} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2.5 text-[12.5px]"><I size={15} />{n}</li>)}
          </ul>
        </div>
      </div>
    </Section>
  );
}

/* ---------------------------------------------------------------- security */
const SEC = [
  { i: Lock, t: "LLM never decides access", s: "deny-overrides · default deny · fail closed" },
  { i: ShieldOff, t: "Offline guard", s: "blocks & counts outbound connections" },
  { i: Link2, t: "Tamper-evident audit", s: "logins · denials · tools · answers · approvals" },
  { i: SlidersHorizontal, t: "Advisory only", s: "no writes to DCS / SCADA" },
  { i: Box, t: "Sandbox & isolation", s: "code without network · research walled off" },
];
export function Security() {
  return (
    <Section index="09" label="Security" icon={<Lock size={12} />} title={<>Five walls <span className="italic text-mute">around every answer.</span></>} grid>
      <div className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-5">
        {SEC.map(({ i: I, t, s }, k) => (
          <Reveal key={t} delay={k * 0.07} className="flex flex-col bg-white p-6">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-line"><I size={19} strokeWidth={1.6} /></div>
            <div className="mt-10 text-[14px] font-medium leading-snug">{t}</div>
            <div className="mt-1.5 font-mono text-[10.5px] leading-relaxed text-mute">{s}</div>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

/* ---------------------------------------------------------------- get started */
const STEPS = [
  { i: Download, t: "One file", s: "Yukti-Setup.exe · Yukti-macOS-arm64.dmg" },
  { i: MousePointerClick, t: "Open it", s: "Windows: double-click · Mac: drag to Applications" },
  { i: Package, t: "Downloads its AI once", s: "3.9 GB · 5.3 GB NVIDIA · photos + voice included · verified" },
  { i: KeyRound, t: "Sign in", s: "works offline" },
];
export function Start() {
  return (
    <Section id="start" index="10" label="Get started" icon={<PlugZap size={12} />} title={<>One download. <span className="italic text-mute">Windows or Mac.</span></>}>
      <div className="relative grid gap-4 md:grid-cols-4">
        <div className="absolute left-[12%] right-[12%] top-[46px] hidden border-t border-dashed border-line-2 md:block" />
        {STEPS.map(({ i: I, t, s }, k) => (
          <Reveal key={t} delay={k * 0.1} className="relative flex flex-col items-start md:items-center md:text-center">
            <div className={cx("relative z-10 flex h-[92px] w-[92px] items-center justify-center rounded-3xl border bg-white", k === 3 ? "border-ok/40 text-ok" : "border-line")}>
              <I size={30} strokeWidth={1.5} />
              <span className="absolute -bottom-2 rounded-full border border-line bg-white px-2 font-mono text-[10px] text-mute">0{k + 1}</span>
            </div>
            <div className="mt-5 text-[15px] font-medium">{t}</div>
            <div className="mt-1 font-mono text-[10.5px] text-mute">{s}</div>
          </Reveal>
        ))}
      </div>
      <Reveal delay={0.2} className="mt-12 grid gap-3 sm:grid-cols-3">
        <div className="flex items-center gap-3 rounded-2xl border border-line p-4"><Camera size={17} /><span className="text-[13px]">Photos</span><Chip className="ml-auto">~800 MB · included</Chip></div>
        <div className="flex items-center gap-3 rounded-2xl border border-line p-4"><Mic size={17} /><span className="text-[13px]">Voice</span><Chip className="ml-auto">0.3–1 GB · included</Chip></div>
        <div className="flex items-center gap-3 rounded-2xl border border-line p-4"><CheckCircle2 size={17} className="text-ok" /><span className="text-[13px]">After that</span><Chip tone="ok" className="ml-auto">0 bytes online</Chip></div>
      </Reveal>
    </Section>
  );
}

/* ---------------------------------------------------------------- roadmap */
const PHASES = [
  { t: "Pilot", s: "one unit · dossiers · SOPs · drawings · cited RAG" },
  { t: "Workflows", s: "scan → finding · approvals · ledger · alerts" },
  { t: "Planning", s: "production intelligence with planners" },
  { t: "Scale", s: "plant-wide · template for refineries & PSUs" },
];
export function Roadmap() {
  return (
    <Section index="11" label="Roadmap" icon={<Map size={12} />} title={<>Pilot first. <span className="italic text-mute">Then the plant.</span></>}>
      <div className="relative">
        <div className="absolute left-0 right-0 top-[11px] h-px bg-line-2" />
        <motion.div className="absolute left-0 top-[11px] h-px bg-ink" initial={{ width: 0 }} whileInView={{ width: "25%" }} viewport={{ once: true }} transition={{ duration: 1.2 }} />
        <div className="grid gap-8 md:grid-cols-4">
          {PHASES.map((p, i) => (
            <Reveal key={p.t} delay={i * 0.1}>
              <span className={cx("relative z-10 block h-[23px] w-[23px] rounded-full border-2", i === 0 ? "border-ink bg-ink" : "border-line-2 bg-white")}>
                {i === 0 && <span className="pulse-ring absolute inset-0 rounded-full bg-ink/30" />}
              </span>
              <div className="mt-5 font-mono text-[10.5px] text-mute">phase {i + 1}</div>
              <div className="mt-1 text-[20px] font-semibold tracking-tight">{p.t}</div>
              <div className="mt-2 font-mono text-[11px] leading-relaxed text-mute">{p.s}</div>
            </Reveal>
          ))}
        </div>
      </div>
      <Reveal delay={0.2} className="mt-14 flex flex-wrap items-center gap-2">
        <span className="mr-2 font-mono text-[10.5px] uppercase tracking-[0.16em] text-faint">next</span>
        {["code-signed installers", "plant PKI certificates", "refinery guard model", "DMS · CMMS · SAP connectors", "Linux server", "evaluation on real documents"].map((x) => (
          <span key={x} className="rounded-full border border-dashed border-line-2 px-3 py-1 font-mono text-[11px] text-mute">{x}</span>
        ))}
      </Reveal>
    </Section>
  );
}

/* ---------------------------------------------------------------- download + footer */
export function Footer() {
  return (
    <>
      <section id="download" className="relative overflow-hidden border-t border-line">
        <div className="bp-grid fade-mask pointer-events-none absolute inset-0" />
        <div className="relative mx-auto max-w-[1200px] border-x border-line px-5 py-24 text-center sm:px-10 md:py-32">
          <span className="cross -left-[6px] -top-[6px]" />
          <span className="cross -right-[6px] -top-[6px]" />
          <Reveal className="flex flex-col items-center">
            <motion.div animate={{ rotate: [0, 0, 360] }} transition={{ duration: 8, repeat: Infinity, times: [0, 0.8, 1], ease: "easeInOut" }}>
              <YuktiMark size={64} />
            </motion.div>
            <h2 className="mt-8 text-[44px] font-semibold leading-[0.95] tracking-[-0.045em] sm:text-[72px]">
              Bring Yukti <span className="font-serif font-normal italic tracking-[-0.01em]">inside.</span>
            </h2>
            <DownloadButtons size="lg" className="mt-10 justify-center" />
            <div className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 font-mono text-[11px] text-mute">
              <span>v{VERSION}</span><span>·</span><span>Windows 10 / 11</span><span>·</span><span>macOS 13.3+ · Apple silicon</span><span>·</span>
              <a href={RELEASES_URL} target="_blank" rel="noreferrer" className="underline-offset-4 hover:text-ink hover:underline">all releases</a><span>·</span>
              <a href={DOCS_URL} target="_blank" rel="noreferrer" className="underline-offset-4 hover:text-ink hover:underline">docs</a>
            </div>
            <div className="mt-4 max-w-[640px] rounded-2xl border border-line bg-white px-3 py-1.5 text-center font-mono text-[10.5px] leading-relaxed text-faint">
              Windows: SmartScreen → More info → Run anyway <span className="text-line-2">|</span> Mac: Privacy &amp; Security → Open Anyway <span className="text-line-2">|</span> not yet code-signed
            </div>
          </Reveal>
        </div>
      </section>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-6 border-x border-line px-5 py-10 sm:flex-row sm:items-center sm:px-10">
          <div className="flex items-center gap-2.5">
            <YuktiMark size={22} />
            <span className="font-serif text-[20px]">Yukti</span>
            <span className="ml-2 font-mono text-[10.5px] text-mute">Team UniMinds · SIH 2026</span>
          </div>
          <div className="font-mono text-[10.5px] leading-relaxed text-faint sm:ml-auto sm:max-w-sm sm:text-right">
            Not affiliated with MRPL. Plant documents shipped with Yukti are examples, watermarked in the UI.
          </div>
          <a href={REPO} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-[13px] text-ink-2 hover:text-ink"><GithubIcon size={16} />GitHub <ArrowRight size={13} /></a>
        </div>
      </footer>
    </>
  );
}
