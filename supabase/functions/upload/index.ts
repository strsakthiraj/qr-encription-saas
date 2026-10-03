import { admin, authUser, cors, json, TG } from "../_shared/util.ts";
const MAX = 20 * 1024 * 1024; // Telegram Bot API getFile download limit

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const user = await authUser(req);
  if (!user) return json({ error: "Sign in required" }, 401);
  const f = (await req.formData()).get("file");
  if (!(f instanceof File)) return json({ error: "Attach a file" }, 400);
  if (f.size > MAX) return json({ error: "File is larger than 20 MB" }, 413);

  const fd = new FormData();
  fd.append("chat_id", Deno.env.get("TELEGRAM_CHANNEL_ID")!);
  fd.append("document", f, f.name);
  const t = await (await fetch(`${TG}/sendDocument`, { method: "POST", body: fd })).json();
  if (!t.ok) return json({ error: "Storage upload failed" }, 502);

  const { data, error } = await admin.from("files").insert({
    owner_id: user.id, name: f.name.slice(0, 200), mime: f.type || "application/octet-stream", size: f.size,
    tg_file_id: t.result.document.file_id, tg_message_id: t.result.message_id,
  }).select("id,name,mime,size,created_at").single();
  return error ? json({ error: "Could not save file" }, 500) : json(data);
});
