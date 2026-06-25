import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "write-me-it — multi-agent blog pipeline",
  description: "Writer drafts. Critic red-lines. Editor fixes. You pick the winner.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
