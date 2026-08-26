/**
 * The privacy policy and the terms, in both languages.
 *
 * Content lives here, away from the component, for the same reason the About
 * page works that way: legal text gets revised on its own schedule and by
 * reading rather than by looking, and it shouldn't require touching JSX.
 *
 * Two rules this file follows, both of which matter more than they look:
 *
 * 1. **Bahasa Indonesia is the operative version.** UU 27/2022 requires the
 *    notice to be understandable to the person it's about, and the users are
 *    Indonesian. English is a courtesy translation and says so.
 *
 * 2. **Every sentence describes what the code actually does.** A policy that
 *    claims a deletion, a retention period or a recipient that isn't real is
 *    worse than no policy — it converts a gap into a false statement. When the
 *    app changes, this file changes in the same commit.
 *
 * The structure mirrors Art. 21 UU PDP: legal basis, purpose, types of data and
 * their relevance, retention, detail of what's collected, duration, and rights —
 * plus recipients, cross-border transfer and the withdrawal route, which come
 * from Arts. 9, 14 and 56.
 */

export type Lang = "en" | "id";
export type Bi = { en: string; id: string };

/** A term/definition pair — "Display name — shown on lineups…". */
export type Item = { t: Bi; d: Bi };

export type Section = {
  /** Stable anchor, so the app can deep-link to a single clause. */
  key: string;
  title: Bi;
  body?: Bi[];
  items?: Item[];
};

export type Doc = {
  title: Bi;
  updated: Bi;
  intro: Bi[];
  sections: Section[];
};

export const CONTACT_EMAIL = "info@padelier.id";

/** Shown at the top of both documents and in the UI chrome. */
export const LEGAL_UI = {
  en: {
    other: "Bahasa Indonesia",
    updatedLabel: "Last updated",
    note:
      "This English version is provided for convenience. The Indonesian version is the one that governs.",
    contactHeading: "Questions, or want your data?",
    contactBody: "Write to us and we'll answer. One person reads this inbox.",
    seePrivacy: "Privacy policy",
    seeTerms: "Terms of use",
  },
  id: {
    other: "English",
    updatedLabel: "Terakhir diperbarui",
    note:
      "Versi Bahasa Indonesia inilah yang berlaku. Versi Inggris hanya terjemahan untuk memudahkan.",
    contactHeading: "Ada pertanyaan, atau ingin data Anda?",
    contactBody: "Kirim email kepada kami dan akan kami jawab. Kotak masuk ini dibaca satu orang.",
    seePrivacy: "Kebijakan Privasi",
    seeTerms: "Ketentuan Penggunaan",
  },
} as const;

const UPDATED: Bi = { en: "13 August 2026", id: "13 Agustus 2026" };

// ─────────────────────────────────────────────────────────────────────────────
// Account deletion — the public page
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Google Play requires a page anyone can reach WITHOUT the app, explaining how
 * to delete an account and what happens to the data. That last part is the
 * point: the deletion itself has worked since migration 0037 and lives in
 * Settings, but somebody who has already uninstalled has no way to reach it,
 * and no way to find out what was kept.
 *
 * Every claim below is checked against delete_my_account and deleteMyAccount():
 * the avatar goes first through the storage API, then the RPC erases identity
 * and ends the session. Match rows survive with the name replaced, because
 * other people played those matches and their history is the same rows.
 */
