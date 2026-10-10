import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif, Noto_Sans_Devanagari, Noto_Sans_Kannada } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const serif = Instrument_Serif({ variable: "--font-serif-display", subsets: ["latin"], weight: "400", style: ["normal", "italic"] });
const deva = Noto_Sans_Devanagari({ variable: "--font-noto-deva", subsets: ["devanagari"], weight: ["500"] });
const knda = Noto_Sans_Kannada({ variable: "--font-noto-knda", subsets: ["kannada"], weight: ["500"] });

export const metadata: Metadata = {
  title: "Yukti — Sovereign Industrial AI Workbench",
  description:
    "Self-hosted, air-gapped AI for the plant: cited answers, policy-governed access, scans to approvals, production planning. Runs on the plant's own GPU server. Nothing leaves the premises.",
  icons: { icon: "/yukti.svg" },
  openGraph: {
    title: "Yukti — Sovereign Industrial AI Workbench",
    description: "Scattered plant knowledge → an authorized, traceable decision flow. Self-hosted · air-gapped.",
    type: "website",
  },
};

export const viewport: Viewport = { themeColor: "#ffffff", colorScheme: "light" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${serif.variable} ${deva.variable} ${knda.variable} antialiased`}>
      <body className="min-h-full overflow-x-hidden">{children}</body>
    </html>
  );
}
