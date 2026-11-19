require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const LLAMA_BASE_URL = (process.env.LLAMA_BASE_URL || "http://127.0.0.1:8081/v1").replace(/\/+$/, "");
const LLAMA_MODEL = process.env.LLAMA_MODEL || "local-model";
const LLAMA_API_KEY = process.env.LLAMA_API_KEY || "local-only";
const TIMEOUT_MS = Number(process.env.LLAMA_TIMEOUT_MS || 180000);
const DATA_DIR = path.resolve(process.env.DATA_DIR || "./database");
const HISTORY_FILE = path.join(DATA_DIR, "chats.json");
const PROMPT_FILE = path.resolve(process.env.SYSTEM_PROMPT_FILE || "./ai/system-prompt.txt");

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(HISTORY_FILE)) fs.writeFileSync(HISTORY_FILE, "[]", "utf8");

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "1mb" }));

// Allow the Vercel frontend to call this Pterodactyl backend.
// Set FRONTEND_ORIGIN to the exact deployed Vercel URL (comma-separated for previews if needed).
const allowedOrigins = (process.env.FRONTEND_ORIGIN || "")
  .split(",").map(value => value.trim()).filter(Boolean);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use("/api", rateLimit({ windowMs: 60_000, limit: 45, standardHeaders: true, legacyHeaders: false }));
app.use(express.static(path.join(__dirname, "public")));

function readChats() {
  try {
    const parsed = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function writeChats(chats) {
  const tmp = HISTORY_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(chats, null, 2), "utf8");
  fs.renameSync(tmp, HISTORY_FILE);
}
function readSystemPrompt() {
  try { return fs.readFileSync(PROMPT_FILE, "utf8").trim(); }
  catch { return "Kamu adalah asisten AI yang ramah, jujur, dan membantu."; }
}
function validId(id) {
  return typeof id === "string" && /^[a-f0-9-]{12,64}$/i.test(id);
}
function getChat(id) {
  return readChats().find(c => c.id === id);
}
function safeTitle(text) {
  return String(text || "Percakapan baru").replace(/\s+/g, " ").slice(0, 55);
}

app.get("/api/health", async (_req, res) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const r = await fetch(`${LLAMA_BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${LLAMA_API_KEY}` },
      signal: controller.signal
    });
    res.json({ ok: r.ok, backend: "node", inference: r.ok ? "connected" : "unavailable", model: LLAMA_MODEL });
  } catch {
    res.status(503).json({ ok: false, backend: "node", inference: "disconnected", model: LLAMA_MODEL });
  } finally { clearTimeout(timer); }
});

app.get("/api/chats", (_req, res) => {
  const chats = readChats().map(({ id, title, updatedAt, messages }) => ({
    id, title, updatedAt, messageCount: messages.length
  })).sort((a, b) => b.updatedAt - a.updatedAt);
  res.json({ chats });
});

app.post("/api/chats", (_req, res) => {
  const chats = readChats();
  const chat = { id: crypto.randomUUID(), title: "Percakapan baru", createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
  chats.push(chat);
  writeChats(chats);
  res.status(201).json({ chat: { id: chat.id, title: chat.title, updatedAt: chat.updatedAt } });
});

app.get("/api/chats/:id", (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: "ID percakapan tidak valid." });
  const chat = getChat(req.params.id);
  if (!chat) return res.status(404).json({ error: "Percakapan tidak ditemukan." });
  res.json({ chat });
});

app.delete("/api/chats/:id", (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: "ID percakapan tidak valid." });
  const chats = readChats();
  const next = chats.filter(c => c.id !== req.params.id);
  if (next.length === chats.length) return res.status(404).json({ error: "Percakapan tidak ditemukan." });
  writeChats(next);
  res.json({ ok: true });
});

app.post("/api/chats/:id/messages", async (req, res) => {
  const id = req.params.id;
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  if (!validId(id)) return res.status(400).json({ error: "ID percakapan tidak valid." });
  if (!message || message.length > 12000) return res.status(400).json({ error: "Pesan wajib diisi (maksimal 12.000 karakter)." });

  const chats = readChats();
  const chat = chats.find(c => c.id === id);
  if (!chat) return res.status(404).json({ error: "Percakapan tidak ditemukan." });

  const userMessage = { role: "user", content: message };
  const history = chat.messages.slice(-20).map(m => ({ role: m.role, content: m.content }));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = data => res.write(`data: ${JSON.stringify(data)}\n\n`);
  let assistantText = "";

  try {
    const upstream = await fetch(`${LLAMA_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LLAMA_API_KEY}`
      },
      body: JSON.stringify({
        model: LLAMA_MODEL,
        messages: [
          { role: "system", content: readSystemPrompt() },
          ...history,
          userMessage
        ],
        temperature: Number(req.body.temperature ?? process.env.DEFAULT_TEMPERATURE ?? 0.7),
        max_tokens: Math.min(4096, Math.max(64, Number(req.body.max_tokens ?? process.env.DEFAULT_MAX_TOKENS ?? 1024))),
        stream: true
      }),
      signal: controller.signal
    });

    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => "");
      send({ error: `Inference server error (${upstream.status}): ${detail.slice(0, 500)}` });
      return res.end();
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const parsed = JSON.parse(payload);
          const token = parsed.choices?.[0]?.delta?.content;
          if (typeof token === "string" && token) {
            assistantText += token;
            send({ token });
          }
        } catch { /* Ignore incomplete or non-JSON SSE lines. */ }
      }
    }

    if (assistantText.trim()) {
      const fresh = readChats();
      const target = fresh.find(c => c.id === id);
      if (target) {
        target.messages.push(userMessage, { role: "assistant", content: assistantText });
        if (target.messages.length === 2) target.title = safeTitle(message);
        target.updatedAt = Date.now();
        writeChats(fresh);
      }
    }
    send({ done: true });
    res.end();
  } catch (error) {
    if (!res.headersSent) res.status(502);
    send({ error: error.name === "AbortError" ? "Model terlalu lama merespons (timeout)." : "Tidak dapat terhubung ke inference server lokal." });
    res.end();
  } finally {
    clearTimeout(timer);
  }
});

app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, HOST, () => {
  console.log(`[MY OWN AI] Web berjalan di http://${HOST}:${PORT}`);
  console.log(`[MY OWN AI] Inference URL: ${LLAMA_BASE_URL}`);
  console.log("[MY OWN AI] Pastikan llama-server sudah berjalan sebelum mengirim chat.");
});
