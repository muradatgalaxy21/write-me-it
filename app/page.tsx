"use client";

import { useEffect, useRef, useState } from "react";
import { Redline } from "@/components/Redline";
import { Markdown } from "@/components/Markdown";

type Critique = { annotated: string; issues: string[] };
type Stage = "idle" | "writing" | "critiquing" | "editing" | "done";
type Phase = "outline" | "blog";

// one stage label set, prefixed per phase at render time
const STAGE_VERB: Record<Stage, string> = {
  idle: "",
  writing: "✍️  Writer is drafting…",
  critiquing: "🔴  Critic is reviewing…",
  editing: "✅  Editor is polishing…",
  done: "Done",
};

// single-track pipe: one draft, one critique, one edited result.
// `refined` flips true once the single allowed refine pass is spent.
type Pipe = {
  draft: string;
  critique: Critique | null;
  edited: string;
  refined: boolean;
};

const emptyPipe: Pipe = { draft: "", critique: null, edited: "", refined: false };

type Usage = { usage?: { total_tokens?: number }; total_tokens_all_time?: number };

async function post<T>(url: string, body: unknown): Promise<T & Usage> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail ?? data.error ?? "request failed");
  return data as T & Usage;
}

export default function Home() {
  const [topic, setTopic] = useState("RAG vs Agents");
  const [phase, setPhase] = useState<Phase>("outline");
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState("");

  const [outline, setOutline] = useState<Pipe>(emptyPipe);
  const [blog, setBlog] = useState<Pipe>(emptyPipe);

  // token counters — articleTokens = this run (outline + blog), total = all-time backend
  const [articleTokens, setArticleTokens] = useState(0);
  const [totalTokens, setTotalTokens] = useState(0);

  const continueRef = useRef<HTMLDivElement>(null);

  const busy = stage === "writing" || stage === "critiquing" || stage === "editing";

  function applyUsage(d: Usage) {
    if (d?.usage?.total_tokens) setArticleTokens((t) => t + d.usage!.total_tokens!);
    if (typeof d?.total_tokens_all_time === "number") setTotalTokens(d.total_tokens_all_time);
  }

  // critic → editor on a single draft. Shared by first pass and refine pass.
  async function reviewAndEdit(mode: Phase, draft: string): Promise<{ critique: Critique; edited: string }> {
    setStage("critiquing");
    const c = await post<{ critiques: Critique[] }>("/api/critic", { drafts: [draft], mode });
    applyUsage(c);
    const critique = c.critiques[0] ?? { annotated: "", issues: [] };

    setStage("editing");
    const e = await post<{ edited: string[] }>("/api/editor", {
      drafts: [draft],
      critiques: [critique],
      mode,
    });
    applyUsage(e);
    return { critique, edited: e.edited[0] ?? draft };
  }

  // writer → critic → editor for one phase
  async function pipeline(mode: Phase, writerBody: unknown, set: (p: Pipe) => void) {
    setStage("writing");
    const w = await post<{ drafts: string[] }>("/api/writer", writerBody);
    applyUsage(w);
    const draft = w.drafts[0] ?? "";
    set({ ...emptyPipe, draft });

    const { critique, edited } = await reviewAndEdit(mode, draft);
    set({ draft, critique, edited, refined: false });
    setStage("done");
  }

  // one allowed refine pass: re-critique the edited text, edit again
  async function refine(mode: Phase, pipe: Pipe, set: (p: Pipe) => void) {
    if (pipe.refined || busy || !pipe.edited) return;
    setError("");
    setPhase(mode);
    try {
      const { critique, edited } = await reviewAndEdit(mode, pipe.edited);
      set({ draft: pipe.draft, critique, edited, refined: true });
      setStage("done");
    } catch (err: any) {
      setError(err.message ?? "Something broke");
      setStage("idle");
    }
  }

  async function runOutline() {
    if (!topic.trim() || busy) return;
    setError("");
    setPhase("outline");
    setOutline(emptyPipe);
    setBlog(emptyPipe);
    setArticleTokens(0); // new article — reset its counter
    try {
      await pipeline("outline", { topic, mode: "outline" }, setOutline);
    } catch (err: any) {
      setError(err.message ?? "Something broke");
      setStage("idle");
    }
  }

  async function runBlog() {
    if (!outline.edited || busy) return;
    setError("");
    setPhase("blog");
    setBlog(emptyPipe);
    try {
      await pipeline("blog", { topic, mode: "blog", outline: outline.edited }, setBlog);
    } catch (err: any) {
      setError(err.message ?? "Something broke");
      setStage("idle");
    }
  }

  const outlineReady = outline.edited.length > 0;
  // can move to blog once the outline is done and we're not mid-run
  const showContinue = phase === "outline" && stage === "done" && outlineReady;

  // after the outline is ready, scroll the "continue" button into view
  useEffect(() => {
    if (showContinue) {
      continueRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [showContinue]);

  // progress line: shown at top during the outline phase, but moved to the bottom
  // (below the outline, above the blog) during the blog phase
  const progress = (busy || stage === "done") && (
    <div className="mt-4 font-mono text-sm text-neutral-600">
      <span className={busy ? "animate-pulse" : ""}>
        {phase === "outline" ? "Outline · " : "Blog · "}
        {STAGE_VERB[stage]}
      </span>
    </div>
  );

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">
          write<span className="text-accent">·</span>me<span className="text-accent">·</span>it
        </h1>
        <p className="mt-1 text-neutral-500">
          Turn a topic into a polished blog post through a writer → critic → editor pipeline.
        </p>
        <TokenBar article={articleTokens} total={totalTokens} />
      </header>

      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && runOutline()}
          placeholder="Enter a blog topic…"
          className="flex-1 rounded-lg border border-neutral-300 bg-white px-4 py-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
        <button
          onClick={runOutline}
          disabled={busy}
          className="rounded-lg bg-accent px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Working…" : "Generate outline"}
        </button>
      </div>

      {/* outline-phase progress stays at the top (good signal for the outline) */}
      {phase === "outline" && progress}
      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* ---- Outline phase ---- */}
      {outlineReady && (
        <>
          <PhaseHeading n={1} label="Outline — review it" />
          <ResultCard
            label="Outline"
            pipe={outline}
            busy={busy}
            onRefine={() => refine("outline", outline, setOutline)}
          />
        </>
      )}

      {showContinue && (
        <div ref={continueRef} className="mt-6 flex justify-center">
          <button
            onClick={runBlog}
            className="rounded-lg bg-accent px-8 py-3 text-sm font-semibold text-white transition hover:opacity-90"
          >
            Continue → write the blog from this outline
          </button>
        </div>
      )}

      {/* blog-phase progress moves to the bottom: below the outline, above the blog */}
      {phase === "blog" && progress}

      {/* ---- Blog phase ---- */}
      {blog.edited.length > 0 && (
        <>
          <PhaseHeading n={2} label="Blog — your draft" />
          <ResultCard
            label="Blog"
            pipe={blog}
            busy={busy}
            onRefine={() => refine("blog", blog, setBlog)}
            showExport
          />
        </>
      )}
    </main>
  );
}

