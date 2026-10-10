"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import {
  BookMarked, Calculator, Camera, ClipboardCheck, Code2, Cpu, FileSpreadsheet, FileText, FlaskConical, Globe2, LayoutGrid,
  Library, Mic, Presentation, Route, ScanLine, Tag, TrendingUp, Workflow,
} from "lucide-react";
import { Chip, Reveal, Section, cx } from "./ui";

function Tile({ icon, title, sub, className, children, delay = 0 }: { icon: React.ReactNode; title: string; sub?: string; className?: string; children: React.ReactNode; delay?: number }) {
  return (
    <Reveal delay={delay} className={cx("group relative flex min-h-[260px] flex-col overflow-hidden rounded-2xl border border-line bg-white transition-colors hover:border-line-2", className)}>
      <div className="relative flex-1 overflow-hidden">{children}</div>
      <div className="flex items-center gap-2.5 border-t border-line px-5 py-3.5">
        <span className="text-ink">{icon}</span>
        <span className="whitespace-nowrap text-[13.5px] font-medium">{title}</span>
        {sub && <span className="ml-auto min-w-0 truncate pl-2 font-mono text-[10.5px] text-mute">{sub}</span>}
      </div>
    </Reveal>
  );
}

const WORKERS = ["policy", "small LLM", "OCR + VLM", "analytics", "27B reasoning", "coder", "workflow"];

function Router() {
  const [k, setK] = useState(0);
  useEffect(() => { const t = setInterval(() => setK((x) => (x + 1) % WORKERS.length), 1400); return () => clearInterval(t); }, []);
  return (
    <div className="flex h-full items-center gap-4 px-6 py-6 sm:gap-8">
      <div className="flex flex-col items-center gap-2">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-gold/40 bg-gold-soft text-gold"><Route size={26} strokeWidth={1.6} /></div>
        <span className="font-mono text-[10px] text-mute">Laya · ONNX</span>
      </div>
      <svg className="h-[190px] w-16 shrink-0 sm:w-24" viewBox="0 0 100 190" preserveAspectRatio="none">
        {WORKERS.map((_, i) => {
          const y = 12 + i * 27.6;
          return <path key={i} d={`M0 95 C 50 95, 50 ${y}, 100 ${y}`} fill="none" stroke={i === k ? "#a8823f" : "#0b0b0c"} strokeOpacity={i === k ? 1 : 0.14} strokeWidth={i === k ? 1.6 : 1} className={i === k ? "dash-flow" : ""} style={{ transition: "stroke .3s" }} />;
        })}
      </svg>
      <ul className="flex flex-col gap-[7px]">
        {WORKERS.map((w, i) => (
          <li key={w} className={cx("rounded-md border px-2 py-[3px] font-mono text-[10.5px] transition-colors duration-300",
            i === k ? "border-ink bg-ink text-white" : "border-line text-mute")}>{w}</li>
        ))}
      </ul>
    </div>
  );
}

function Retrieval() {
  const rows = [["bm25", 92], ["asset tags", 74], ["metadata", 58], ["knowledge graph", 81], ["BGE-M3 vectors", 66]] as const;
  return (
    <div className="space-y-2.5 px-6 py-7">
      {rows.map(([l, w], i) => (
        <div key={l} className="flex items-center gap-3">
          <span className="w-[104px] shrink-0 font-mono text-[10.5px] text-mute">{l}</span>
          <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-paper-3">
            <motion.span className="absolute inset-y-0 left-0 rounded-full bg-ink" initial={{ width: 0 }} whileInView={{ width: `${w}%` }} viewport={{ once: true }} transition={{ duration: 1, delay: i * 0.1 }} />
          </span>
        </div>
      ))}
      <div className="flex items-center gap-2 pt-2 font-mono text-[10.5px] text-mute"><span className="h-px flex-1 bg-line-2" />behind the policy check<span className="h-px flex-1 bg-line-2" /></div>
    </div>
  );
}

