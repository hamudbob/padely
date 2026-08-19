import { Lang } from "../about/aboutContent";

/**
 * The user-facing half of the error catalogue.
 *
 * src/lib/errors.ts holds the OPERATOR's version — "check auth.users for
 * deleted_at", "open the account in the admin console". That is the right
 * text for the admin console and completely the wrong text for a player
 * standing on a court holding a red message.
 *
 * So each code gets a second description here, written for them: what
 * happened, in their own language, and the one thing worth trying. Two
 * sentences, no jargon, no blame. If there's genuinely nothing they can do,
 * it says so — that's more useful than inventing a step.
 *
 * Codes with no entry here (anything PLR-U-…, and any curated code added
 * without user copy) fall back to FAMILIES, keyed by the first digit. That
 * fallback is why an uncatalogued failure still lands on a page that tells
 * the person something true.
 */

export interface UserHelp {
  what: Record<Lang, string>;
  do: Record<Lang, string>;
}

/** Guidance for a whole family — the fallback, and the section intro. */
export const FAMILIES: Record<string, { title: Record<Lang, string>; what: Record<Lang, string>; do: Record<Lang, string> }> = {
  "1": {
    title: { en: "Signing in", id: "Masuk ke akun" },
    what: {
      en: "Something about your account or your session, rather than the game itself.",
      id: "Sesuatu tentang akunmu atau sesimu, bukan tentang permainannya.",
    },
    do: {
      en: "Signing out and back in fixes most of these. If it keeps happening, send us the code.",
      id: "Keluar lalu masuk lagi biasanya menyelesaikan ini. Kalau terus terjadi, kirimkan kodenya ke kami.",
    },
  },
  "2": {
    title: { en: "Your profile and history", id: "Profil dan riwayatmu" },
    what: {
      en: "Your own data — your sessions, your record, your rating — couldn't be read.",
      id: "Datamu sendiri — sesi, rekor, dan ratingmu — tidak bisa dibaca.",
    },
    do: {
      en: "Pull down to reload. If the screen is still empty afterwards, send us the code: this kind usually needs fixing at our end.",
      id: "Tarik ke bawah untuk memuat ulang. Kalau layarnya masih kosong, kirimkan kodenya: jenis ini biasanya harus kami perbaiki dari sisi kami.",
    },
  },
  "3": {
    title: { en: "A session in progress", id: "Sesi yang sedang berjalan" },
    what: {
      en: "Something in the live session — a score, a round, or ending it — didn't go through.",
      id: "Sesuatu di sesi yang sedang berjalan — skor, ronde, atau mengakhiri sesi — tidak berhasil.",
    },
    do: {
      en: "Nothing you entered is lost. Try again in a moment; scores sync on their own once there's signal.",
      id: "Tidak ada yang kamu masukkan hilang. Coba lagi sebentar; skor akan tersinkron sendiri begitu ada sinyal.",
    },
  },
  "4": {
    title: { en: "Clubs and the league", id: "Klub dan liga" },
    what: {
      en: "A club page, its members, or the league table couldn't be loaded or changed.",
      id: "Halaman klub, anggotanya, atau tabel liga tidak bisa dimuat atau diubah.",
    },
    do: {
      en: "Check with the club owner that you're still a member, then reload. If you are, send us the code.",
      id: "Pastikan ke pemilik klub bahwa kamu masih anggota, lalu muat ulang. Kalau iya, kirimkan kodenya ke kami.",
    },
  },
  "5": {
    title: { en: "Joining a session", id: "Bergabung ke sesi" },
    what: {
      en: "A join code, a request to join, or claiming your spot didn't work.",
      id: "Kode gabung, permintaan bergabung, atau mengambil tempatmu tidak berhasil.",
    },
    do: {
      en: "Ask the host to read the code out again — codes belong to one session and stop working when it ends.",
      id: "Minta host membacakan kodenya lagi — kode hanya berlaku untuk satu sesi dan berhenti bekerja saat sesi selesai.",
    },
  },
  "6": {
    title: { en: "Something on your phone", id: "Sesuatu di ponselmu" },
    what: {
      en: "Your device or browser refused something — a photo, an image, the share sheet.",
      id: "Perangkat atau browsermu menolak sesuatu — foto, gambar, atau menu berbagi.",
    },
    do: {
      en: "Nothing is wrong with your account. Try an ordinary JPEG or PNG, or the same thing in another browser.",
      id: "Tidak ada masalah dengan akunmu. Coba pakai JPEG atau PNG biasa, atau lakukan hal yang sama di browser lain.",
    },
  },
  "9": {
    title: { en: "Connection and server", id: "Koneksi dan server" },
    what: {
      en: "The request didn't reach us, or our side had a problem answering it.",
      id: "Permintaannya tidak sampai ke kami, atau sisi kami bermasalah saat menjawabnya.",
    },
    do: {
      en: "Wait a moment and try again. Scores you've already entered are safe on your phone either way.",
      id: "Tunggu sebentar lalu coba lagi. Skor yang sudah kamu masukkan tetap aman di ponselmu.",
    },
  },
};

