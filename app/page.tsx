"use client";

import { useState } from "react";
import { Redline } from "@/components/Redline";

type Critique = { annotated: string; issues: string[] };
type Stage = "idle" | "writing" | "critiquing" | "editing" | "done";

const STAGE_LABEL: Record<Stage, string> = {
  idle: "",
  writing: "✍️  Writer is drafting…",
  critiquing: "🔴  Critic is reviewing…",
  editing: "✅  Editor is polishing…",
  done: "Done — pick your winner",
};

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "request failed");
  return data as T;
}

export default function Home() {
  const [topic, setTopic] = useState("RAG vs Agents");
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState("");

  const [drafts, setDrafts] = useState<string[]>([]);
  const [critiques, setCritiques] = useState<Critique[]>([]);
  const [edited, setEdited] = useState<string[]>([]);
  const [winner, setWinner] = useState<number | null>(null);

  const busy = stage === "writing" || stage === "critiquing" || stage === "editing";

  async function run() {
    if (!topic.trim() || busy) return;
    setError("");
    setDrafts([]);
    setCritiques([]);
    setEdited([]);
    setWinner(null);

    try {
      setStage("writing");
      const w = await post<{ drafts: string[] }>("/api/writer", { topic });
      setDrafts(w.drafts);

      setStage("critiquing");
      const c = await post<{ critiques: Critique[] }>("/api/critic", { drafts: w.drafts });
      setCritiques(c.critiques);

      setStage("editing");
      const e = await post<{ edited: string[] }>("/api/editor", {
        drafts: w.drafts,
        critiques: c.critiques,
      });
      setEdited(e.edited);

      setStage("done");
    } catch (err: any) {
      setError(err.message ?? "Something broke");
      setStage("idle");
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">
          write<span className="text-accent">·</span>me<span className="text-accent">·</span>it
        </h1>
        <p className="mt-1 text-neutral-500">
          Writer drafts 3 · Critic red-lines · Editor fixes · you pick the winner.
        </p>
      </header>

      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
          placeholder="Enter a blog topic…"
          className="flex-1 rounded-lg border border-neutral-300 bg-white px-4 py-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
        <button
          onClick={run}
          disabled={busy}
          className="rounded-lg bg-accent px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Working…" : "Generate"}
        </button>
      </div>

      {(busy || stage === "done") && (
        <div className="mt-4 font-mono text-sm text-neutral-600">
          <span className={busy ? "animate-pulse" : ""}>{STAGE_LABEL[stage]}</span>
        </div>
      )}
      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="mt-8 grid grid-cols-1 gap-5 md:grid-cols-3">
        {drafts.map((draft, i) => (
          <Card
            key={i}
            index={i}
            draft={draft}
            critique={critiques[i]}
            edited={edited[i]}
            isWinner={winner === i}
            dimmed={winner !== null && winner !== i}
            onPick={() => setWinner(winner === i ? null : i)}
          />
        ))}
      </section>
    </main>
  );
}

function Card({
  index,
  draft,
  critique,
  edited,
  isWinner,
  dimmed,
  onPick,
}: {
  index: number;
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
        isWinner ? "border-accent ring-2 ring-accent/30 md:col-span-3" : "border-neutral-200"
      } ${dimmed ? "opacity-40" : ""}`}
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-xs uppercase tracking-wider text-neutral-400">
          Draft {index + 1}
        </span>
        <button
          onClick={onPick}
          className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
            isWinner
              ? "border-accent bg-accent text-white"
              : "border-neutral-300 text-neutral-600 hover:border-accent hover:text-accent"
          }`}
        >
          {isWinner ? "★ Winner" : "Pick winner"}
        </button>
      </div>

      <Section title="Draft" defaultOpen>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-neutral-700">{draft}</p>
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
        <Section title="✅ Edited" defaultOpen>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-neutral-800">{edited}</p>
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