function Workbench() {
  const files = [
    { i: FileText, l: ".docx", c: "text-[#2b579a]" }, { i: Presentation, l: ".pptx", c: "text-[#c43e1c]" },
    { i: FileSpreadsheet, l: ".xlsx", c: "text-[#217346]" }, { i: Calculator, l: "steps", c: "text-ink" },
  ];
  return (
    <div className="flex h-full flex-col justify-center gap-4 px-6 py-6">
      <div className="grid grid-cols-4 gap-2">
        {files.map(({ i: I, l, c }, k) => (
          <motion.div key={l} initial={{ y: 12, opacity: 0 }} whileInView={{ y: 0, opacity: 1 }} viewport={{ once: true }} transition={{ delay: k * 0.1 }}
            className="flex aspect-[3/4] flex-col items-center justify-center gap-1.5 rounded-lg border border-line bg-paper-2">
            <I size={20} className={c} strokeWidth={1.6} /><span className="font-mono text-[10px] text-mute">{l}</span>
          </motion.div>
        ))}
      </div>
      <div className="rounded-lg border border-dashed border-line-2 bg-white px-3 py-2 font-mono text-[10.5px] text-ink-2">
        <span className="text-mute">$</span> sandbox.run(calc.py) <span className="ml-1 text-ok">✓</span> <span className="text-faint">· no network</span>
      </div>
    </div>
  );
}

function Scan() {
  return (
    <div className="flex h-full items-center justify-center gap-4 px-6 py-6">
      <div className="relative h-[160px] w-[124px] overflow-hidden rounded-md border border-line bg-paper-2 p-3">
        {[80, 60, 90, 45, 70, 85, 50].map((w, i) => <div key={i} className="mb-2 h-1.5 rounded bg-ink/15" style={{ width: `${w}%` }} />)}
        <div className="mt-3 h-8 w-12 rounded border border-gold/50" />
        <motion.div className="absolute inset-x-0 top-0 h-10 border-b-2 border-gold bg-gradient-to-b from-transparent to-gold/15"
          animate={{ y: [-40, 160] }} transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut", repeatType: "reverse" }} />
      </div>
      <div className="flex flex-col gap-1.5 font-mono text-[10px]">
        {["OCR + VLM", "verify", "review", "finding", "note", "lane"].map((s, i) => (
          <span key={s} className={cx("rounded border px-2 py-0.5", i === 3 ? "border-ok/40 bg-ok-soft text-ok" : "border-line text-mute")}>{s}</span>
        ))}
      </div>
    </div>
  );
}

const LANES = ["electrical", "mechanical", "HSE", "procurement", "finance", "management"];
function Lanes() {
  return (
    <div className="space-y-2 px-6 py-6">
      {LANES.map((l, i) => (
        <div key={l} className="flex items-center gap-3">
          <span className="w-[86px] shrink-0 font-mono text-[10.5px] text-mute">{l}</span>
          <div className="relative h-6 flex-1 rounded-md border border-line bg-paper-2">
            <div className="absolute inset-y-0 left-1/3 w-px bg-line-2" />
            <div className="absolute inset-y-0 left-2/3 w-px bg-line-2" />
            <motion.span className={cx("absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full border-2 border-white shadow", i === 2 ? "bg-warn" : "bg-ink")}
              animate={{ left: ["2%", "92%"] }} transition={{ duration: 5 + i * 0.7, repeat: Infinity, ease: "easeInOut", delay: i * 0.4, repeatDelay: 0.6 }} />
          </div>
        </div>
      ))}
      <div className="flex justify-end gap-4 pt-1 font-mono text-[10px] text-faint"><span>acknowledge</span><span>escalate</span><span>decide</span></div>
    </div>
  );
}

