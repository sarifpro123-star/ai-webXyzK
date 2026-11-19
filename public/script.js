const $ = s => document.querySelector(s);
const API_BASE = String(window.MY_OWN_AI_API || "").replace(/\/+$/, "");
const apiUrl = path => `${API_BASE}${path}`;
const chatList = $("#chatList"), messagesEl = $("#messages"), welcome = $("#welcome");
let currentChat = null, busy = false;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}
function addMessage(role, content = "") {
  welcome.style.display = "none";
  const el = document.createElement("div");
  el.className = `message ${role}`;
  el.innerHTML = `<div class="avatar">${role === "user" ? "U" : "✳"}</div><div class="bubble"></div>`;
  el.querySelector(".bubble").textContent = content;
  messagesEl.appendChild(el);
  el.scrollIntoView({ behavior: "smooth", block: "end" });
  return el.querySelector(".bubble");
}
async function api(url, options = {}) {
  const r = await fetch(apiUrl(url), { ...options, headers: { "Content-Type":"application/json", ...(options.headers || {}) } });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}
async function refreshChats() {
  const { chats } = await api("/api/chats");
  chatList.innerHTML = "";
  if (!chats.length) chatList.innerHTML = '<div class="empty">Belum ada percakapan</div>';
  chats.forEach(chat => {
    const b = document.createElement("button");
    b.className = "chat-item" + (chat.id === currentChat ? " active" : "");
    b.textContent = chat.title;
    b.title = "Klik untuk membuka";
    b.onclick = () => openChat(chat.id);
    chatList.appendChild(b);
  });
}
async function newChat() {
  const { chat } = await api("/api/chats", { method:"POST", body:"{}" });
  currentChat = chat.id;
  messagesEl.innerHTML = "";
  welcome.style.display = "";
  await refreshChats();
  $("#messageInput").focus();
}
async function openChat(id) {
  const { chat } = await api(`/api/chats/${id}`);
  currentChat = id;
  messagesEl.innerHTML = "";
  welcome.style.display = chat.messages.length ? "none" : "";
  chat.messages.forEach(m => addMessage(m.role, m.content));
  await refreshChats();
  $("#sidebar").classList.remove("open");
}
async function sendMessage(text) {
  if (busy || !text.trim()) return;
  if (!currentChat) await newChat();
  busy = true;
  $("#sendBtn").disabled = true;
  addMessage("user", text);
  const bubble = addMessage("assistant", "");
  bubble.innerHTML = '<span class="typing">AI sedang berpikir...</span>';
  try {
    const response = await fetch(apiUrl(`/api/chats/${currentChat}/messages`), {
      method:"POST", headers:{ "Content-Type":"application/json" },
      body:JSON.stringify({ message:text })
    });
    if (!response.ok || !response.body) {
      const e = await response.json().catch(() => ({}));
      throw new Error(e.error || "Gagal menghubungi AI.");
    }
    bubble.textContent = "";
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream:true });
      const chunks = buffer.split("\n\n"); buffer = chunks.pop() || "";
      for (const chunk of chunks) {
        const line = chunk.split("\n").find(x => x.startsWith("data:"));
        if (!line) continue;
        const payload = JSON.parse(line.slice(5).trim());
        if (payload.token) bubble.textContent += payload.token;
        if (payload.error) throw new Error(payload.error);
        bubble.scrollIntoView({ behavior:"smooth", block:"end" });
      }
    }
    if (!bubble.textContent.trim()) bubble.textContent = "Model tidak mengirim jawaban.";
    await refreshChats();
  } catch (e) {
    bubble.classList.add("error");
    bubble.textContent = `Error: ${e.message}`;
  } finally {
    busy = false;
    $("#sendBtn").disabled = false;
    $("#messageInput").focus();
  }
}
$("#newChat").addEventListener("click", () => newChat().catch(e => alert(e.message)));
$("#chatForm").addEventListener("submit", e => {
  e.preventDefault();
  const input = $("#messageInput"), text = input.value.trim();
  if (!text) return;
  input.value = ""; input.style.height = "auto";
  sendMessage(text);
});
$("#messageInput").addEventListener("input", e => {
  e.target.style.height = "auto";
  e.target.style.height = Math.min(e.target.scrollHeight, 180) + "px";
});
document.querySelectorAll("[data-prompt]").forEach(b => b.addEventListener("click", () => {
  $("#messageInput").value = b.dataset.prompt;
  $("#chatForm").requestSubmit();
}));
$("#menuBtn").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
async function checkHealth() {
  try {
    const data = await api("/api/health");
    $("#engineStatus").textContent = data.inference === "connected" ? "Engine terhubung" : "Engine bermasalah";
    $("#modelName").textContent = data.model;
    $("#pulse").classList.toggle("online", data.inference === "connected");
  } catch {
    $("#engineStatus").textContent = "Engine offline";
    $("#modelName").textContent = "Periksa llama-server";
    $("#pulse").classList.remove("online");
  }
}
(async function init() {
  try { await refreshChats(); } catch {}
  await checkHealth();
  setInterval(checkHealth, 15000);
})();
