"use client";

import { motion, type HTMLMotionProps } from "motion/react";
import { ArrowDown } from "lucide-react";
import { useSyncExternalStore, type ReactNode } from "react";
import { DOWNLOAD_URL, MAC_DOWNLOAD_URL, VERSION } from "@/lib/site";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

/** The Yukti hexagon, drawn for a light page: ink body, gold rim, white Y. */
export function YuktiMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden>
      <polygon points="16,2 28,9 28,23 16,30 4,23 4,9" fill="#0B0B0C" stroke="#A8823F" strokeWidth="1.6" />
      <path d="M10 10 L16 17 L22 10 M16 17 V24" fill="none" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function WindowsIcon({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={className} aria-hidden fill="currentColor">
      <path d="M0 2.2 6.5 1.3v6.2H0zM7.3 1.2 16 0v7.5H7.3zM0 8.3h6.5v6.3L0 13.7zM7.3 8.3H16V16l-8.7-1.2z" />
    </svg>
  );
}

export function GithubIcon({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={className} aria-hidden fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

export function AppleIcon({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={className} aria-hidden fill="currentColor">
      <path d="M11.18 8.5c-.02-1.73 1.41-2.56 1.47-2.6-.8-1.17-2.05-1.33-2.5-1.35-1.06-.11-2.07.63-2.61.63-.54 0-1.37-.61-2.25-.6-1.16.02-2.23.68-2.83 1.71-1.21 2.1-.31 5.2.87 6.9.58.83 1.26 1.77 2.16 1.73.87-.03 1.2-.56 2.25-.56s1.35.56 2.26.55c.93-.02 1.52-.85 2.09-1.68.66-.96.93-1.89.94-1.94-.02-.01-1.81-.69-1.83-2.75zM9.47 3.43c.48-.58.8-1.38.71-2.18-.69.03-1.52.46-2.01 1.03-.44.51-.83 1.33-.73 2.11.77.06 1.55-.39 2.03-.96z" />
    </svg>
  );
}

type Platform = "win" | "mac";
const PLATFORMS: Record<Platform, { href: string; label: string; sr: string; Icon: typeof WindowsIcon }> = {
  win: { href: DOWNLOAD_URL, label: "Download for Windows", sr: "installer for Windows 10 and 11", Icon: WindowsIcon },
  mac: { href: MAC_DOWNLOAD_URL, label: "Download for Mac", sr: "disk image for macOS 13.3 or later on Apple silicon", Icon: AppleIcon },
};

export function DownloadButton({ size = "md", platform = "win", primary = true, compact = false, className }: {
  size?: "md" | "lg"; platform?: Platform; primary?: boolean; compact?: boolean; className?: string;
}) {
  const p = PLATFORMS[platform];
  return (
    <a
      href={p.href}
      className={cx(
        "group relative inline-flex items-center gap-3 overflow-hidden rounded-full transition-transform hover:-translate-y-0.5 active:translate-y-0",
        primary ? "bg-ink text-white shadow-[0_10px_30px_-12px_rgba(11,11,12,0.55)]" : "border border-line-2 bg-white text-ink hover:border-ink",
        size === "lg" ? (compact ? "h-14 gap-2.5 pl-5 pr-2 text-[14px]" : "h-14 pl-6 pr-2 text-[15px]") : "h-11 pl-5 pr-1.5 text-[14px]",
        className,
      )}
    >
      {primary && <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/15 to-transparent transition-transform duration-700 group-hover:translate-x-full" />}
      <p.Icon size={size === "lg" ? 16 : 14} />
      <span className="font-medium">{p.label}</span>
      <span
        className={cx(
          "flex items-center justify-center rounded-full transition-transform group-hover:translate-y-0.5",
          primary ? "bg-white text-ink" : "bg-ink text-white",
          size === "lg" ? "h-10 w-10" : "h-8 w-8",
        )}
      >
        <ArrowDown size={size === "lg" ? 18 : 15} strokeWidth={2.25} />
      </span>
      <span className="sr-only">Yukti {VERSION} {p.sr}</span>
    </a>
  );
}

/** The visitor's own system: a Mac gets the Mac button first and dark. Windows (and the first render) by default. */
const subscribeNoop = () => () => {};
function useVisitorPlatform(): Platform {
  return useSyncExternalStore(subscribeNoop,
    () => (/Macintosh|Mac OS X/i.test(navigator.userAgent) && !/iPhone|iPad|Mobile/i.test(navigator.userAgent) ? "mac" : "win"),
    () => "win");
}

export function DownloadButtons({ size = "lg", className }: { size?: "md" | "lg"; className?: string }) {
  const first = useVisitorPlatform();
  const order: Platform[] = first === "mac" ? ["mac", "win"] : ["win", "mac"];
  return (
    <div className={cx("flex flex-wrap items-center gap-3", className)}>
      {order.map((pl, i) => <DownloadButton key={pl} size={size} platform={pl} primary={i === 0} compact />)}
    </div>
  );
}

export function Reveal({ children, delay = 0, y = 18, className, ...rest }: { children: ReactNode; delay?: number; y?: number } & HTMLMotionProps<"div">) {
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.05 }}
      transition={{ duration: 0.7, delay, ease: [0.2, 0.7, 0.2, 1] }}
      className={className}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

/** A framed band of the page: rails left and right, a hairline on top with "+" marks where the lines cross. */
export function Section({
  id, index, label, icon, title, children, className, grid = false,
}: {
  id?: string; index: string; label: string; icon?: ReactNode; title?: ReactNode; children: ReactNode; className?: string; grid?: boolean;
}) {
  return (
    <section id={id} className="relative scroll-mt-16 border-t border-line">
      <div className="relative mx-auto max-w-[1200px] border-x border-line">
        <span className="cross -left-[6px] -top-[6px]" />
        <span className="cross -right-[6px] -top-[6px]" />
        {grid && <div className="bp-grid fade-mask pointer-events-none absolute inset-0" />}
        <div className={cx("relative px-5 py-20 sm:px-10 md:py-28", className)}>
          <Reveal className="mb-12 flex flex-col gap-5 md:mb-16">
            <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.18em] text-mute">
              <span className="text-ink">{index}</span>
              <span className="h-px w-8 bg-line-2" />
              <span className="flex items-center gap-1.5">{icon}{label}</span>
            </div>
            {title && <h2 className="max-w-3xl font-serif text-[40px] leading-[1.02] tracking-[-0.01em] sm:text-[56px]">{title}</h2>}
          </Reveal>
          {children}
        </div>
      </div>
    </section>
  );
}

export function Chip({ children, tone = "line", className }: { children: ReactNode; tone?: "line" | "ok" | "warn" | "bad" | "gold" | "ink" | "mute"; className?: string }) {
  const t = {
    line: "border-line-2 bg-white text-ink-2",
    ok: "border-ok/25 bg-ok-soft text-ok",
    warn: "border-warn/25 bg-warn-soft text-warn",
    bad: "border-bad/25 bg-bad-soft text-bad",
    gold: "border-gold/30 bg-gold-soft text-gold",
    ink: "border-ink bg-ink text-white",
    mute: "border-line bg-paper-2 text-mute",
  }[tone];
  return <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 font-mono text-[11px] tracking-wide", t, className)}>{children}</span>;
}

/** A small framed card with corner ticks. */
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("relative rounded-2xl border border-line bg-white", className)}>
      {children}
    </div>
  );
}