function Ledger() {
  const rows = [["P-2041A cert", 82, false], ["PSV-118 interval", 64, false], ["M-A2 warranty", 93, true]] as const;
  return (
    <div className="space-y-3.5 px-6 py-7">
      {rows.map(([l, w, warn]) => (
        <div key={l}>
          <div className="mb-1 flex justify-between font-mono text-[10.5px]"><span className="text-ink-2">{l}</span><span className={warn ? "text-warn" : "text-mute"}>{warn ? "expires soon" : "ok"}</span></div>
          <div className="h-1.5 overflow-hidden rounded-full bg-paper-3">
            <motion.div className={cx("h-full rounded-full", warn ? "bg-warn" : "bg-ink/70")} initial={{ width: 0 }} whileInView={{ width: `${w}%` }} viewport={{ once: true }} transition={{ duration: 1.1 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Production() {
  const hist = "M0 70 L20 62 L40 66 L60 52 L80 56 L100 44";
  return (
    <div className="px-5 py-6">
      <svg viewBox="0 0 180 100" className="h-[150px] w-full">
        {[20, 45, 70, 95].map((y) => <line key={y} x1="0" x2="180" y1={y} y2={y} stroke="#0b0b0c" strokeOpacity="0.06" />)}
        <path d="M100 44 L120 34 L140 30 L160 22 L180 18 L180 40 L160 42 L140 46 L120 48 L100 44 Z" fill="#a8823f" fillOpacity="0.14" />
        <motion.path d={hist} fill="none" stroke="#0b0b0c" strokeWidth="1.6" initial={{ pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }} transition={{ duration: 1.2 }} />
        <motion.path d="M100 44 L120 41 L140 38 L160 32 L180 29" fill="none" stroke="#a8823f" strokeWidth="1.6" strokeDasharray="3 3" initial={{ pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }} transition={{ duration: 1, delay: 1.1 }} />
        <line x1="100" x2="100" y1="10" y2="95" stroke="#0b0b0c" strokeOpacity="0.25" strokeDasharray="2 3" />
      </svg>
      <div className="flex flex-wrap gap-1.5"><Chip>forecast ± band</Chip><Chip>HiGHS LP</Chip><Chip tone="ok">planners decide</Chip></div>
    </div>
  );
}

function Perf() {
  return (
    <div className="flex h-full items-center justify-center gap-6 px-6 py-6">
      <div className="relative h-28 w-28">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
          <circle cx="50" cy="50" r="42" fill="none" stroke="#efeeea" strokeWidth="9" />
          <motion.circle cx="50" cy="50" r="42" fill="none" stroke="#0b0b0c" strokeWidth="9" strokeLinecap="round" pathLength={1}
            strokeDasharray="1 1" initial={{ strokeDashoffset: 1 }} whileInView={{ strokeDashoffset: 1 - 5.1 / 6 }} viewport={{ once: true }} transition={{ duration: 1.4 }} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[22px] font-semibold tracking-tight">5.1</span>
          <span className="font-mono text-[9.5px] text-mute">of 6 GB</span>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        {["CUDA / Vulkan", "VRAM auto-fit", "q8_0 KV cache", "hot KV slots", "speculative"].map((x) => <Chip key={x}>{x}</Chip>)}
      </div>
    </div>
  );
}

function Photo() {
  return (
    <div className="flex h-full items-center justify-center px-6 py-6">
      <div className="relative">
        <div className="rounded-lg border-2 border-ink/80 bg-paper-2 px-5 py-3 text-center">
          <div className="font-mono text-[9px] tracking-[0.2em] text-mute">TAG</div>
          <div className="font-mono text-[22px] font-semibold tracking-wider">P-2041A</div>
        </div>
        {["-left-3 -top-3 border-l-2 border-t-2", "-right-3 -top-3 border-r-2 border-t-2", "-bottom-3 -left-3 border-b-2 border-l-2", "-bottom-3 -right-3 border-b-2 border-r-2"].map((c) => (
          <motion.span key={c} className={cx("absolute h-4 w-4 border-gold", c)} animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.8, repeat: Infinity }} />
        ))}
        <div className="absolute -bottom-12 left-1/2 flex -translate-x-1/2 gap-1.5 whitespace-nowrap"><Chip tone="ok">matched</Chip><Chip tone="warn">rust</Chip></div>
      </div>
    </div>
  );
}

function Voice() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 px-6 py-6">
      <div className="flex h-16 items-center gap-[3px]">
        {Array.from({ length: 28 }, (_, i) => (
          <motion.span key={i} className="w-[3px] rounded-full bg-ink" animate={{ height: [6, 10 + ((i * 13) % 40), 6] }}
            transition={{ duration: 1 + (i % 5) * 0.15, repeat: Infinity, ease: "easeInOut", delay: i * 0.04 }} />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <span className="rounded-full border border-line px-3 py-1 text-[13px]">En</span>
        <span className="rounded-full border border-line px-3 py-1 font-deva text-[14px]">हिंदी</span>
        <span className="rounded-full border border-line px-3 py-1 font-knda text-[14px]">ಕನ್ನಡ</span>
      </div>
    </div>
  );
}

function Research() {
  return (
    <div className="flex h-full items-center justify-center px-6 py-6">
      <div className="hatch relative flex h-[150px] w-[200px] items-center justify-center rounded-xl border border-line-2">
        <div className="flex h-[78px] w-[110px] flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-ink/50 bg-white">
          <FlaskConical size={20} strokeWidth={1.6} />
          <span className="font-mono text-[9.5px] text-mute">isolated</span>
        </div>
        <span className="absolute -top-2.5 left-3 bg-white px-1 font-mono text-[9.5px] text-faint">no docs · no tools · no approvals</span>
      </div>
    </div>
  );
}

function Knowledge() {
  const nodes = Array.from({ length: 14 }, (_, i) => {
    const a = (i / 14) * Math.PI * 2;
    const r = 40 + (i % 3) * 4;
    return [50 + Math.cos(a) * r, 50 + Math.sin(a) * r] as const;
  });
  return (
    <div className="relative flex h-full items-center justify-center px-6 py-4">
      <svg viewBox="-4 -4 108 108" className="spin-slow h-[180px] w-[180px]">
        {nodes.map(([x, y], i) => <line key={i} x1="50" y1="50" x2={x} y2={y} stroke="#0b0b0c" strokeOpacity="0.15" strokeWidth="0.5" />)}
        {nodes.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={i % 4 === 0 ? 2.6 : 1.7} fill={i % 4 === 0 ? "#a8823f" : "#0b0b0c"} />)}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="rounded-full bg-white px-3 text-[30px] font-semibold leading-tight tracking-tight">140</span>
        <span className="bg-white px-1 font-mono text-[10px] text-mute">public sources</span>
      </div>
    </div>
  );
}

export function Features() {
  return (
    <Section id="features" index="04" label="Features" icon={<LayoutGrid size={12} />} title={<>One workbench. <span className="italic text-mute">Twelve instruments.</span></>}>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Tile className="md:col-span-2" icon={<Workflow size={16} />} title="Laya + work queue" sub="picks the worker"><Router /></Tile>
        <Tile icon={<Library size={16} />} title="Hybrid retrieval" delay={0.05}><Retrieval /></Tile>
        <Tile icon={<Code2 size={16} />} title="Agentic workbench" delay={0.1}><Workbench /></Tile>
        <Tile icon={<ScanLine size={16} />} title="Scan → finding"><Scan /></Tile>
        <Tile className="md:col-span-2" icon={<ClipboardCheck size={16} />} title="Approver lanes" sub="acknowledge · escalate · follow up" delay={0.05}><Lanes /></Tile>
        <Tile icon={<Tag size={16} />} title="Asset ledger" sub="alerts before lapse" delay={0.1}><Ledger /></Tile>
        <Tile icon={<TrendingUp size={16} />} title="Production intelligence"><Production /></Tile>
        <Tile icon={<Cpu size={16} />} title="Performance Engine" delay={0.05}><Perf /></Tile>
        <Tile icon={<Camera size={16} />} title="Ask with a photo" sub="add-on" delay={0.1}><Photo /></Tile>
        <Tile icon={<Mic size={16} />} title="Speak instead of typing" sub="add-on" delay={0.15}><Voice /></Tile>
        <Tile icon={<FlaskConical size={16} />} title="Isolated research"><Research /></Tile>
        <Tile icon={<Globe2 size={16} />} title="Knowledge base" sub="contacts · history · records" delay={0.05}><Knowledge /></Tile>
        <Tile className="md:col-span-2 lg:col-span-2" icon={<BookMarked size={16} />} title="Real vs example data" sub="watermarked in the UI" delay={0.1}>
          <div className="flex h-full items-center gap-4 px-6 py-6">
            <div className="flex-1 rounded-xl border border-line bg-paper-2 p-4">
              <Chip tone="gold">EXAMPLE</Chip>
              <div className="mt-3 space-y-1.5">{[70, 90, 55].map((w) => <div key={w} className="h-1.5 rounded bg-ink/15" style={{ width: `${w}%` }} />)}</div>
              <div className="mt-3 font-mono text-[10px] text-mute">plant documents · written by Team UniMinds</div>
            </div>
            <div className="flex-1 rounded-xl border border-line p-4">
              <Chip tone="ok">PUBLIC · cited</Chip>
              <div className="mt-3 space-y-1.5">{[85, 60, 75].map((w) => <div key={w} className="h-1.5 rounded bg-ink/15" style={{ width: `${w}%` }} />)}</div>
              <div className="mt-3 font-mono text-[10px] text-mute">MRPL public facts · source links</div>
            </div>
          </div>
        </Tile>
      </div>
    </Section>
  );
}
