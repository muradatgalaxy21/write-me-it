import React from "react";

// Renders critic-annotated text: ~~struck~~ -> <del>, {{note}} -> red margin note.
export function Redline({ text }: { text: string }) {
  const nodes: React.ReactNode[] = [];
  // tokenize on ~~...~~ and {{...}}
  const regex = /~~(.+?)~~|\{\{(.+?)\}\}/g;
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) nodes.push(<span key={key++}>{text.slice(last, m.index)}</span>);
    if (m[1] !== undefined) {
      nodes.push(<del key={key++}>{m[1]}</del>);
    } else if (m[2] !== undefined) {
      nodes.push(
        <span key={key++} className="note">
          ✎ {m[2]}
        </span>
      );
    }
    last = regex.lastIndex;
  }
  if (last < text.length) nodes.push(<span key={key++}>{text.slice(last)}</span>);

  return <p className="redline whitespace-pre-wrap leading-relaxed text-sm">{nodes}</p>;
}