function TokenBar({ article, total }: { article: number; total: number }) {
  return (
    <div className="mt-4 flex flex-wrap gap-3 font-mono text-xs">
      <span className="rounded-md bg-accent/10 px-3 py-1.5 text-accent">
        This article: {article.toLocaleString()} tokens
      </span>
      <span className="rounded-md bg-neutral-100 px-3 py-1.5 text-neutral-600">
        Total (all articles): {total.toLocaleString()} tokens
      </span>
    </div>
  );
}

function PhaseHeading({ n, label }: { n: number; label: string }) {
  return (
    <h2 className="mt-10 mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-neutral-500">
      <span className="grid h-6 w-6 place-items-center rounded-full bg-accent text-xs text-white">
        {n}
      </span>
      {label}
    </h2>
  );
}

function ResultCard({
  label,
  pipe,
  busy,
  onRefine,
  showExport,
}: {
  label: string;
  pipe: Pipe;
  busy: boolean;
  onRefine: () => void;
  showExport?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const finalRef = useRef<HTMLDivElement>(null);

  async function copy() {
    if (!pipe.edited) return;
    await navigator.clipboard.writeText(pipe.edited);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function downloadPdf() {
    if (!finalRef.current) return;
    const html2pdf = (await import("html2pdf.js")).default;
    await html2pdf()
      .set({
        margin: 12,
        filename: `${label.toLowerCase()}.pdf`,
        html2canvas: { scale: 2 },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      })
      .from(finalRef.current)
      .save();
  }

  return (
    <article className="flex flex-col rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      {pipe.draft && (
        <Section title="✍️ First draft" defaultOpen={false}>
          <Markdown text={pipe.draft} />
        </Section>
      )}

      {pipe.critique && (
        <Section title="🔴 Critique" defaultOpen={false}>
          <Redline text={pipe.critique.annotated || pipe.draft} />
          {pipe.critique.issues.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 font-mono text-xs text-red-600">
              {pipe.critique.issues.map((iss, k) => (
                <li key={k}>{iss}</li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {pipe.edited && (
        <Section title="✅ Final" defaultOpen>
          <div ref={finalRef}>
            <Markdown text={pipe.edited} />
          </div>
        </Section>
      )}

      {/* actions: refine (once) + export */}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-neutral-100 pt-3">
        <button
          onClick={onRefine}
          disabled={busy || pipe.refined}
          title={pipe.refined ? "Refine limit reached (1 per phase)" : ""}
          className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-600 transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pipe.refined ? "✓ Refined (limit reached)" : "↻ Refine more"}
        </button>

        {showExport && (
          <>
            <button
              onClick={copy}
              className="rounded-md border border-neutral-300 px-3 py-2 text-xs font-medium text-neutral-600 hover:border-accent hover:text-accent"
            >
              {copied ? "Copied ✓" : "Copy final"}
            </button>
            <button
              onClick={downloadPdf}
              className="rounded-md border border-neutral-300 px-3 py-2 text-xs font-medium text-neutral-600 hover:border-accent hover:text-accent"
            >
              ⬇ Download PDF
            </button>
          </>
        )}
      </div>
    </article>
  );
}

function Section({
  title,
  defaultOpen,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="border-t border-neutral-100 py-2 first:border-t-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between py-1 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500"
      >
        {title}
        <span className="text-neutral-400">{open ? "−" : "+"}</span>
      </button>
      {open && <div className="pt-1">{children}</div>}
    </div>
  );
}
