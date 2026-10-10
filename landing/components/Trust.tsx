"use client";

import { motion } from "motion/react";
import { Ban, CalendarClock, Check, Clock3, FileText, Flame, Hash, Layers, Link2, Search, ShieldCheck, Timer, UserRound, UserRoundCog } from "lucide-react";
import { Card, Chip, Reveal, Section, cx } from "./ui";

function Row({ icon, k, children, delay }: { icon: React.ReactNode; k: string; children: React.ReactNode; delay: number }) {
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay }}
      className="grid grid-cols-[22px_96px_1fr] items-center gap-2 px-5 py-3 sm:grid-cols-[22px_120px_1fr]">
      <span className="text-mute">{icon}</span>
      <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-mute">{k}</span>
      <span className="flex flex-wrap items-center gap-1.5 text-[13px]">{children}</span>
    </motion.div>
  );
}

function Evidence() {
  return (
    <Card className="overflow-hidden shadow-[0_30px_80px_-40px_rgba(11,11,12,0.3)]">
      <div className="flex items-center gap-2 border-b border-line bg-paper-2 px-5 py-3">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-ink font-mono text-[10px] font-semibold text-white">S1</span>
        <span className="text-[13px] font-medium">Evidence</span>
        <span className="ml-auto flex gap-1">{[0, 1, 2].map((i) => <span key={i} className="h-2 w-2 rounded-full bg-line-2" />)}</span>
      </div>
      <div className="divide-y divide-line">
        <Row icon={<FileText size={14} />} k="source" delay={0.05}><span className="font-mono">SOP-EL-014</span></Row>
        <Row icon={<Layers size={14} />} k="revision" delay={0.1}><span className="font-mono">rev 3</span><Chip tone="ok">CURRENT</Chip><span className="font-mono text-faint line-through">rev 2</span></Row>
        <Row icon={<Hash size={14} />} k="page · record" delay={0.15}><span className="font-mono">p.2</span><span className="text-faint">·</span><span className="font-mono">A2_WorkOrders!34</span></Row>
        <Row icon={<CalendarClock size={14} />} k="timestamp" delay={0.2}><span className="font-mono">2026-09-29</span></Row>
        <Row icon={<Timer size={14} />} k="confidence" delay={0.25}>
          <span className="relative h-1.5 w-32 overflow-hidden rounded-full bg-paper-3">
            <motion.span className="absolute inset-y-0 left-0 rounded-full bg-ink" initial={{ width: 0 }} whileInView={{ width: "84%" }} viewport={{ once: true }} transition={{ duration: 1.2, delay: 0.4 }} />
          </span>
          <span className="font-mono">0.84</span>
        </Row>
        <Row icon={<ShieldCheck size={14} />} k="status" delay={0.3}><Chip tone="ok">● KNOWN</Chip><Chip tone="mute">○ MISSING</Chip><Chip tone="warn">◐ CONFLICTING</Chip></Row>
        <Row icon={<Search size={14} />} k="found by" delay={0.35}>{["bm25", "tags", "graph", "vector"].map((x) => <Chip key={x}>{x}</Chip>)}</Row>
      </div>
    </Card>
  );
}

const SEQ = [
  { who: "Electrician", icon: UserRound, ask: "A2 dossier", result: "allowed", tone: "ok" as const },
  { who: "Boiler engineer", icon: Flame, ask: "Finance audit", result: "denied", tone: "bad" as const },
  { who: "Boiler engineer", icon: Flame, ask: "Access request · why", result: "to manager", tone: "line" as const },
  { who: "Dept. manager", icon: UserRoundCog, ask: "Time-bound grant", result: "≤ 72 h", tone: "gold" as const },
];

function Access() {
  return (
    <Card className="relative overflow-hidden p-5 sm:p-7">
      <div className="bp-grid-fine pointer-events-none absolute inset-0 opacity-70" />
      <div className="relative">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-ink text-white"><ShieldCheck size={20} /></div>
          <div>
            <div className="text-[14px] font-medium">Policy engine</div>
            <div className="font-mono text-[10.5px] text-mute">ABAC · deny-overrides · default deny</div>
          </div>
        </div>
        <ol className="relative space-y-3">
          <span className="absolute bottom-3 left-[19px] top-3 w-px bg-line-2" />
          {SEQ.map((s, i) => {
            const Icon = s.icon;
            return (
              <motion.li key={i} initial={{ opacity: 0, x: -10 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: 0.2 + i * 0.25 }}
                className="relative flex items-center gap-3">
                <span className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line bg-white"><Icon size={16} /></span>
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-line bg-white px-3.5 py-2.5">
                  <span className="text-[12px] text-mute">{s.who}</span>
                  <span className="text-[13px] font-medium">{s.ask}</span>
                  <span className="ml-auto">
                    <Chip tone={s.tone}>
                      {s.tone === "ok" ? <Check size={11} strokeWidth={3} /> : s.tone === "bad" ? <Ban size={11} /> : s.tone === "gold" ? <Clock3 size={11} /> : null}
                      {s.result}
                    </Chip>
                  </span>
                </div>
              </motion.li>
            );
          })}
        </ol>
        <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ delay: 1.4 }}
          className="mt-6 flex items-center gap-2 border-t border-dashed border-line-2 pt-4 font-mono text-[11px] text-mute">
          <Link2 size={13} className="text-gold" /> every decision → SHA-256 audit chain
        </motion.div>
      </div>
    </Card>
  );
}

export function Trust() {
  return (
    <Section id="trust" index="03" label="Trust" icon={<ShieldCheck size={12} />}
      title={<>An answer the right person <span className="italic text-mute">is allowed to trust.</span></>}>
      <div className="grid gap-6 lg:grid-cols-2">
        <Reveal><Evidence /></Reveal>
        <Reveal delay={0.15}><Access /></Reveal>
      </div>
      <Reveal delay={0.2} className="mt-6 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-3">
        {[
          ["The LLM never grants access", "host policy · before retrieval & every tool"],
          ["Small model decides first", "denials & off-topic answered without the LLM"],
          ["Advisory only", "no tool writes to DCS / SCADA"],
        ].map(([a, b], i) => (
          <div key={a} className={cx("bg-white px-5 py-5")}>
            <div className="font-mono text-[10px] text-faint">0{i + 1}</div>
            <div className="mt-2 text-[14px] font-medium">{a}</div>
            <div className="mt-1 font-mono text-[11px] text-mute">{b}</div>
          </div>
        ))}
      </Reveal>
    </Section>
  );
}
