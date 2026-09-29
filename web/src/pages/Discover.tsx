import { CheckCircle2, Compass, Cpu, Download, XCircle } from 'lucide-react';
import { useSystem } from '../lib/queries';
import { fmtMB } from '../lib/format';
import { Badge, Card, PageHeader, type Tone } from '../components/ui';

type CatalogModel = {
  name: string; role: string; engine: string; quant: string; vram_gb: number; params: string; note: string; tone: Tone;
};
type Tier = { tier: string; blurb: string; models: CatalogModel[] };

const CATALOG: Tier[] = [
  {
    tier: 'Laptop · 6 GB GPU', blurb: 'Runs fully offline on an engineer laptop with llama.cpp / Bionic.',
    models: [
      { name: 'Gemma-2-2B-it', role: 'Chat / fallback', engine: 'llama.cpp · Bionic', quant: 'Q4_K_M GGUF', vram_gb: 2.2, params: '2.6B', note: 'Fastest; good for short SOP lookups.', tone: 'cyan' },
      { name: 'Qwen3.5-4B-Instruct', role: 'Default assistant', engine: 'llama.cpp · Bionic', quant: 'Q4_K_M GGUF', vram_gb: 3.6, params: '4B', note: 'Best quality per GB; thinking mode supported.', tone: 'amber' },
      { name: 'Gemma-4-E4B-it', role: 'Multimodal (vision)', engine: 'llama.cpp · Bionic', quant: 'Q4_K_M + mmproj', vram_gb: 4.8, params: 'E4B', note: 'Reads P&ID crops and nameplate photos.', tone: 'violet' },
    ],
  },
  {
    tier: 'MoE swap-in', blurb: 'Sparse experts: large knowledge, small active parameters. CPU offload of experts supported.',
    models: [
      { name: 'gpt-oss-20b', role: 'Reasoning / dossiers', engine: 'llama.cpp · vLLM', quant: 'MXFP4', vram_gb: 13, params: '21B (3.6B active)', note: 'Use --n-cpu-moe to fit on 8–12 GB.', tone: 'amber' },
      { name: 'Gemma-4-26B-A4B', role: 'Reasoning + vision', engine: 'llama.cpp · vLLM', quant: 'Q4_K_M GGUF', vram_gb: 16, params: '26B (4B active)', note: 'Strong multilingual (Hindi) support.', tone: 'violet' },
    ],
  },
  {
    tier: 'Plant GPU server', blurb: 'Shared on-prem inference node (e.g. NVIDIA L40S 48 GB) behind the plant firewall.',
    models: [
      { name: 'Qwen3.8-27B', role: 'Plant-wide assistant', engine: 'vLLM on L40S', quant: 'FP8', vram_gb: 32, params: '27B', note: 'High concurrency with paged attention and prefix caching.', tone: 'amber' },
    ],
  },
  {
    tier: 'Embeddings', blurb: 'Vectorises document chunks for retrieval.',
    models: [
      { name: 'Qwen3-Embedding-0.6B', role: 'Dense embeddings', engine: 'llama.cpp (embedding)', quant: 'Q8_0 GGUF', vram_gb: 0.8, params: '0.6B', note: '1024-d, multilingual; CPU friendly.', tone: 'cyan' },
    ],
  },
  {
    tier: 'Reranker', blurb: 'Re-orders retrieved passages before citing.',
    models: [
      { name: 'Qwen3-Reranker-0.6B', role: 'Cross-encoder rerank', engine: 'llama.cpp (rerank)', quant: 'Q8_0 GGUF', vram_gb: 0.8, params: '0.6B', note: 'Sharper top-5 on revision-sensitive queries.', tone: 'cyan' },
    ],
  },
  {
    tier: 'OCR', blurb: 'Turns scanned inspection reports and legacy drawings into text.',
    models: [
      { name: 'RapidOCR PP-OCRv5', role: 'Scanned page OCR', engine: 'ONNX Runtime (CPU)', quant: 'ONNX', vram_gb: 0, params: '~15M', note: 'Runs on CPU; default OCR stage.', tone: 'ok' },
      { name: 'GLM-OCR', role: 'Layout-aware OCR (tables)', engine: 'llama.cpp · vLLM', quant: 'Q4_K_M GGUF', vram_gb: 2.5, params: '0.9B', note: 'For complex tables and handwritten forms.', tone: 'violet' },
    ],
  },
];

