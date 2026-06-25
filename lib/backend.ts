// Proxy helper — forwards a request body to the Python FastAPI backend.
export const BACKEND_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";

export async function proxy(path: string, body: unknown) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const text = await res.text();
  return { status: res.status, text };
}
