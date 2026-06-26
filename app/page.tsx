"use client";

import { useState } from "react";
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
  done: "Done — pick your winner",
};

type Pipe = {
  drafts: string[];
  critiques: Critique[];
  edited: string[];
  winner: number | null;
};

const emptyPipe: Pipe = { drafts: [], critiques: [], edited: [], winner: null };

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail ?? data.error ?? "request failed");
  return data as T;
}

export default function Home() {
  const [topic, setTopic] = useState("RAG vs Agents");
  const [phase, setPhase] = useState<Phase>("outline");
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState("");

  const [outline, setOutline] = useState<Pipe>(emptyPipe);
  const [blog, setBlog] = useState<Pipe>(emptyPipe);

  const busy = stage === "writing" || stage === "critiquing" || stage === "editing";

  // run writer → critic → editor for one phase; setter stores the growing pipe
  async function pipeline(
    writerBody: unknown,
    set: (p: Pipe) => void
  ): Promise<Pipe> {
    setStage("writing");
    const w = await post<{ drafts: string[] }>("/api/writer", writerBody);
    let p: Pipe = { ...emptyPipe, drafts: w.drafts };
    set(p);

    setStage("critiquing");
    const c = await post<{ critiques: Critique[] }>("/api/critic", { drafts: w.drafts });
    p = { ...p, critiques: c.critiques };
    set(p);

    setStage("editing");
    const e = await post<{ edited: string[] }>("/api/editor", {
      drafts: w.drafts,
      critiques: c.critiques,
    });
    p = { ...p, edited: e.edited };
    set(p);

    setStage("done");
    return p;
  }

  async function runOutline() {
    if (!topic.trim() || busy) return;
    setError("");
    setPhase("outline");
    setOutline(emptyPipe);
    setBlog(emptyPipe);
    try {
      await pipeline({ topic, mode: "outline" }, setOutline);
    } catch (err: any) {
      setError(err.message ?? "Something broke");
      setStage("idle");
    }
  }

  async function runBlog() {
    if (outline.winner === null || busy) return;
    const chosen = outline.edited[outline.winner];
    setError("");
    setPhase("blog");
    setBlog(emptyPipe);
    try {
      await pipeline({ topic, mode: "blog", outline: chosen }, setBlog);
    } catch (err: any) {
      setError(err.message ?? "Something broke");
      setStage("idle");
    }
  }

  const outlineReady = outline.edited.length > 0;
  const showContinue =
    phase === "outline" && stage === "done" && outline.winner !== null;

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">
          write<span className="text-accent">·</span>me<span className="text-accent">·</span>it
        </h1>
        <p className="mt-1 text-neutral-500">
          Outline first (2 → critic → editor → pick), then full blog (2 → critic → editor → pick).
        </p>
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
          {busy ? "Working…" : "Generate outlines"}
        </button>
      </div>

      {(busy || stage === "done") && (
        <div className="mt-4 font-mono text-sm text-neutral-600">
          <span className={busy ? "animate-pulse" : ""}>
            {phase === "outline" ? "Outline · " : "Blog · "}
            {STAGE_VERB[stage]}
          </span>
        </div>
      )}
      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* ---- Outline phase ---- */}
      {outlineReady && (
        <>
          <PhaseHeading n={1} label="Outlines — pick one to build" />
          <Grid pipe={outline} label="Outline" setWinner={(i) => setOutline({ ...outline, winner: i })} />
        </>
      )}

      {showContinue && (
        <div className="mt-6 flex justify-center">
          <button
            onClick={runBlog}
            className="rounded-lg bg-accent px-8 py-3 text-sm font-semibold text-white transition hover:opacity-90"
          >
            Continue → write 2 blogs from this outline
          </button>
        </div>
      )}

      {/* ---- Blog phase ---- */}
      {blog.drafts.length > 0 && (
        <>
          <PhaseHeading n={2} label="Blogs — pick your winner" />
          <Grid pipe={blog} label="Draft" setWinner={(i) => setBlog({ ...blog, winner: i })} />
        </>
      )}
    </main>
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

function Grid({
  pipe,
  label,
  setWinner,
}: {
  pipe: Pipe;
  label: string;
  setWinner: (i: number | null) => void;
}) {
  return (
    <section className="grid grid-cols-1 gap-5 md:grid-cols-2">
      {pipe.drafts.map((draft, i) => (
        <Card
          key={i}
          index={i}
          label={label}
          draft={draft}
          critique={pipe.critiques[i]}
          edited={pipe.edited[i]}
          isWinner={pipe.winner === i}
          dimmed={pipe.winner !== null && pipe.winner !== i}
          onPick={() => setWinner(pipe.winner === i ? null : i)}
        />
      ))}
    </section>
  );
}

function Card({
  index,
  label,
  draft,
  critique,
  edited,
  isWinner,
  dimmed,
  onPick,
}: {
  index: number;
  label: string;
  draft: string;
  critique?: Critique;
  edited?: string;
  isWinner: boolean;
  dimmed: boolean;
  onPick: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!edited) return;
    await navigator.clipboard.writeText(edited);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <article
      className={`flex flex-col rounded-2xl border bg-white p-4 shadow-sm transition ${
        isWinner ? "border-accent ring-2 ring-accent/30 md:col-span-2" : "border-neutral-200"
      } ${dimmed ? "opacity-40" : ""}`}
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-xs uppercase tracking-wider text-neutral-400">
          {label} {index + 1}
        </span>
        <button
          onClick={onPick}
          className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
            isWinner
              ? "border-accent bg-accent text-white"
              : "border-neutral-300 text-neutral-600 hover:border-accent hover:text-accent"
          }`}
        >
          {isWinner ? "★ Selected" : "Select"}
        </button>
      </div>

      <Section title={label} defaultOpen>
        <Markdown text={draft} />
      </Section>

      {critique && (
        <Section title="🔴 Critique" defaultOpen={!isWinner}>
          <Redline text={critique.annotated || draft} />
          {critique.issues.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 font-mono text-xs text-red-600">
              {critique.issues.map((iss, k) => (
                <li key={k}>{iss}</li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {edited && (
        <Section title="✅ Final" defaultOpen>
          <Markdown text={edited} />
          <button
            onClick={copy}
            className="mt-3 rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-600 hover:border-accent hover:text-accent"
          >
            {copied ? "Copied ✓" : "Copy final"}
          </button>
        </Section>
      )}
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