function FitCheck({ need, gpuMb, hasGpu, loading }: { need: number; gpuMb: number; hasGpu: boolean; loading: boolean }) {
  if (loading) return <span className="text-[11.5px] text-faint">Checking hardware…</span>;
  if (need === 0) return <span className="inline-flex items-center gap-1 text-[11.5px] text-ok"><CheckCircle2 size={13} />Runs on CPU</span>;
  if (!hasGpu) return <span className="inline-flex items-center gap-1 text-[11.5px] text-amber"><Cpu size={13} />No GPU · CPU-only (slow)</span>;
  const fits = need * 1024 <= gpuMb * 0.95;
  return fits
    ? <span className="inline-flex items-center gap-1 text-[11.5px] text-ok"><CheckCircle2 size={13} />Fits this machine</span>
    : <span className="inline-flex items-center gap-1 text-[11.5px] text-red-300"><XCircle size={13} />Needs more VRAM ({fmtMB(gpuMb)} available)</span>;
}

export default function Discover() {
  const sys = useSystem();
  const gpu = sys.data?.gpu ?? null;
  return (
    <div className="h-full overflow-y-auto">
      <PageHeader title="Discover" icon={<Compass size={18} />}
        subtitle="Curated open-weight models recommended for Yukti, by role and hardware tier"
        actions={<Badge tone={gpu ? 'cyan' : 'muted'} mono>{gpu ? `${gpu.name} · ${fmtMB(gpu.vram_total_mb)}` : sys.isLoading ? 'Detecting GPU…' : 'No GPU detected'}</Badge>} />
      <div className="space-y-5 p-5">
        <div className="flex items-start gap-2 rounded-md border border-cyan/30 bg-cyan/5 px-3 py-2 text-[12.5px]">
          <Download size={14} className="mt-0.5 text-cyan" />
          <div>Yukti is air-gapped, so nothing is downloaded from here. <span className="text-muted">Download via Bionic / plant mirror, then drop the GGUF into the models folder — it appears in My Models.</span></div>
        </div>
        {CATALOG.map((t) => (
          <section key={t.tier}>
            <div className="mb-2 flex items-baseline gap-2">
              <h2 className="text-[13.5px] font-semibold">{t.tier}</h2>
              <span className="text-[12px] text-muted">{t.blurb}</span>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {t.models.map((m) => (
                <Card key={m.name} className="flex flex-col" bodyClass="flex flex-1 flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold">{m.name}</div>
                      <div className="text-[12px] text-muted">{m.role}</div>
                    </div>
                    <Badge tone={m.tone}>{m.params}</Badge>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge mono tone="muted">{m.engine}</Badge>
                    <Badge mono tone="muted">{m.quant}</Badge>
                    <Badge mono tone={m.vram_gb === 0 ? 'ok' : 'neutral'}>{m.vram_gb === 0 ? 'CPU' : `~${m.vram_gb} GB VRAM`}</Badge>
                  </div>
                  <div className="flex-1 text-[12px] text-muted">{m.note}</div>
                  <div className="flex items-center justify-between border-t border-border pt-2">
                    <FitCheck need={m.vram_gb} gpuMb={gpu?.vram_total_mb ?? 0} hasGpu={!!gpu} loading={sys.isLoading} />
                    <span className="text-[11px] text-faint">Download via Bionic / plant mirror</span>
                  </div>
                </Card>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
