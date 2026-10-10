"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { Boxes, Check, Cloud, Link2, Monitor, Network, Server, X } from "lucide-react";
import { Reveal, Section, YuktiMark, cx } from "./ui";

const LAYERS = [
  { n: "1", name: "Who is asking", parts: ["argon2id + MFA", "sessions", "IAM attributes"], tone: "bg-white" },
  { n: "2", name: "Decide & route", parts: ["ABAC policy", "Laya · ONNX", "durable queue"], tone: "bg-gold-soft" },
  { n: "3", name: "Knowledge & output", parts: ["hybrid retrieval", "facts · ledger", "workbench", "scan → finding", "forecast + HiGHS"], tone: "bg-white" },
  { n: "4", name: "Performance Engine", parts: ["llama.cpp", "CUDA / Vulkan", "hot KV", "watchdog"], tone: "bg-ink" },
];

function Stack() {
  return (
    <div className="relative mx-auto h-[380px] w-full max-w-[520px] [perspective:1600px] sm:h-[440px]">
      <div className="absolute left-1/2 top-[54%] h-0 w-0 [transform-style:preserve-3d] [transform:rotateX(58deg)_rotateZ(-38deg)]">
        {LAYERS.map((l, i) => {
          const z = (LAYERS.length - 1 - i) * 62;
          const dark = l.tone === "bg-ink";
          return (
            <motion.div key={l.n}
              initial={{ opacity: 0, z: z - 120 }} whileInView={{ opacity: 1, z }} viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.9, delay: (LAYERS.length - i) * 0.12, ease: [0.2, 0.7, 0.2, 1] }}
              className={cx("absolute -left-[150px] -top-[150px] h-[300px] w-[300px] rounded-[22px] border p-4 shadow-[0_30px_60px_-30px_rgba(11,11,12,0.35)] sm:-left-[170px] sm:-top-[170px] sm:h-[340px] sm:w-[340px]",
                dark ? "border-ink bg-ink" : "border-line-2", l.tone)}
              style={{ transformStyle: "preserve-3d" }}>
              <div className={cx("grid h-full grid-cols-3 gap-2", dark && "opacity-90")}>
                {Array.from({ length: 9 }, (_, k) => (
                  <div key={k} className={cx("rounded-lg border", dark ? "border-white/15" : "border-line",
                    k < l.parts.length ? (dark ? "bg-white/10" : i === 1 ? "bg-white" : "bg-paper-2") : "border-dashed")} />
                ))}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

function hash(n: number) {
  let h = (n * 2654435761) >>> 0;
  let s = "";
  for (let i = 0; i < 8; i++) { s += "0123456789abcdef"[h & 15]; h = (h >>> 4) | ((h & 15) << 28); h = (h * 1103515245 + 12345) >>> 0; }
  return s;
}
const EVENTS = ["login", "policy.deny", "retrieval", "tool.call", "chat.answer", "approval", "access.grant"];

function AuditChain() {
  const [n, setN] = useState(5);
  useEffect(() => { const t = setInterval(() => setN((x) => x + 1), 2200); return () => clearInterval(t); }, []);
  const blocks = Array.from({ length: 5 }, (_, i) => n - 4 + i);
  return (
    <div className="flex flex-col items-stretch">
      {blocks.map((b, i) => {
        const head = i === blocks.length - 1;
        return (
          <div key={i}>
            {i > 0 && <div className="flex h-5 items-center justify-center"><Link2 size={12} className="rotate-90 text-gold" /></div>}
            <div className={cx("flex items-center gap-3 rounded-xl border px-3.5 py-2.5 transition-colors", head ? "border-ink bg-ink text-white" : "border-line bg-white")}>
              <span className={cx("font-mono text-[10px]", head ? "text-white/60" : "text-faint")}>#{String(b).padStart(4, "0")}</span>
              <motion.span key={b} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className="font-mono text-[11.5px]">{EVENTS[b % EVENTS.length]}</motion.span>
              <span className={cx("ml-auto font-mono text-[10.5px]", head ? "text-gold" : "text-mute")}>{hash(b)}…</span>
            </div>
          </div>
        );
      })}
      <div className="mt-3 text-center font-mono text-[10.5px] text-mute">SHA-256 · hash-chained · verifiable</div>
    </div>
  );
}

export function Architecture() {
  return (
    <Section id="architecture" index="05" label="Architecture" icon={<Boxes size={12} />} title={<>Four layers. <span className="italic text-mute">One server. Your plant.</span></>} grid>
      <div className="grid items-center gap-10 lg:grid-cols-[auto_1fr_260px]">
        <Reveal className="flex flex-row gap-3 lg:flex-col">
          {[{ i: Monitor, l: "Desktop app" }, { i: Network, l: "Browser" }].map(({ i: I, l }) => (
            <div key={l} className="flex items-center gap-2.5 rounded-xl border border-line bg-white px-3.5 py-2.5">
              <I size={16} /><span className="text-[13px]">{l}</span>
            </div>
          ))}
          <div className="hidden items-center gap-2 pl-2 font-mono text-[10.5px] text-mute lg:flex"><span className="h-8 w-px bg-ink/25" />plant LAN</div>
          <div className="flex items-center gap-2.5 rounded-xl border border-ink bg-ink px-3.5 py-2.5 text-white">
            <Server size={16} /><span className="text-[13px]">GPU server</span>
          </div>
        </Reveal>
        <div className="relative">
          <Stack />
          <ol className="mt-2 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {LAYERS.map((l, i) => (
              <Reveal key={l.n} delay={0.3 + i * 0.1} className="flex items-start gap-2.5 rounded-xl border border-line bg-white px-3 py-2.5">
                <span className={cx("mt-0.5 flex h-5 w-5 items-center justify-center rounded-full font-mono text-[10px]", l.tone === "bg-ink" ? "bg-ink text-white" : l.tone === "bg-gold-soft" ? "bg-gold text-white" : "border border-line-2")}>{l.n}</span>
                <div className="min-w-0">
                  <div className="text-[12.5px] font-medium">{l.name}</div>
                  <div className="font-mono text-[10px] leading-snug text-mute">{l.parts.slice(0, 3).join(" · ")}</div>
                </div>
              </Reveal>
            ))}
          </ol>
        </div>
        <Reveal delay={0.2}><AuditChain /></Reveal>
      </div>
      <Reveal delay={0.1} className="mt-14 overflow-hidden border-y border-line py-4 [mask-image:linear-gradient(90deg,transparent,#000_10%,#000_90%,transparent)]">
        <div className="marquee flex w-max gap-3">
          {[0, 1].map((k) => (
            <div key={k} className="flex gap-3">
              {["Python", "FastAPI", "React + Vite", "Electron", "llama.cpp", "ONNX Runtime", "CUDA", "Vulkan", "Gemma 3 4B", "RapidOCR", "whisper.cpp", "AI4Bharat", "HiGHS LP", "SQLite FTS5", "BGE-M3", "argon2id", "ABAC", "SHA-256"].map((t) => (
                <span key={t} className="whitespace-nowrap rounded-full border border-line bg-white px-3.5 py-1.5 font-mono text-[12px] text-ink-2">{t}</span>
              ))}
            </div>
          ))}
        </div>
      </Reveal>
    </Section>
  );
}

const COMPARE = [
  { k: "Data", cloud: "leaves the plant", yukti: "on-premise · air-gapped" },
  { k: "Cost", cloud: "pay per token", yukti: "one-time hardware" },
  { k: "Serving", cloud: "generic", yukti: "q8_0 KV · speculative · profiles" },
  { k: "Trust", cloud: "fluent, unsourced", yukti: "cited · known · missing · conflicting" },
];

export function Compare() {
  return (
    <Section index="06" label="Why on-prem" icon={<Cloud size={12} />} title={<>Cloud AI is off-limits <span className="italic text-mute">for P&IDs.</span></>}>
      <div className="overflow-hidden rounded-2xl border border-line">
        <div className="grid grid-cols-[80px_1fr_1fr] border-b border-line bg-paper-2 sm:grid-cols-[140px_1fr_1fr]">
          <div />
          <div className="flex items-center gap-2 border-l border-line px-4 py-4 text-mute sm:px-6"><Cloud size={18} /><span className="text-[13px]">Cloud assistants</span></div>
          <div className="flex items-center gap-2 border-l border-line px-4 py-4 sm:px-6"><YuktiMark size={18} /><span className="text-[13px] font-medium">Yukti</span></div>
        </div>
        {COMPARE.map((r, i) => (
          <Reveal key={r.k} delay={i * 0.08} className="grid grid-cols-[80px_1fr_1fr] border-b border-line last:border-b-0 sm:grid-cols-[140px_1fr_1fr]">
            <div className="flex items-center px-4 py-5 font-mono text-[10.5px] uppercase tracking-[0.16em] text-mute sm:px-6">{r.k}</div>
            <div className="flex items-center gap-2.5 border-l border-line px-4 py-5 text-[13px] text-mute sm:px-6">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-bad-soft text-bad"><X size={11} strokeWidth={3} /></span>{r.cloud}
            </div>
            <div className="flex items-center gap-2.5 border-l border-line px-4 py-5 text-[13px] font-medium sm:px-6">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ok-soft text-ok"><Check size={11} strokeWidth={3} /></span>{r.yukti}
            </div>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
