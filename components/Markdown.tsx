import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Renders blog/outline markdown (headings, lists, bold, etc.) with Tailwind styling.
// No typography plugin — each element gets explicit classes via the components map.
export function Markdown({ text }: { text: string }) {
  return (
    <div className="text-sm leading-relaxed text-neutral-800">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (p) => <h1 className="mt-4 mb-2 text-lg font-bold text-neutral-900" {...p} />,
          h2: (p) => <h2 className="mt-4 mb-2 text-base font-bold text-neutral-900" {...p} />,
          h3: (p) => <h3 className="mt-3 mb-1.5 text-sm font-semibold text-neutral-900" {...p} />,
          p: (p) => <p className="mb-3" {...p} />,
          ul: (p) => <ul className="mb-3 list-disc space-y-1 pl-5" {...p} />,
          ol: (p) => <ol className="mb-3 list-decimal space-y-1 pl-5" {...p} />,
          li: (p) => <li className="leading-relaxed" {...p} />,
          strong: (p) => <strong className="font-semibold text-neutral-900" {...p} />,
          em: (p) => <em className="italic" {...p} />,
          a: (p) => <a className="text-accent underline" {...p} />,
          blockquote: (p) => (
            <blockquote className="mb-3 border-l-2 border-neutral-300 pl-3 italic text-neutral-600" {...p} />
          ),
          code: (p) => <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-xs" {...p} />,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
