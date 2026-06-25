import { proxy } from "@/lib/backend";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json();
  const { status, text } = await proxy("/editor", body);
  return new Response(text, {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