export const USER_HELP: Record<string, UserHelp> = {
  // ── 1xxx ────────────────────────────────────────────────────────────
  "PLR-1001": {
    what: {
      en: "The email and password didn't match an account.",
      id: "Email dan kata sandi tidak cocok dengan akun mana pun.",
    },
    do: {
      en: "Check the email for typos, then use “Forgot password” — it's the quickest way to be sure.",
      id: "Periksa apakah emailnya salah ketik, lalu pakai “Lupa kata sandi” — itu cara tercepat untuk memastikan.",
    },
  },
  "PLR-1002": {
    what: {
      en: "Your account exists, but the confirmation link in your email was never opened.",
      id: "Akunmu ada, tetapi tautan konfirmasi di emailmu belum pernah dibuka.",
    },
    do: {
      en: "Look for our email — including in spam — and tap the link. Signing up again won't help until you do.",
      id: "Cari email dari kami — termasuk di folder spam — dan ketuk tautannya. Mendaftar ulang tidak akan membantu sebelum itu.",
    },
  },
  "PLR-1003": {
    what: {
      en: "You were signed in, but that sign-in is no longer valid — usually because it simply got old.",
      id: "Kamu tadi sudah masuk, tetapi sesinya tidak berlaku lagi — biasanya karena sudah kedaluwarsa.",
    },
    do: { en: "Sign out and sign in again.", id: "Keluar lalu masuk lagi." },
  },
  "PLR-1004": {
    what: {
      en: "This account has been closed.",
      id: "Akun ini sudah ditutup.",
    },
    do: {
      en: "A closed account can't be reopened, but the same email can be used to sign up fresh.",
      id: "Akun yang ditutup tidak bisa dibuka kembali, tetapi email yang sama bisa dipakai untuk mendaftar baru.",
    },
  },
  "PLR-1005": {
    what: {
      en: "This screen needs you to be signed in, and the app couldn't tell that you were.",
      id: "Layar ini butuh kamu dalam keadaan masuk, dan aplikasi tidak bisa memastikannya.",
    },
    do: { en: "Sign in and open it again.", id: "Masuk lalu buka lagi." },
  },

  // ── 2xxx ────────────────────────────────────────────────────────────
  "PLR-2001": {
    what: {
      en: "Your home screen couldn't load the sessions you've hosted or played.",
      id: "Layar utamamu tidak bisa memuat sesi yang kamu buat atau mainkan.",
    },
    do: {
      en: "Reload once. If it's still empty, send us the code — your sessions are safe, they just aren't reaching the screen.",
      id: "Muat ulang sekali. Kalau masih kosong, kirimkan kodenya — sesimu aman, hanya belum sampai ke layar.",
    },
  },
  "PLR-2002": {
    what: {
      en: "Your account has a duplicate of something it should only have one of, and the screen can't choose between them.",
      id: "Akunmu punya data ganda yang seharusnya hanya satu, dan layar tidak bisa memilih di antaranya.",
    },
    do: {
      en: "Send us the code. This one is ours to fix and takes a minute once we know it's you.",
      id: "Kirimkan kodenya ke kami. Yang ini harus kami perbaiki, dan hanya butuh semenit begitu kami tahu itu kamu.",
    },
  },
  "PLR-2003": {
    what: { en: "Your profile couldn't be read.", id: "Profilmu tidak bisa dibaca." },
    do: {
      en: "Reload. If your name and photo are still missing afterwards, send us the code.",
      id: "Muat ulang. Kalau nama dan fotomu tetap hilang, kirimkan kodenya ke kami.",
    },
  },
  "PLR-2004": {
    what: {
      en: "Your rating or your record couldn't be read.",
      id: "Rating atau rekormu tidak bisa dibaca.",
    },
    do: {
      en: "Nothing has been lost — reload, and send us the code if the numbers still look wrong.",
      id: "Tidak ada yang hilang — muat ulang, dan kirimkan kodenya kalau angkanya masih terlihat salah.",
    },
  },

  // ── 3xxx ────────────────────────────────────────────────────────────
  "PLR-3001": {
    what: {
      en: "The session couldn't be created.",
      id: "Sesi tidak bisa dibuat.",
    },
    do: {
      en: "Try once more. If the same format fails twice, pick another format to get playing and send us the code.",
      id: "Coba sekali lagi. Kalau format yang sama gagal dua kali, pilih format lain agar bisa mulai bermain dan kirimkan kodenya.",
    },
  },
  "PLR-3002": {
    what: { en: "This session couldn't be loaded.", id: "Sesi ini tidak bisa dimuat." },
    do: {
      en: "Ask the host whether it's still running — an ended session opens at its results page instead.",
      id: "Tanyakan ke host apakah sesinya masih berjalan — sesi yang sudah selesai akan terbuka di halaman hasil.",
    },
  },
  "PLR-3003": {
    what: {
      en: "A score couldn't be saved to the server.",
      id: "Skor tidak bisa disimpan ke server.",
    },
    do: {
      en: "It's still on this phone and will sync by itself. Keep playing — enter the next score as normal.",
      id: "Skornya masih ada di ponsel ini dan akan tersinkron sendiri. Lanjutkan bermain — masukkan skor berikutnya seperti biasa.",
    },
  },
  "PLR-3004": {
    what: {
      en: "The next round couldn't be drawn.",
      id: "Ronde berikutnya tidak bisa disusun.",
    },
    do: {
      en: "Make sure every match in this round has a score. If the app says it's waiting to sync, it needs a moment of signal first.",
      id: "Pastikan semua pertandingan di ronde ini sudah punya skor. Kalau aplikasi bilang sedang menunggu sinkron, ia butuh sinyal sebentar.",
    },
  },
  "PLR-3005": {
    what: {
      en: "The session couldn't be ended cleanly.",
      id: "Sesi tidak bisa diakhiri dengan bersih.",
    },
    do: {
      en: "The scores are safe. Send us the code and we'll make sure the results and ratings are recorded.",
      id: "Skornya aman. Kirimkan kodenya dan kami pastikan hasil serta ratingnya tercatat.",
    },
  },
  "PLR-3006": {
    what: {
      en: "The round couldn't be redrawn with the players currently in.",
      id: "Ronde tidak bisa diundi ulang dengan pemain yang ada sekarang.",
    },
    do: {
      en: "You usually need at least four active players and one court switched on. Add someone back in and try again.",
      id: "Biasanya butuh minimal empat pemain aktif dan satu lapangan menyala. Tambahkan pemain lagi lalu coba ulang.",
    },
  },

  // ── 4xxx ────────────────────────────────────────────────────────────
  "PLR-4001": {
    what: { en: "The club page couldn't be loaded.", id: "Halaman klub tidak bisa dimuat." },
    do: {
      en: "Reload. If it keeps failing, check with the owner that you're still a member of that club.",
      id: "Muat ulang. Kalau terus gagal, pastikan ke pemiliknya bahwa kamu masih anggota klub itu.",
    },
  },
  "PLR-4002": {
    what: {
      en: "The league table couldn't be built.",
      id: "Tabel liga tidak bisa disusun.",
    },
    do: {
      en: "An empty board can also just mean no session has counted yet this period. If sessions have been played, send us the code.",
      id: "Papan kosong bisa juga berarti belum ada sesi yang dihitung pada periode ini. Kalau sesi sudah dimainkan, kirimkan kodenya.",
    },
  },
  "PLR-4003": {
    what: {
      en: "That club action wasn't allowed.",
      id: "Tindakan klub itu tidak diizinkan.",
    },
    do: {
      en: "Only owners can change roles and remove members. Ask the club's owner to do it.",
      id: "Hanya pemilik yang bisa mengubah peran dan mengeluarkan anggota. Minta pemilik klub melakukannya.",
    },
  },

  // ── 5xxx ────────────────────────────────────────────────────────────
  "PLR-5001": {
    what: {
      en: "No live session matches that code.",
      id: "Tidak ada sesi berjalan yang cocok dengan kode itu.",
    },
    do: {
      en: "Codes are short-lived and belong to one session. Ask the host to read it out again.",
      id: "Kode berumur pendek dan hanya milik satu sesi. Minta host membacakannya lagi.",
    },
  },
  "PLR-5002": {
    what: {
      en: "Your request to join couldn't be sent.",
      id: "Permintaan bergabungmu tidak bisa dikirim.",
    },
    do: {
      en: "Try again, or ask the host to add your name directly — that always works.",
      id: "Coba lagi, atau minta host menambahkan namamu langsung — cara itu selalu berhasil.",
    },
  },
  "PLR-5003": {
    what: {
      en: "That spot couldn't be claimed for your account.",
      id: "Tempat itu tidak bisa diklaim untuk akunmu.",
    },
    do: {
      en: "Someone may already hold it, or your account may already have a place in this session. Ask the host to check the roster.",
      id: "Mungkin sudah dipegang orang lain, atau akunmu sudah punya tempat di sesi ini. Minta host memeriksa daftar pemain.",
    },
  },

  // ── 6xxx ────────────────────────────────────────────────────────────
  "PLR-6001": {
    what: {
      en: "Your browser couldn't process that picture.",
      id: "Browsermu tidak bisa memproses gambar itu.",
    },
    do: {
      en: "Try an ordinary JPEG or PNG, or a smaller photo. Nothing is wrong with your account.",
      id: "Coba JPEG atau PNG biasa, atau foto yang lebih kecil. Tidak ada masalah dengan akunmu.",
    },
  },
  "PLR-6002": {
    what: {
      en: "The recap image couldn't be drawn on this device.",
      id: "Gambar rekap tidak bisa dibuat di perangkat ini.",
    },
    do: {
      en: "The standings and results are unaffected — take a screenshot instead, or try another browser.",
      id: "Klasemen dan hasilnya tidak terpengaruh — ambil tangkapan layar saja, atau coba browser lain.",
    },
  },
  "PLR-6003": {
    what: { en: "The photo didn't finish uploading.", id: "Foto tidak selesai diunggah." },
    do: {
      en: "Check your connection and try again with a smaller image.",
      id: "Periksa koneksimu dan coba lagi dengan gambar yang lebih kecil.",
    },
  },

  // ── 9xxx ────────────────────────────────────────────────────────────
  "PLR-9001": {
    what: {
      en: "Our server had a problem answering. Nothing you did caused it.",
      id: "Server kami bermasalah saat menjawab. Bukan karena sesuatu yang kamu lakukan.",
    },
    do: {
      en: "Wait a minute and try again. If it lasts longer than that, send us the code.",
      id: "Tunggu semenit lalu coba lagi. Kalau berlangsung lebih lama, kirimkan kodenya ke kami.",
    },
  },
  "PLR-9002": {
    what: {
      en: "Too many attempts in a short time, so we've paused them briefly.",
      id: "Terlalu banyak percobaan dalam waktu singkat, jadi kami menjedanya sebentar.",
    },
    do: { en: "Wait a few minutes, then try once.", id: "Tunggu beberapa menit, lalu coba sekali." },
  },
  "PLR-9003": {
    what: {
      en: "You don't have permission for that.",
      id: "Kamu tidak punya izin untuk itu.",
    },
    do: {
      en: "If you think you should, send us the code and say what you were trying to do.",
      id: "Kalau menurutmu seharusnya boleh, kirimkan kodenya dan ceritakan apa yang sedang kamu lakukan.",
    },
  },
  "PLR-9004": {
    what: {
      en: "That already exists — the app tried to create something a second time.",
      id: "Itu sudah ada — aplikasi mencoba membuatnya untuk kedua kalinya.",
    },
    do: {
      en: "Usually harmless. Reload and check whether it worked after all before trying again.",
      id: "Biasanya tidak berbahaya. Muat ulang dan periksa apakah ternyata sudah berhasil sebelum mencoba lagi.",
    },
  },
  "PLR-9005": {
    what: {
      en: "The request never left your phone — there was no connection.",
      id: "Permintaannya tidak pernah keluar dari ponselmu — tidak ada koneksi.",
    },
    do: {
      en: "Scores you've entered are saved here and will sync on their own. Everything else needs signal.",
      id: "Skor yang sudah kamu masukkan tersimpan di sini dan akan tersinkron sendiri. Selebihnya butuh sinyal.",
    },
  },
};

