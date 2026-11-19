# MY OWN AI — Vercel + Pterodactyl

Proyek ini dipisah menjadi dua bagian:
- **Vercel** menyajikan frontend statis dari folder `public/`.
- **Pterodactyl** menjalankan backend Node.js (`server.js`) dan `llama.cpp` beserta model GGUF.

Vercel tidak menjalankan model GGUF/llama.cpp. Model tetap berjalan di server Pterodactyl milikmu.

## A. Deploy frontend ke Vercel

1. Upload seluruh isi ZIP ini ke satu repository GitHub. Jangan hanya upload folder `public`; backend juga perlu disimpan di repository untuk deployment Pterodactyl.
2. Di Vercel pilih **Add New → Project**, lalu import repository GitHub tersebut.
3. Framework Preset: **Other**. Build Command: kosongkan / None. Output Directory: `public`. Install Command: kosongkan.
4. Deploy. Vercel akan memberikan URL seperti `https://nama-project.vercel.app`.
5. Buka file `public/config.js` di GitHub, lalu ganti URL placeholder dengan URL HTTPS backend Pterodactyl kamu. Contoh: `window.MY_OWN_AI_API = \"https://api.domainkamu.com\";`
6. Commit perubahan. Vercel akan melakukan redeploy otomatis.

## B. Jalankan backend di Pterodactyl

1. Buat server Node.js di Pterodactyl (Node.js 20 atau lebih baru).
2. Upload repository ini ke server Pterodactyl, atau upload ZIP lalu extract.
3. Pastikan `package.json`, `server.js`, folder `ai/`, dan folder `database/` berada di root server.
4. Install dependency dengan `npm install`.
5. Salin `.env.example` menjadi `.env`, lalu isi setidaknya:

```env
PORT=PORT_ALLOCATION_PTERODACTYL
HOST=0.0.0.0
LLAMA_BASE_URL=http://127.0.0.1:8081/v1
LLAMA_MODEL=local-model
LLAMA_API_KEY=local-only
FRONTEND_ORIGIN=https://nama-project.vercel.app
DATA_DIR=./database
SYSTEM_PROMPT_FILE=./ai/system-prompt.txt
```

Ganti `PORT_ALLOCATION_PTERODACTYL` dengan port Allocation server Pterodactyl. `FRONTEND_ORIGIN` harus sama persis dengan URL Vercel (tanpa slash di akhir).
6. Startup command backend: `npm start`.
7. Jalankan `llama-server` secara terpisah di server yang sama, pada port internal 8081, dengan model GGUF yang sudah kamu siapkan. Contoh umum:

```bash
./llama-server -m ./models/model.gguf --host 127.0.0.1 --port 8081 -c 8192 -t 16
```

Perintah ini hanya contoh. Sesuaikan lokasi binary, file model, RAM, CPU, dan dukungan container. Jangan jalankan dua proses yang sama-sama memakai port backend.

## C. HTTPS backend wajib untuk browser Vercel

Karena frontend Vercel memakai HTTPS, URL backend juga harus HTTPS agar browser tidak memblokir koneksi (mixed content). Jika alamat Allocation Pterodactyl kamu hanya HTTP, pasang domain/subdomain HTTPS atau HTTPS reverse proxy/tunnel yang kamu kendalikan. Jangan isi `config.js` dengan `127.0.0.1`, `localhost`, atau URL internal `http://...` untuk deployment publik.

## D. Tes koneksi

Buka URL berikut di browser:

```text
https://URL-BACKEND-KAMU/api/health
```

Jika backend dapat dijangkau, endpoint akan memberi status JSON. `inference: disconnected` berarti backend Node.js hidup tetapi `llama-server` belum tersambung. Setelah itu buka URL Vercel dan coba kirim pesan.

## Catatan penting

- File `public/config.js` adalah tempat mengatur alamat backend yang dipakai frontend.
- Jangan menaruh API key rahasia di `public/config.js`; file frontend bisa dilihat pengunjung. `LLAMA_API_KEY` tetap disimpan di `.env` backend.
- Starter ini belum memiliki login/autentikasi pengguna. Jangan membuka backend ke publik tanpa menambahkan autentikasi dan pembatasan akses yang sesuai. CORS hanya mengatur akses browser, bukan pengganti autentikasi.
- Riwayat chat disimpan di `database/chats.json` pada Pterodactyl. Pastikan folder tersebut persisten dan backup secara berkala.
- Belum ada klaim bahwa model atau konfigurasi sudah diuji di server Pterodactyl milikmu; uji setelah deploy.
