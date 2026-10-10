"use client";

import { motion } from "motion/react";
import {
  AlertTriangle, BookOpenCheck, Brain, Check, ClipboardList, Database, FileScan, FileText, Fingerprint, GitBranch,
  Inbox, Mail, Route, ScanLine, Wrench, Zap,
} from "lucide-react";
import { Chip, Reveal, Section, YuktiMark, cx } from "./ui";

const SOURCES = [
  { icon: Database, label: "Equipment master", tone: "line" },
  { icon: Wrench, label: "Maintenance history", tone: "line" },
  { icon: GitBranch, label: "Drawings · P&IDs", tone: "line" },
  { icon: FileText, label: "SOP rev 2 vs rev 3", tone: "warn" },
  { icon: FileScan, label: "Scanned reports", tone: "line" },
  { icon: Mail, label: "Emails · shift logs", tone: "line" },
] as const;

export function Problem() {
  // six tiles around the trip, on a hexagon
  const R = 41;
  return (
    <Section id="problem" index="01" label="02:15 AM" icon={<AlertTriangle size={12} />} title={<>One trip. <span className="italic text-mute">Six systems.</span></>}>
      <div className="grid items-center gap-10 lg:grid-cols-[1.1fr_auto_1fr]">
        <Reveal className="relative mx-auto aspect-square w-full max-w-[460px]">
          <div className="dots absolute inset-0 rounded-full opacity-60 [mask-image:radial-gradient(circle,#000_40%,transparent_70%)]" />
          <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full">
            {SOURCES.map((_, i) => {
              const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
              return (
                <line key={i} x1="50" y1="50" x2={50 + Math.cos(a) * R} y2={50 + Math.sin(a) * R}
                  stroke={i === 3 ? "#c27a12" : "#0b0b0c"} strokeOpacity={i === 3 ? 0.7 : 0.35} strokeWidth="0.3" className="dash-flow" />
              );
            })}
          </svg>
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <div className="relative flex h-24 w-24 flex-col items-center justify-center rounded-full border border-bad/30 bg-white text-bad shadow-[0_0_0_8px_rgba(210,69,59,0.06)]">
              <span className="pulse-ring absolute inset-0 rounded-full border border-bad/40" />
              <Zap size={22} />
              <span className="mt-1 font-mono text-[10px] font-semibold">PUMP A2</span>
              <span className="font-mono text-[10px] text-bad/70">02:15</span>
            </div>
          </div>
          {SOURCES.map((s, i) => {
            const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
            const Icon = s.icon;
            return (
              <div key={s.label} className="absolute -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${50 + Math.cos(a) * R}%`, top: `${50 + Math.sin(a) * R}%` }}>
                <motion.div initial={{ opacity: 0, scale: 0.8 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }}
                  transition={{ delay: 0.15 + i * 0.08, duration: 0.5 }} className={cx("flex w-[92px] sm:w-[108px] flex-col items-center gap-1.5 rounded-xl border bg-white px-2 py-2.5 text-center shadow-sm",
                  s.tone === "warn" ? "border-warn/40" : "border-line")}>
                  <Icon size={17} className={s.tone === "warn" ? "text-warn" : "text-ink"} />
                  <span className="text-[10.5px] leading-tight text-ink-2">{s.label}</span>
                </motion.div>
              </div>
            );
          })}
        </Reveal>

        <Reveal delay={0.2} className="flex flex-row items-center justify-center gap-3 lg:flex-col">
          <span className="h-px w-16 bg-ink/25 lg:h-16 lg:w-px" />
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-line bg-white shadow-sm"><YuktiMark size={34} /></div>
          <span className="h-px w-16 bg-ink/25 lg:h-16 lg:w-px" />
        </Reveal>

        <Reveal delay={0.3}>
          <div className="relative overflow-hidden rounded-2xl border border-line bg-white shadow-[0_30px_80px_-40px_rgba(11,11,12,0.35)]">
            <div className="flex items-center gap-2 border-b border-line px-4 py-3">
              <YuktiMark size={16} />
              <span className="text-[12.5px] font-medium">A2 dossier</span>
              <Chip tone="ok" className="ml-auto">allowed</Chip>
            </div>
            <ul className="divide-y divide-line">
              {SOURCES.map((s, i) => {
                const Icon = s.icon;
                return (
                  <motion.li key={s.label}
                    initial={{ opacity: 0, x: 10 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }}
                    transition={{ delay: 0.5 + i * 0.09 }}
                    className="flex items-center gap-3 px-4 py-2.5">
                    <Icon size={14} className="text-mute" />
                    <span className="text-[13px]">{s.label}</span>
                    <span className="ml-auto flex items-center gap-2">
                      <span className="font-mono text-[10.5px] text-faint">[S{i + 1}]</span>
                      {s.tone === "warn"
                        ? <Chip tone="warn">conflicting</Chip>
                        : <span className="flex h-5 w-5 items-center justify-center rounded-full bg-ok-soft text-ok"><Check size={12} strokeWidth={3} /></span>}
                    </span>
                  </motion.li>
                );
              })}
            </ul>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}

const STEPS = [
  { icon: ScanLine, title: "Question or scan", sub: "text · photo · voice" },
  { icon: Fingerprint, title: "Identity & policy", sub: "post · dept · clearance · scope" },
  { icon: Route, title: "Laya routes", sub: "typed decision · ~1 ms" },
  { icon: Inbox, title: "Durable queue", sub: "specialist worker" },
  { icon: Brain, title: "Local LLM", sub: "OCR + VLM · analytics · sandbox" },
  { icon: BookOpenCheck, title: "Cited evidence", sub: "known · missing · conflicting" },
  { icon: ClipboardList, title: "Answer · note · alert", sub: "accountable human" },
];

export function Flow() {
  return (
    <Section id="flow" index="02" label="End to end" icon={<Route size={12} />} title={<>From a question <span className="italic text-mute">to a decision.</span></>} grid>
      <div className="relative">
        {/* the track and the moving packet */}
        <div className="absolute left-[7%] right-[7%] top-[34px] hidden h-px bg-ink/15 lg:block">
          <motion.span
            className="absolute -top-[3px] h-[7px] w-[7px] rounded-full bg-gold shadow-[0_0_0_4px_rgba(168,130,63,0.15)]"
            animate={{ left: ["0%", "100%"] }} transition={{ duration: 6, repeat: Infinity, ease: "linear" }} />
          <motion.span
            className="absolute -top-[3px] h-[7px] w-[7px] rounded-full bg-ink"
            animate={{ left: ["0%", "100%"] }} transition={{ duration: 6, repeat: Infinity, ease: "linear", delay: 3 }} />
        </div>
        <div className="absolute bottom-6 left-[34px] top-6 w-px bg-ink/15 lg:hidden" />
        <ol className="relative grid gap-6 lg:grid-cols-7 lg:gap-3">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const last = i === STEPS.length - 1;
            return (
              <Reveal key={s.title} delay={i * 0.07} className="flex items-start gap-4 lg:flex-col lg:items-center lg:text-center">
                <div className={cx("relative flex h-[68px] w-[68px] shrink-0 items-center justify-center rounded-2xl border bg-white",
                  last ? "border-ok/40 text-ok" : i === 2 ? "border-gold/50 text-gold" : "border-line text-ink")}>
                  <Icon size={24} strokeWidth={1.6} />
                  <span className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full border border-line bg-white px-1 font-mono text-[10px] text-mute">{i + 1}</span>
                </div>
                <div className="pt-2 lg:pt-3">
                  <div className="text-[14px] font-medium leading-tight">{s.title}</div>
                  <div className="mt-1 font-mono text-[10.5px] leading-snug text-mute">{s.sub}</div>
                </div>
              </Reveal>
            );
          })}
        </ol>
      </div>
    </Section>
  );
}