export const PAGE_UI: Record<Lang, Record<string, string>> = {
  en: {
    title: "Error codes",
    intro:
      "If the app showed you a code, look it up here. The same problem always produces the same code, so quoting it tells us more in five characters than a description of the screen can.",
    search: "Type or paste the code",
    searchLabel: "Find an error code",
    noMatch: "No code matches that. Send it to us anyway — an unlisted code is still exact.",
    unlisted: "Not on this list",
    unlistedBody:
      "Codes with a U in them — like PLR-U-7A0F — are faults we haven't written up yet. They're still precise, and still worth sending.",
    whatHappened: "What happened",
    whatToDo: "What to try",
    stuckTitle: "Still stuck?",
    stuckBody:
      "Send us the code and roughly what you were doing. You don't need to explain anything technical — the code does that part.",
    stuckCta: "Email us the code",
    backHome: "Back to Padelier",
    familyHint: "Codes in this group",
  },
  id: {
    title: "Kode error",
    intro:
      "Kalau aplikasi menampilkan sebuah kode, cari artinya di sini. Masalah yang sama selalu menghasilkan kode yang sama, jadi menyebut kodenya memberi kami lebih banyak informasi dalam lima karakter dibanding deskripsi layarnya.",
    search: "Ketik atau tempel kodenya",
    searchLabel: "Cari kode error",
    noMatch: "Tidak ada kode yang cocok. Kirimkan saja ke kami — kode yang belum terdaftar tetap spesifik.",
    unlisted: "Tidak ada di daftar ini",
    unlistedBody:
      "Kode yang mengandung huruf U — seperti PLR-U-7A0F — adalah kesalahan yang belum kami tulis penjelasannya. Tetap spesifik, dan tetap layak dikirim.",
    whatHappened: "Apa yang terjadi",
    whatToDo: "Yang bisa dicoba",
    stuckTitle: "Masih bermasalah?",
    stuckBody:
      "Kirimkan kodenya dan kira-kira apa yang sedang kamu lakukan. Kamu tidak perlu menjelaskan hal teknis — kodenya sudah menjelaskan.",
    stuckCta: "Email kodenya ke kami",
    backHome: "Kembali ke Padelier",
    familyHint: "Kode dalam kelompok ini",
  },
};