export const DELETE_ACCOUNT = {
  title: { en: "Delete your Padelier account", id: "Menghapus akun Padelier Anda" },
  updated: UPDATED,

  intro: [
    {
      en: "You can delete your account yourself, at any time, and it takes effect immediately — there is no waiting period and nobody has to approve it.",
      id: "Anda dapat menghapus akun sendiri, kapan saja, dan langsung berlaku — tidak ada masa tunggu dan tidak perlu persetujuan siapa pun.",
    },
    {
      en: "This page also exists for people who have already removed the app. If that's you, write to us and we'll do it for you.",
      id: "Halaman ini juga untuk Anda yang sudah menghapus aplikasinya. Jika demikian, kirim email kepada kami dan kami akan melakukannya untuk Anda.",
    },
  ],

  inApp: {
    title: { en: "If you still have the app", id: "Jika aplikasi masih terpasang" },
    steps: [
      { en: "Open Padelier and sign in.", id: "Buka Padelier dan masuk." },
      { en: "Go to the You tab, then the gear icon for Settings.", id: "Buka tab You, lalu ikon gerigi untuk Pengaturan." },
      { en: "Scroll to the bottom and tap Delete account.", id: "Gulir ke bawah dan ketuk Hapus akun." },
      { en: "Confirm. Your identity is erased and you are signed out straight away.", id: "Konfirmasi. Identitas Anda dihapus dan Anda langsung keluar." },
    ],
  },

  byEmail: {
    title: { en: "If you have removed the app", id: "Jika aplikasi sudah dihapus" },
    body: [
      {
        en: "Email us from the address you signed up with and ask us to delete the account. Writing from that address is what tells us it's yours; if you can't, we'll ask you something only the account holder would know rather than delete the wrong one.",
        id: "Kirim email kepada kami dari alamat yang Anda gunakan saat mendaftar dan minta akun dihapus. Menulis dari alamat itulah yang menunjukkan bahwa akun tersebut milik Anda; jika tidak bisa, kami akan menanyakan sesuatu yang hanya diketahui pemilik akun daripada menghapus akun yang salah.",
      },
      {
        en: "We do it within 7 days and reply when it's done.",
        id: "Kami memprosesnya dalam 7 hari dan membalas setelah selesai.",
      },
    ],
  },

  erased: {
    title: { en: "Erased immediately", id: "Dihapus seketika" },
    items: [
      { en: "Your email address and password", id: "Alamat email dan kata sandi Anda" },
      { en: "Your name and profile photo", id: "Nama dan foto profil Anda" },
      { en: "Your bio, playing side and other profile details", id: "Bio, sisi bermain, dan detail profil lainnya" },
      { en: "Your rating and rating history", id: "Rating dan riwayat rating Anda" },
      { en: "Your club memberships and notifications", id: "Keanggotaan klub dan notifikasi Anda" },
      { en: "Your session, and every round in it, if you were the host", id: "Sesi Anda beserta seluruh rondenya, jika Anda hostnya" },
    ],
  },

  kept: {
    title: { en: "Kept, without your name on it", id: "Tetap disimpan, tanpa nama Anda" },
    body: [
      {
        en: "Matches you played in someone else's session stay, with your name replaced by \"Deleted player\". This is not a loophole: other people played those matches, and their record, rating and history are built from the same rows. Removing them would quietly rewrite somebody else's season.",
        id: "Pertandingan yang Anda mainkan di sesi orang lain tetap ada, dengan nama Anda diganti menjadi \"Pemain terhapus\". Ini bukan celah: pertandingan itu juga dimainkan orang lain, dan rekor, rating, serta riwayat mereka dibangun dari baris data yang sama. Menghapusnya berarti diam-diam mengubah musim orang lain.",
      },
      {
        en: "Once your name is gone, those rows no longer identify you.",
        id: "Setelah nama Anda hilang, baris data tersebut tidak lagi mengidentifikasi Anda.",
      },
    ],
  },

  warning: {
    en: "Deletion cannot be undone. There is no restore, and signing up again with the same email gives you a new, empty account — not your old one.",
    id: "Penghapusan tidak dapat dibatalkan. Tidak ada pemulihan, dan mendaftar lagi dengan email yang sama akan memberi Anda akun baru yang kosong — bukan akun lama Anda.",
  },

  ui: {
    en: { emailCta: "Email us to delete your account", subject: "Delete my Padelier account", back: "Privacy policy" },
    id: { emailCta: "Email kami untuk menghapus akun", subject: "Hapus akun Padelier saya", back: "Kebijakan Privasi" },
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Privacy policy
// ─────────────────────────────────────────────────────────────────────────────

export const PRIVACY: Doc = {
  title: { en: "Privacy policy", id: "Kebijakan Privasi" },
  updated: UPDATED,
  intro: [
    {
      en: "Padelier is a small app for running padel sessions. This page explains what we collect, why, who else sees it, how long we keep it, and what you can ask us to do with it.",
      id: "Padelier adalah aplikasi kecil untuk mengelola sesi padel. Halaman ini menjelaskan data apa yang kami kumpulkan, untuk apa, siapa saja yang bisa melihatnya, berapa lama kami menyimpannya, dan apa yang bisa Anda minta kami lakukan terhadapnya.",
    },
    {
      en: "We don't sell data, we don't run ads, and there are no analytics or tracking tools in this app.",
      id: "Kami tidak menjual data, tidak memasang iklan, dan tidak ada alat analitik atau pelacakan apa pun di aplikasi ini.",
    },
  ],
  sections: [
    {
      key: "controller",
      title: { en: "Who is responsible", id: "Siapa yang bertanggung jawab" },
      body: [
        {
          en: `Padelier is operated from Jakarta, Indonesia, and is the data controller ("pengendali data pribadi") for the personal data described here, within the meaning of Law No. 27 of 2022 on Personal Data Protection. You can reach us at ${CONTACT_EMAIL}.`,
          id: `Padelier dioperasikan dari Jakarta, Indonesia, dan bertindak sebagai pengendali data pribadi atas data yang dijelaskan di halaman ini, sebagaimana dimaksud dalam Undang-Undang Nomor 27 Tahun 2022 tentang Pelindungan Data Pribadi. Anda dapat menghubungi kami di ${CONTACT_EMAIL}.`,
        },
      ],
    },
    {
      key: "what-we-collect",
      title: { en: "What we collect", id: "Data yang kami kumpulkan" },
      body: [
        {
          en: "Only what the app needs to work. Every field below is either required to run a session or optional and clearly marked as such.",
          id: "Hanya yang dibutuhkan agar aplikasi berjalan. Setiap data di bawah ini bersifat wajib untuk menjalankan sesi, atau opsional dan ditandai dengan jelas.",
        },
      ],
      items: [
        {
          t: { en: "Email address", id: "Alamat email" },
          d: {
            en: "Required to create an account, to confirm it's really you, and to sign you back in. Your email is never shown to other players.",
            id: "Wajib untuk membuat akun, memastikan bahwa itu benar Anda, dan untuk masuk kembali. Email Anda tidak pernah ditampilkan kepada pemain lain.",
          },
        },
        {
          t: { en: "Password", id: "Kata sandi" },
          d: {
            en: "Stored only as a cryptographic hash by our authentication provider. Nobody — including us — can read it.",
            id: "Disimpan hanya dalam bentuk hash kriptografis oleh penyedia autentikasi kami. Tidak ada yang bisa membacanya, termasuk kami.",
          },
        },
        {
          t: { en: "Display name", id: "Nama tampilan" },
          d: {
            en: "Shown to other players on lineups, leaderboards, club pages and the Champions Hall. Use whatever name you're happy for them to see.",
            id: "Ditampilkan kepada pemain lain pada susunan pemain, papan peringkat, halaman klub, dan Champions Hall. Gunakan nama yang memang nyaman Anda tampilkan.",
          },
        },
        {
          t: { en: "Profile photo and bio", id: "Foto profil dan bio" },
          d: {
            en: "Both optional. If you add them they are public: anyone with a link to your profile can see them, including people without an account.",
            id: "Keduanya opsional. Jika Anda menambahkannya, keduanya bersifat publik: siapa pun yang memiliki tautan ke profil Anda dapat melihatnya, termasuk orang tanpa akun.",
          },
        },
        {
          t: { en: "Gender and preferred side", id: "Jenis kelamin dan sisi lapangan" },
          d: {
            en: "Optional. Gender is used only to build mixed-format rounds; your preferred side is used only so the scheduler can pair you sensibly.",
            id: "Opsional. Jenis kelamin hanya digunakan untuk menyusun ronde format campuran; sisi lapangan hanya digunakan agar penjadwal dapat memasangkan Anda dengan tepat.",
          },
        },
        {
          t: { en: "Match results and rating", id: "Hasil pertandingan dan rating" },
          d: {
            en: "Scores, rounds, partners and opponents from sessions you play, and the skill rating calculated from them. This is the point of the app, and results are visible to other players in the same session or club.",
            id: "Skor, ronde, rekan, dan lawan dari sesi yang Anda mainkan, serta rating keterampilan yang dihitung darinya. Inilah inti aplikasi ini, dan hasilnya dapat dilihat oleh pemain lain dalam sesi atau klub yang sama.",
          },
        },
        {
          t: { en: "Clubs and sessions", id: "Klub dan sesi" },
          d: {
            en: "Which clubs you belong to, your role in them, the sessions you host or join, and notifications about them.",
            id: "Klub yang Anda ikuti, peran Anda di dalamnya, sesi yang Anda selenggarakan atau ikuti, serta notifikasi terkait.",
          },
        },
        {
          t: { en: "Technical data", id: "Data teknis" },
          d: {
            en: "When you request a sign-in or check whether an email is registered, we briefly record the IP address the request came from so that nobody can use the app to test thousands of addresses. These records are automatically deleted after one hour. Our host, Netlify, keeps standard server logs.",
            id: "Saat Anda meminta masuk atau mengecek apakah sebuah email sudah terdaftar, kami mencatat sebentar alamat IP asal permintaan agar aplikasi ini tidak bisa dipakai untuk menguji ribuan alamat. Catatan tersebut dihapus otomatis setelah satu jam. Netlify, penyedia hosting kami, menyimpan log server standar.",
          },
        },
      ],
    },
    {
      key: "why",
      title: { en: "Why we process it, and on what basis", id: "Dasar dan tujuan pemrosesan" },
      body: [
        {
          en: "Article 20 of the PDP Law requires a lawful basis for each purpose. Ours are:",
          id: "Pasal 20 UU PDP mensyaratkan dasar hukum untuk setiap tujuan. Dasar kami adalah:",
        },
      ],
      items: [
        {
          t: { en: "Running your account and your games", id: "Menjalankan akun dan permainan Anda" },
          d: {
            en: "Basis: performance of our agreement with you. Without an email, a name and your results, there is no account and no leaderboard.",
            id: "Dasar: pelaksanaan perjanjian dengan Anda. Tanpa email, nama, dan hasil pertandingan, tidak ada akun dan tidak ada papan peringkat.",
          },
        },
        {
          t: { en: "Optional profile details", id: "Detail profil yang opsional" },
          d: {
            en: "Basis: your consent, given when you choose to add a photo, a bio, your gender or your side. You can remove any of them at any time, which withdraws that consent.",
            id: "Dasar: persetujuan Anda, yang diberikan saat Anda memilih menambahkan foto, bio, jenis kelamin, atau sisi lapangan. Anda dapat menghapusnya kapan saja, dan itu berarti menarik persetujuan tersebut.",
          },
        },
        {
          t: { en: "Keeping the app safe", id: "Menjaga keamanan aplikasi" },
          d: {
            en: "Basis: our legitimate interest in preventing abuse — the short-lived IP records that limit sign-in attempts exist only for this.",
            id: "Dasar: kepentingan sah kami untuk mencegah penyalahgunaan — catatan IP berumur pendek yang membatasi percobaan masuk hanya untuk keperluan ini.",
          },
        },
        {
          t: { en: "Answering you", id: "Menjawab Anda" },
          d: {
            en: "Basis: performance of our agreement. If you email us, we keep the thread so we can follow it up.",
            id: "Dasar: pelaksanaan perjanjian. Jika Anda mengirim email, kami menyimpan percakapannya agar dapat menindaklanjuti.",
          },
        },
      ],
    },
    {
      key: "recipients",
      title: { en: "Who else sees your data", id: "Siapa lagi yang melihat data Anda" },
      body: [
        {
          en: "Other players see what you'd expect them to: your display name, photo, rating and results within sessions and clubs you share with them. Beyond that, four service providers process data on our behalf. We do not sell personal data, and we do not share it for advertising.",
          id: "Pemain lain melihat hal yang memang semestinya: nama tampilan, foto, rating, dan hasil Anda dalam sesi dan klub yang sama. Selain itu, empat penyedia layanan memproses data atas nama kami. Kami tidak menjual data pribadi dan tidak membagikannya untuk keperluan iklan.",
        },
      ],
      items: [
        {
          t: { en: "Supabase", id: "Supabase" },
          d: {
            en: "Our database, sign-in system and file storage. It holds everything described above and sends the confirmation and password-reset emails.",
            id: "Basis data, sistem masuk, dan penyimpanan berkas kami. Di sinilah semua data di atas tersimpan, dan dari sini pula email konfirmasi serta pengaturan ulang kata sandi dikirim.",
          },
        },
        {
          t: { en: "Netlify", id: "Netlify" },
          d: {
            en: "Serves the app itself and keeps standard server logs, which include IP addresses.",
            id: "Menyajikan aplikasi ini dan menyimpan log server standar, termasuk alamat IP.",
          },
        },
        {
          t: { en: "Google Fonts", id: "Google Fonts" },
          d: {
            en: "The app loads its typefaces from Google's servers, so opening any page tells Google your IP address and browser. No account data is sent.",
            id: "Aplikasi memuat jenis huruf dari server Google, sehingga membuka halaman mana pun memberi tahu Google alamat IP dan peramban Anda. Tidak ada data akun yang dikirim.",
          },
        },
        {
          t: { en: "Google Public DNS", id: "Google Public DNS" },
          d: {
            en: "When you type an email at sign-up we check that the domain can actually receive mail, to catch typos. Only the part after the @ is sent — never your full address.",
            id: "Saat Anda mengetik email ketika mendaftar, kami memeriksa apakah domainnya benar-benar bisa menerima surat, untuk menangkap salah ketik. Hanya bagian setelah tanda @ yang dikirim — tidak pernah alamat lengkap Anda.",
          },
        },
      ],
    },
    {
      key: "transfer",
      title: { en: "Data leaving Indonesia", id: "Data yang keluar dari Indonesia" },
      body: [
        {
          en: "Our database, storage and hosting run on servers outside Indonesia. Article 56 of the PDP Law allows this where binding safeguards are in place; we rely on the data processing agreements and standard contractual clauses offered by those providers.",
          id: "Basis data, penyimpanan, dan hosting kami berjalan di server di luar Indonesia. Pasal 56 UU PDP mengizinkan hal ini apabila terdapat pelindungan yang mengikat; kami bersandar pada perjanjian pemrosesan data dan klausul kontraktual standar yang disediakan penyedia tersebut.",
        },
      ],
    },
    {
      key: "retention",
      title: { en: "How long we keep it", id: "Berapa lama kami menyimpannya" },
      items: [
        {
          t: { en: "While your account exists", id: "Selama akun Anda ada" },
          d: {
            en: "Your profile and results are kept for as long as you have an account, because that's what makes your history and rating meaningful.",
            id: "Profil dan hasil Anda disimpan selama akun Anda masih ada, karena itulah yang membuat riwayat dan rating Anda bermakna.",
          },
        },
        {
          t: { en: "After you delete your account", id: "Setelah Anda menghapus akun" },
          d: {
            en: "Your email, password, name, photo and bio are erased immediately. Match records stay, with your name replaced by \"Deleted player\", because other people played those matches and their history is built from the same rows. Once your name is gone those records no longer identify you.",
            id: "Email, kata sandi, nama, foto, dan bio Anda dihapus seketika. Catatan pertandingan tetap ada, dengan nama Anda diganti menjadi \"Pemain terhapus\", karena pertandingan itu juga dimainkan orang lain dan riwayat mereka dibangun dari baris data yang sama. Setelah nama Anda hilang, catatan tersebut tidak lagi mengidentifikasi Anda.",
          },
        },
        {
          t: { en: "Guest details", id: "Data tamu" },
          d: {
            en: "If you joined a session without an account, the name and email you gave are kept for up to 12 months after that session so a returning guest can be recognised, then removed.",
            id: "Jika Anda mengikuti sesi tanpa akun, nama dan email yang Anda berikan disimpan paling lama 12 bulan setelah sesi tersebut agar tamu yang kembali dapat dikenali, lalu dihapus.",
          },
        },
        {
          t: { en: "Technical records", id: "Catatan teknis" },
          d: {
            en: "The IP records used for rate limiting are deleted after one hour. Server logs follow our host's own retention schedule.",
            id: "Catatan IP untuk pembatasan laju dihapus setelah satu jam. Log server mengikuti jadwal penyimpanan milik penyedia hosting kami.",
          },
        },
      ],
    },
    {
      key: "rights",
      title: { en: "Your rights", id: "Hak Anda" },
      body: [
        {
          en: "Under Articles 5 to 13 of the PDP Law you can ask us to: tell you what we hold and why; correct anything wrong; give you a copy, including in a portable form; delete your data; stop or limit a particular use; withdraw a consent you gave; and object to a decision made purely automatically. Most of these you can do yourself inside the app — your profile is editable, and Settings has a delete button that erases your identity immediately.",
          id: "Berdasarkan Pasal 5 sampai 13 UU PDP, Anda dapat meminta kami untuk: memberi tahu data apa yang kami simpan dan untuk apa; memperbaiki data yang keliru; memberikan salinan, termasuk dalam bentuk yang dapat dipindahkan; menghapus data Anda; menghentikan atau membatasi penggunaan tertentu; menarik persetujuan yang telah Anda berikan; serta mengajukan keberatan atas keputusan yang dibuat sepenuhnya secara otomatis. Sebagian besar hal ini dapat Anda lakukan sendiri di dalam aplikasi — profil Anda bisa diubah, dan menu Pengaturan memiliki tombol hapus akun yang langsung menghapus identitas Anda.",
        },
        {
          en: `For anything else, email ${CONTACT_EMAIL} from the address on your account and we'll respond as quickly as we reasonably can, and in any case within 30 days. There's no charge.`,
          id: `Untuk hal lainnya, kirim email ke ${CONTACT_EMAIL} dari alamat yang terdaftar pada akun Anda, dan kami akan menjawab secepat yang wajar, paling lambat dalam 30 hari. Tidak dipungut biaya.`,
        },
      ],
    },
    {
      key: "security",
      title: { en: "How we protect it", id: "Cara kami melindunginya" },
      body: [
        {
          en: "Everything travels over HTTPS. Passwords are hashed, never stored in readable form. Access to the database is enforced row by row, so a signed-in person can only reach the data their role actually allows — a club admin's powers stop at their own club, and a session's scores can only be changed by its host.",
          id: "Semua data dikirim melalui HTTPS. Kata sandi di-hash, tidak pernah disimpan dalam bentuk yang bisa dibaca. Akses ke basis data ditegakkan baris per baris, sehingga orang yang masuk hanya dapat menjangkau data sesuai perannya — kewenangan admin klub berhenti di klubnya sendiri, dan skor sebuah sesi hanya dapat diubah oleh penyelenggaranya.",
        },
        {
          en: "If personal data is ever exposed, Article 46 of the PDP Law requires us to notify you and the authorities within 3 × 24 hours, and we will.",
          id: "Apabila data pribadi sampai terekspos, Pasal 46 UU PDP mewajibkan kami memberi tahu Anda dan pihak berwenang dalam 3 × 24 jam, dan itu akan kami lakukan.",
        },
      ],
    },
    {
      key: "children",
      title: { en: "Age", id: "Usia" },
      body: [
        {
          en: "Padelier is for people aged 18 and over. We don't knowingly collect data from children, and if we find out an account belongs to someone under 18 we'll delete it.",
          id: "Padelier ditujukan untuk pengguna berusia 18 tahun ke atas. Kami tidak dengan sengaja mengumpulkan data anak, dan jika kami mengetahui sebuah akun dimiliki orang di bawah 18 tahun, akun itu akan kami hapus.",
        },
      ],
    },
    {
      key: "guests",
      title: { en: "If someone added you", id: "Jika seseorang menambahkan Anda" },
      body: [
        {
          en: "A host can add players to a session by name, and you can join a session as a guest with just a name and email — no account. If your name appears in a session you didn't sign up for, the host put it there. Email us and we'll remove it.",
          id: "Penyelenggara dapat menambahkan pemain ke sebuah sesi dengan mengetikkan nama, dan Anda juga bisa mengikuti sesi sebagai tamu hanya dengan nama dan email — tanpa akun. Jika nama Anda muncul di sesi yang tidak Anda daftari, penyelenggaralah yang menuliskannya. Kirim email kepada kami dan akan kami hapus.",
        },
      ],
    },
    {
      key: "cookies",
      title: { en: "Cookies", id: "Cookie" },
      body: [
        {
          en: "There are no advertising or analytics cookies. The app stores your sign-in token and your language choice in your browser so you stay signed in and the app opens in the language you picked. Clearing your browser data removes both.",
          id: "Tidak ada cookie iklan maupun analitik. Aplikasi menyimpan token masuk dan pilihan bahasa Anda di peramban agar Anda tetap masuk dan aplikasi terbuka dalam bahasa yang Anda pilih. Menghapus data peramban akan menghapus keduanya.",
        },
      ],
    },
    {
      key: "automated",
      title: { en: "Automated decisions", id: "Keputusan otomatis" },
      body: [
        {
          en: "Your rating and the round draws are calculated by a formula, not by a person — but neither has any legal or similarly significant effect on you. There is no artificial intelligence, profiling for advertising, or automated decision-making about you in this app.",
          id: "Rating dan undian ronde Anda dihitung dengan rumus, bukan oleh manusia — tetapi keduanya tidak menimbulkan akibat hukum atau akibat signifikan lain bagi Anda. Tidak ada kecerdasan buatan, pemrofilan untuk iklan, atau pengambilan keputusan otomatis tentang diri Anda di aplikasi ini.",
        },
      ],
    },
    {
      key: "changes",
      title: { en: "Changes to this policy", id: "Perubahan kebijakan ini" },
      body: [
        {
          en: "If we change how we handle data we'll update this page and change the date at the top. If a change matters to you — a new recipient, a new purpose — we'll tell you in the app before it takes effect.",
          id: "Jika kami mengubah cara pengelolaan data, halaman ini akan diperbarui beserta tanggal di bagian atas. Jika perubahan itu penting bagi Anda — misalnya penerima baru atau tujuan baru — kami akan memberi tahu di dalam aplikasi sebelum perubahan berlaku.",
        },
      ],
    },
    {
      key: "complaints",
      title: { en: "Complaints", id: "Pengaduan" },
      body: [
        {
          en: `Tell us first — ${CONTACT_EMAIL} — and we'll try to put it right. You also have the right to complain to the Indonesian personal data protection authority, and to bring a claim under Article 12 of the PDP Law.`,
          id: `Sampaikan lebih dulu kepada kami — ${CONTACT_EMAIL} — dan akan kami upayakan perbaikannya. Anda juga berhak mengadu kepada lembaga pelindungan data pribadi di Indonesia, serta mengajukan gugatan sebagaimana diatur dalam Pasal 12 UU PDP.`,
        },
      ],
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Terms of use
// ─────────────────────────────────────────────────────────────────────────────

export const TERMS: Doc = {
  title: { en: "Terms of use", id: "Ketentuan Penggunaan" },
  updated: UPDATED,
  intro: [
    {
      en: "The short version: Padelier is a free app made by one person to make padel sessions easier to run. Use it in good faith, be careful with other people's names, and don't expect it to be perfect. Creating an account means you accept what's below.",
      id: "Ringkasnya: Padelier adalah aplikasi gratis buatan satu orang untuk memudahkan penyelenggaraan sesi padel. Gunakan dengan itikad baik, hati-hati dengan nama orang lain, dan jangan berharap semuanya sempurna. Membuat akun berarti Anda menyetujui ketentuan di bawah ini.",
    },
  ],
  sections: [
    {
      key: "service",
      title: { en: "What Padelier is", id: "Apa itu Padelier" },
      body: [
        {
          en: "A tool for organising padel sessions: it draws rounds, records scores, keeps a leaderboard and calculates a skill rating. It is not a booking service, it doesn't take payments, and it has nothing to do with the courts you play on.",
          id: "Sebuah alat untuk mengatur sesi padel: menyusun ronde, mencatat skor, menampilkan papan peringkat, dan menghitung rating keterampilan. Ini bukan layanan pemesanan lapangan, tidak menerima pembayaran, dan tidak berkaitan dengan lapangan tempat Anda bermain.",
        },
        {
          en: "It's free, and it's provided as it is. We may change how it works, or stop running it, without notice — though we'll try to give warning where we can.",
          id: "Aplikasi ini gratis dan disediakan apa adanya. Kami dapat mengubah cara kerjanya, atau menghentikannya, tanpa pemberitahuan — meski akan kami usahakan memberi kabar bila memungkinkan.",
        },
      ],
    },
    {
      key: "account",
      title: { en: "Your account", id: "Akun Anda" },
      body: [
        {
          en: "You must be 18 or over to hold an account. One account per person. Give a real email address — it's how you get back in if you forget your password — and keep your password to yourself. What happens under your account is your responsibility.",
          id: "Anda harus berusia 18 tahun ke atas untuk memiliki akun. Satu akun untuk satu orang. Gunakan alamat email yang benar — lewat situlah Anda bisa masuk kembali jika lupa kata sandi — dan jaga kerahasiaan kata sandi Anda. Segala hal yang terjadi melalui akun Anda menjadi tanggung jawab Anda.",
        },
      ],
    },
    {
      key: "others",
      title: { en: "Adding other people", id: "Menambahkan orang lain" },
      body: [
        {
          en: "As a host you can type other players' names into a session, and their results become visible to everyone in it. Only add people who are actually playing, use the name they'd want shown, and remove anyone who asks. Those are real people's details, and how you handle them is on you.",
          id: "Sebagai penyelenggara, Anda dapat mengetikkan nama pemain lain ke dalam sesi, dan hasil mereka akan terlihat oleh semua peserta. Tambahkan hanya orang yang benar-benar bermain, gunakan nama yang memang ingin mereka tampilkan, dan hapus siapa pun yang memintanya. Itu adalah data orang sungguhan, dan cara Anda memperlakukannya adalah tanggung jawab Anda.",
        },
      ],
    },
    {
      key: "conduct",
      title: { en: "Fair use", id: "Penggunaan yang wajar" },
      body: [
        {
          en: "Don't use Padelier to harass anyone, to impersonate someone, to upload anything offensive or that isn't yours to upload, to break into other people's accounts or data, to scrape or hammer the service, or to do anything against Indonesian law. We can remove content and suspend accounts when this happens, and we don't have to explain at length.",
          id: "Jangan gunakan Padelier untuk melecehkan siapa pun, menyamar sebagai orang lain, mengunggah materi yang menyinggung atau bukan hak Anda, membobol akun atau data orang lain, mengeruk data atau membebani layanan secara berlebihan, maupun melakukan hal yang melanggar hukum Indonesia. Kami dapat menghapus konten dan menangguhkan akun bila hal ini terjadi, tanpa keharusan memberi penjelasan panjang.",
        },
      ],
    },
    {
      key: "content",
      title: { en: "Your photo and bio", id: "Foto dan bio Anda" },
      body: [
        {
          en: "They stay yours. By uploading them you allow us to display them inside the app and on your public profile — nothing else. Upload only images you have the right to use. Remove them at any time from your profile.",
          id: "Keduanya tetap milik Anda. Dengan mengunggahnya, Anda mengizinkan kami menampilkannya di dalam aplikasi dan pada profil publik Anda — tidak untuk keperluan lain. Unggah hanya gambar yang memang berhak Anda gunakan. Anda dapat menghapusnya kapan saja dari profil.",
        },
      ],
    },
    {
      key: "results",
      title: { en: "Scores, ratings and clubs", id: "Skor, rating, dan klub" },
      body: [
        {
          en: "The host records the scores, so the scores are only as accurate as the host. Ratings, tiers, league tables and the Champions Hall are all calculated from those scores — treat them as a good-natured record of how the padel is going, not as an official ranking of anybody.",
          id: "Skor dicatat oleh penyelenggara, jadi ketepatannya bergantung pada penyelenggara. Rating, tingkatan, klasemen liga, dan Champions Hall semuanya dihitung dari skor tersebut — anggaplah itu catatan yang menyenangkan tentang perjalanan padel Anda, bukan peringkat resmi siapa pun.",
        },
        {
          en: "Club owners and admins decide who joins their club and can change its settings. We don't arbitrate between members — that's a conversation for the club.",
          id: "Pemilik dan admin klub yang menentukan siapa yang bergabung dan dapat mengubah pengaturan klub. Kami tidak menengahi perselisihan antaranggota — itu urusan yang diselesaikan di dalam klub.",
        },
      ],
    },
    {
      key: "ending",
      title: { en: "Ending it", id: "Mengakhiri penggunaan" },
      body: [
        {
          en: "You can delete your account whenever you like, from Settings. Your identity is erased at once; matches you played remain as anonymous records, because other people were in them. We may suspend or remove an account that breaks these terms.",
          id: "Anda dapat menghapus akun kapan saja melalui menu Pengaturan. Identitas Anda dihapus seketika; pertandingan yang pernah Anda mainkan tetap tersimpan sebagai catatan anonim, karena ada orang lain di dalamnya. Kami dapat menangguhkan atau menghapus akun yang melanggar ketentuan ini.",
        },
      ],
    },
    {
      key: "liability",
      title: { en: "What we're not responsible for", id: "Yang bukan tanggung jawab kami" },
      body: [
        {
          en: "Padel is a physical game and injuries happen on court, not in an app — nothing here makes us responsible for what happens at your session. Nor for a wrong score, a lost draw, a session that didn't happen, or the app being down when you needed it. To the extent Indonesian law allows, Padelier is provided without warranty and our liability is limited to what you paid us, which is nothing.",
          id: "Padel adalah olahraga fisik dan cedera terjadi di lapangan, bukan di aplikasi — tidak ada bagian dari ketentuan ini yang membuat kami bertanggung jawab atas apa yang terjadi pada sesi Anda. Begitu pula atas skor yang keliru, undian yang hilang, sesi yang batal, atau aplikasi yang tidak dapat diakses saat Anda membutuhkannya. Sepanjang diizinkan hukum Indonesia, Padelier disediakan tanpa jaminan dan tanggung jawab kami terbatas pada jumlah yang Anda bayarkan kepada kami, yaitu nihil.",
        },
      ],
    },
    {
      key: "changes-terms",
      title: { en: "Changes to these terms", id: "Perubahan ketentuan ini" },
      body: [
        {
          en: "We'll update this page and the date at the top. If a change is significant you'll see it in the app. Carrying on using Padelier after that means you accept it; if you don't, delete your account.",
          id: "Kami akan memperbarui halaman ini beserta tanggal di bagian atas. Jika perubahannya signifikan, Anda akan melihatnya di dalam aplikasi. Melanjutkan penggunaan Padelier setelah itu berarti Anda menerimanya; jika tidak, silakan hapus akun Anda.",
        },
      ],
    },
    {
      key: "law",
      title: { en: "Which law applies", id: "Hukum yang berlaku" },
      body: [
        {
          en: "Indonesian law, and the courts of Jakarta. If part of these terms turns out to be unenforceable, the rest still stands.",
          id: "Hukum Indonesia, dengan yurisdiksi pengadilan di Jakarta. Apabila sebagian ketentuan ini tidak dapat diberlakukan, bagian selebihnya tetap berlaku.",
        },
      ],
    },
  ],
};
