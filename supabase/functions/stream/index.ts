import { admin, cors, TG, verifyStream } from "../_shared/util.ts";

const INLINE = /^(image\/(png|jpe?g|gif|webp|avif)|video\/(mp4|webm|ogg)|audio\/|application\/pdf$)/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const fileId = await verifyStream(new URL(req.url).searchParams.get("s") ?? "");
  if (!fileId) return new Response("Forbidden", { status: 403, headers: cors });
  const { data: f } = await admin.from("files").select("name,mime,tg_file_id").eq("id", fileId).maybeSingle();
  if (!f) return new Response("Not found", { status: 404, headers: cors });

  const info = await (await fetch(`${TG}/getFile?file_id=${encodeURIComponent(f.tg_file_id)}`)).json();
  if (!info.ok) return new Response("Storage unavailable", { status: 502, headers: cors });

  // The bot token only ever appears in this server-to-Telegram request.
  const range = req.headers.get("range");
  const up = await fetch(`https://api.telegram.org/file/bot${Deno.env.get("TELEGRAM_BOT_TOKEN")}/${info.result.file_path}`,
    { headers: range ? { Range: range } : {} });

  const h = new Headers(cors);
  for (const k of ["content-length", "content-range", "accept-ranges"]) up.headers.get(k) && h.set(k, up.headers.get(k)!);
  const safe = INLINE.test(f.mime);
  h.set("Content-Type", safe ? f.mime : "application/octet-stream");
  h.set("Content-Disposition", `${safe ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(f.name)}`);
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Content-Security-Policy", "sandbox");
  h.set("Cache-Control", "private, no-store");
  return new Response(up.body, { status: up.status, headers: h });
});
