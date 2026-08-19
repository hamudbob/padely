/**
 * Every answer on the About / FAQ page, in both languages.
 *
 * ONE array, two strings per entry — not two pages. If these were separate
 * documents they would drift the first time a feature changed and nobody would
 * notice for months; here a missing translation is a visible hole and adding a
 * section forces both languages into view at once.
 *
 * Written at the level of PRINCIPLE, not instructions. "The app draws fair
 * rounds so everyone partners everyone" stays true when a screen moves; "tap
 * the third button" is wrong the moment anything is redesigned. No screenshots,
 * no step-by-step, no button names unless the button is the whole point.
 *
 * Every rule below was read out of the code rather than remembered — the
 * compensation formula from standingsQueries, league points from 0019, the
 * champions hall from 0030, claims from 0029, the rating constants from
 * lib/rating/glicko2. If one of those changes, this file changes with it.
 *
 * The tier NAMES are deliberately absent. They're a club in-joke; explaining a
 * joke kills it, and this page is public. The rating behind them is explained
 * in full instead.
 */

export type Lang = "en" | "id";

export interface Entry {
  /** Anchor id — lets the app deep-link straight to an answer. */
  key: string;
  q: Record<Lang, string>;
  a: Record<Lang, string[]>;
}

export interface Group {
  key: string;
  title: Record<Lang, string>;
  blurb: Record<Lang, string>;
  entries: Entry[];
}

export const GROUPS: Group[] = [
  // ─────────────────────────────────────────────────────────── Playing ──
  {
    key: "playing",
    title: { en: "Playing", id: "Bermain" },
    blurb: {
      en: "Formats, scoring, and how the app decides who plays whom.",
      id: "Format, penilaian, dan bagaimana aplikasi menentukan siapa bermain dengan siapa.",
    },
    entries: [
      {
        key: "what-is-a-session",
        q: { en: "What is a session?", id: "Apa itu sesi?" },
        a: {
          en: [
            "A session is one gathering: a set of players, one or more courts, and a series of rounds played until you decide to stop.",
            "The host creates it, the app draws each round, and everyone's points are tallied into a live leaderboard. When the host ends the session, the standings are frozen and the results are recorded.",
          ],
          id: [
            "Sesi adalah satu kali pertemuan: sekelompok pemain, satu atau beberapa lapangan, dan rangkaian ronde yang dimainkan sampai kalian memutuskan berhenti.",
            "Host membuat sesi, aplikasi menyusun setiap ronde, dan poin semua orang dihitung ke papan peringkat langsung. Ketika host mengakhiri sesi, klasemen dikunci dan hasilnya dicatat.",
          ],
        },
      },
      {
        key: "formats",
        q: { en: "What do the different formats mean?", id: "Apa perbedaan setiap format?" },
        a: {
          en: [
            "Americano — everyone partners everyone. Pairs rotate each round so you play alongside as many different people as possible. The fairest format for a mixed-ability group, and the usual default.",
            "Mexicano — pairings are re-drawn each round based on the current standings, so the leaders end up playing each other. More competitive as the session goes on.",
            "Mix Americano and Mix Mexicano — the same two ideas, but every pair is one man and one woman.",
            "Fixed Partner — you keep the same partner for the whole session and the pair is ranked as one unit.",
            "Fixed Position — like Americano, but you always stay on your preferred side of the court, left or right.",
            "Team Sparring — two fixed teams play each other, and every result adds to the team's running total.",
          ],
          id: [
            "Americano — semua orang berpasangan dengan semua orang. Pasangan berganti tiap ronde agar kamu bermain bersama sebanyak mungkin orang berbeda. Format paling adil untuk kelompok dengan level campuran, dan biasanya jadi pilihan utama.",
            "Mexicano — pasangan disusun ulang tiap ronde berdasarkan klasemen saat itu, sehingga pemain teratas akhirnya saling berhadapan. Makin kompetitif seiring berjalannya sesi.",
            "Mix Americano dan Mix Mexicano — dua ide yang sama, tetapi setiap pasangan terdiri dari satu pria dan satu wanita.",
            "Fixed Partner — kamu tetap dengan pasangan yang sama sepanjang sesi, dan pasangan itu dinilai sebagai satu kesatuan.",
            "Fixed Position — seperti Americano, tetapi kamu selalu berada di sisi lapangan yang kamu pilih, kiri atau kanan.",
            "Team Sparring — dua tim tetap saling berhadapan, dan setiap hasil menambah total tim.",
          ],
        },
      },
      {
        key: "scoring",
        q: { en: "How is a game scored?", id: "Bagaimana satu game dinilai?" },
        a: {
          en: [
            "The host picks one scoring format for the whole session. Points to 21 means both scores always add up to 21, so entering one side's score fills in the other automatically. Four or five games works the same way over a fixed number of games.",
            "Race formats — first to 4, or first to 6 — end as soon as one side reaches the target, so the two scores don't add up to a fixed number.",
          ],
          id: [
            "Host memilih satu format penilaian untuk seluruh sesi. Poin sampai 21 berarti kedua skor selalu berjumlah 21, jadi memasukkan skor satu sisi otomatis mengisi sisi lainnya. Empat atau lima game bekerja dengan cara yang sama pada jumlah game tetap.",
            "Format race — pertama mencapai 4, atau pertama mencapai 6 — selesai begitu satu sisi mencapai target, sehingga kedua skor tidak berjumlah angka tetap.",
          ],
        },
      },
      {
        key: "ranking-basis",
        q: { en: "How is the leaderboard ordered?", id: "Bagaimana urutan papan peringkat?" },
        a: {
          en: [
            "The host chooses between two rules. Points first ranks by total points scored, with wins as the tie-breaker. Wins first ranks by number of wins, with points as the tie-breaker.",
            "Points first rewards playing well in every game even when you lose; wins first rewards closing games out.",
          ],
          id: [
            "Host memilih di antara dua aturan. Poin dulu mengurutkan berdasarkan total poin, dengan jumlah kemenangan sebagai penentu jika seri. Menang dulu mengurutkan berdasarkan jumlah kemenangan, dengan poin sebagai penentu.",
            "Poin dulu menghargai permainan yang baik di setiap game meski kalah; menang dulu menghargai kemampuan menutup pertandingan.",
          ],
        },
      },
      {
        key: "resting",
        q: { en: "What if there are more players than court spots?", id: "Bagaimana kalau pemain lebih banyak dari tempat di lapangan?" },
        a: {
          en: [
            "Some players sit out each round. The app spreads the rests as evenly as it can, so nobody sits out far more often than anyone else.",
            "Resting never costs you position on the leaderboard — see the next answer.",
          ],
          id: [
            "Sebagian pemain akan istirahat di tiap ronde. Aplikasi membagi giliran istirahat serata mungkin, jadi tidak ada yang jauh lebih sering duduk daripada yang lain.",
            "Istirahat tidak pernah merugikan posisimu di papan peringkat — lihat jawaban berikutnya.",
          ],
        },
      },
      {
        key: "compensation",
        q: { en: "What happens to my points if I rest or leave early?", id: "Apa yang terjadi pada poinku kalau istirahat atau pulang lebih awal?" },
        a: {
          en: [
            "You are topped up for every game you missed, so sitting out — or going home early — is never a penalty on the scoreboard.",
            "For each game you played fewer than the busiest player in the field, you receive half the game's target as neutral points. In a session played to 21, that is 10 points per missed game.",
            "This is points only. No wins or losses are invented for games you didn't play, so your record still reflects real matches. Anyone who leaves keeps everything they actually earned, plus this top-up.",
          ],
          id: [
            "Kamu mendapat tambahan poin untuk setiap game yang terlewat, jadi istirahat — atau pulang lebih awal — tidak pernah merugikan di papan skor.",
            "Untuk setiap game yang kamu mainkan lebih sedikit dibanding pemain tersibuk di sesi itu, kamu menerima setengah dari target game sebagai poin netral. Pada sesi sampai 21, itu berarti 10 poin per game yang terlewat.",
            "Ini hanya poin. Tidak ada kemenangan atau kekalahan yang dibuat-buat untuk game yang tidak kamu mainkan, jadi rekormu tetap mencerminkan pertandingan yang benar-benar terjadi. Siapa pun yang pulang duluan tetap menyimpan semua yang sudah diraih, ditambah kompensasi ini.",
          ],
        },
      },
    ],
  },

  // ─────────────────────────────────────────────────────────── Joining ──
  {
    key: "joining",
    title: { en: "Joining & watching", id: "Bergabung & menonton" },
    blurb: {
      en: "Codes, claiming your spot, arriving late, and following a session you're not playing in.",
      id: "Kode, mengklaim tempatmu, datang terlambat, dan mengikuti sesi yang tidak kamu mainkan.",
    },
    entries: [
      {
        key: "join-code",
        q: { en: "How do I join a session?", id: "Bagaimana cara bergabung ke sesi?" },
        a: {
          en: [
            "Every session has a six-digit code. Enter it and you'll land on that session, whether it's still being set up or already running.",
            "The host confirms you before you're added to the draw.",
          ],
          id: [
            "Setiap sesi punya kode enam digit. Masukkan kodenya dan kamu akan langsung menuju sesi tersebut, baik yang masih disiapkan maupun yang sudah berjalan.",
            "Host akan mengonfirmasi sebelum kamu dimasukkan ke undian.",
          ],
        },
      },
      {
        key: "watch",
        q: { en: "Can I watch without an account?", id: "Bisakah menonton tanpa akun?" },
        a: {
          en: [
            "Yes. A session's live link can be opened by anyone — you'll see the current round, the scores as they're entered, and the standings, with no sign-in at all.",
            "You need an account only to play, because your results have to attach to a lasting identity.",
          ],
          id: [
            "Bisa. Tautan langsung sebuah sesi dapat dibuka siapa saja — kamu akan melihat ronde berjalan, skor saat dimasukkan, dan klasemen, tanpa perlu masuk sama sekali.",
            "Akun hanya diperlukan untuk bermain, karena hasilmu harus melekat pada identitas yang permanen.",
          ],
        },
      },
      {
        key: "claim",
        q: { en: "The session started without me and my name is already on it. What now?", id: "Sesi sudah dimulai tanpa aku dan namaku sudah ada di sana. Bagaimana?" },
        a: {
          en: [
            "Open the live session and claim the name that represents you. The host accepts, and from that moment the spot belongs to your account.",
            "Everything already recorded under that name becomes yours — the points, the games, and the effect on your rating when the session ends. Nothing needs to be re-entered.",
            "You need to be signed in to claim, since there'd be nothing to attach the results to otherwise.",
          ],
          id: [
            "Buka sesi langsungnya dan klaim nama yang mewakilimu. Host menerima klaim itu, dan sejak saat itu tempat tersebut menjadi milik akunmu.",
            "Semua yang sudah tercatat di bawah nama itu menjadi milikmu — poin, game, dan pengaruhnya pada rating saat sesi berakhir. Tidak ada yang perlu dimasukkan ulang.",
            "Kamu harus masuk untuk bisa mengklaim, karena tanpa akun tidak ada tempat untuk menempelkan hasilnya.",
          ],
        },
      },
      {
        key: "late",
        q: { en: "Can someone join after the session has started?", id: "Bisakah seseorang bergabung setelah sesi dimulai?" },
        a: {
          en: [
            "Yes. Rounds don't have to wait for everyone to arrive — the host can start with whoever is there, and latecomers are added as they turn up.",
            "Someone joining mid-session plays from the next round onwards; rounds already played aren't rewritten.",
          ],
          id: [
            "Bisa. Ronde tidak perlu menunggu semua orang datang — host bisa memulai dengan siapa pun yang sudah hadir, dan yang telat ditambahkan begitu tiba.",
            "Orang yang bergabung di tengah sesi bermain mulai ronde berikutnya; ronde yang sudah dimainkan tidak diubah.",
          ],
        },
      },
    ],
  },

  // ───────────────────────────────────────────────────────────── Clubs ──
  {
    key: "clubs",
    title: { en: "Clubs", id: "Klub" },
    blurb: {
      en: "How a regular group keeps a league, schedules sessions and tracks its champions.",
      id: "Bagaimana kelompok rutin menjalankan liga, menjadwalkan sesi, dan mencatat juaranya.",
    },
    entries: [
      {
        key: "what-is-a-club",
        q: { en: "What is a club for?", id: "Untuk apa klub itu?" },
        a: {
          en: [
            "A club turns a group that plays together regularly into something with a memory: a league table across many sessions, a schedule people can RSVP to, and a record of who has won what.",
            "You can use the app perfectly well without one — a club is for groups that keep score across weeks, not just within one evening.",
          ],
          id: [
            "Klub mengubah kelompok yang rutin bermain bersama menjadi sesuatu yang punya ingatan: tabel liga lintas banyak sesi, jadwal yang bisa dikonfirmasi kehadirannya, dan catatan siapa memenangkan apa.",
            "Aplikasi ini tetap bisa dipakai tanpa klub — klub ditujukan untuk kelompok yang menghitung skor lintas pekan, bukan hanya dalam satu malam.",
          ],
        },
      },
      {
        key: "join-club",
        q: { en: "How do I join a club?", id: "Bagaimana cara bergabung ke klub?" },
        a: {
          en: [
            "Search for it by name, or enter the club code someone sent you. Either way an admin confirms you before you're in.",
            "You can also create your own, and you become its owner.",
          ],
          id: [
            "Cari berdasarkan nama, atau masukkan kode klub yang dikirim seseorang. Dengan cara mana pun, admin akan mengonfirmasi sebelum kamu masuk.",
            "Kamu juga bisa membuat klub sendiri, dan kamu menjadi pemiliknya.",
          ],
        },
      },
      {
        key: "roles",
        q: { en: "What can admins do that members can't?", id: "Apa yang bisa dilakukan admin tapi tidak bisa oleh anggota?" },
        a: {
          en: [
            "Admins accept people into the club, schedule sessions, and edit the club's name, logo and league settings. The owner can additionally promote and remove admins.",
            "Members can see everything about the club — the league, the champions hall, the roster — and RSVP to sessions.",
          ],
          id: [
            "Admin menerima orang ke dalam klub, menjadwalkan sesi, serta mengubah nama, logo, dan pengaturan liga klub. Pemilik juga bisa mengangkat dan menghapus admin.",
            "Anggota bisa melihat semua tentang klub — liga, hall of fame, daftar anggota — dan mengonfirmasi kehadiran di sesi.",
          ],
        },
      },
      {
        key: "scheduled",
        q: { en: "What are scheduled sessions and RSVPs?", id: "Apa itu sesi terjadwal dan konfirmasi kehadiran?" },
        a: {
          en: [
            "An admin can put a session on the calendar before it happens. Every member is notified and can answer going, maybe or can't make it, so the host knows the numbers in advance.",
            "When the time comes, the admin starts the real session from that entry.",
          ],
          id: [
            "Admin bisa memasukkan sesi ke kalender sebelum hari-H. Semua anggota mendapat notifikasi dan bisa menjawab ikut, mungkin, atau tidak bisa, sehingga host tahu jumlahnya lebih awal.",
            "Saat waktunya tiba, admin memulai sesi sungguhan dari entri tersebut.",
          ],
        },
      },
      {
        key: "league",
        q: { en: "How does the club league work?", id: "Bagaimana liga klub bekerja?" },
        a: {
          en: [
            "Every session a club plays awards league points based on where you finished. You get one point for each player you finished ahead of, plus one — so first place in a field of eight earns eight points, second earns seven, and so on.",
            "On top of that the podium earns a bonus: three extra points for first, two for second, one for third.",
            "A club sets how long a league period runs — monthly through to yearly — and how many sessions someone must play before they appear on the table, so one lucky night doesn't top the standings.",
            "A host can also mark a session as not counting toward the league, for a casual hit that shouldn't affect anything.",
          ],
          id: [
            "Setiap sesi yang dimainkan klub memberi poin liga berdasarkan posisi akhirmu. Kamu mendapat satu poin untuk setiap pemain yang kamu ungguli, ditambah satu — jadi juara pertama dari delapan pemain mendapat delapan poin, kedua tujuh, dan seterusnya.",
            "Di atas itu, podium mendapat bonus: tiga poin tambahan untuk pertama, dua untuk kedua, satu untuk ketiga.",
            "Klub menentukan berapa lama satu periode liga berjalan — dari bulanan sampai tahunan — dan berapa sesi minimal yang harus dimainkan sebelum seseorang muncul di tabel, agar satu malam keberuntungan tidak langsung memuncaki klasemen.",
            "Host juga bisa menandai sebuah sesi agar tidak dihitung untuk liga, untuk main santai yang tidak perlu berpengaruh.",
          ],
        },
      },
      {
        key: "champions",
        q: { en: "What is the champions hall?", id: "Apa itu hall of fame juara?" },
        a: {
          en: [
            "A club's permanent record of who has won. The titles board lists everyone who has finished first at least once, ordered by titles, then podium finishes, then their average placing.",
            "Alongside it sits the recent champions list — the most recently finished sessions with their winner and full podium.",
            "Unlike the league it never resets. It's the long memory of the club, and it's visible to members.",
          ],
          id: [
            "Catatan permanen klub tentang siapa saja yang pernah juara. Papan gelar memuat semua orang yang pernah finis pertama, diurutkan berdasarkan jumlah gelar, lalu podium, lalu rata-rata posisi akhir.",
            "Di sampingnya ada daftar juara terbaru — sesi-sesi terakhir yang selesai beserta pemenang dan podium lengkapnya.",
            "Berbeda dengan liga, hall of fame tidak pernah direset. Ini ingatan panjang klub, dan bisa dilihat oleh para anggota.",
          ],
        },
      },
    ],
  },

  // ──────────────────────────────────────────────────────────── Profile ──
  {
    key: "profile",
    title: { en: "Your rating & profile", id: "Rating & profilmu" },
    blurb: {
      en: "How the skill rating is calculated, what your record shows, and what other people can see.",
      id: "Bagaimana rating keterampilan dihitung, apa isi rekormu, dan apa yang bisa dilihat orang lain.",
    },
    entries: [
      {
        key: "rating",
        q: { en: "How does the skill rating work?", id: "Bagaimana rating keterampilan bekerja?" },
        a: {
          en: [
            "Everyone starts at 1500. After each session your rating moves according to how you did against the specific people you played — not simply how many games you won.",
            "Beating someone rated well above you moves your rating much more than beating someone below you. Losing to a much stronger player barely costs you anything. This is why two people with the same win rate can have very different ratings.",
            "The rating is relative to the people you actually play with. It says where you sit in your circle, not where you'd sit in the world.",
            "The label shown next to your rating is simply a friendly name for that number — nothing is calculated from it.",
          ],
          id: [
            "Semua orang mulai dari 1500. Setelah setiap sesi, ratingmu bergerak sesuai performamu melawan orang-orang tertentu yang kamu hadapi — bukan sekadar berapa banyak game yang kamu menangkan.",
            "Mengalahkan pemain dengan rating jauh di atasmu menaikkan ratingmu jauh lebih banyak daripada mengalahkan yang di bawahmu. Kalah dari pemain yang jauh lebih kuat hampir tidak merugikanmu. Karena itu dua orang dengan persentase kemenangan sama bisa punya rating yang sangat berbeda.",
            "Rating bersifat relatif terhadap orang-orang yang benar-benar kamu lawan. Rating menunjukkan posisimu di lingkaranmu, bukan posisimu di dunia.",
            "Label di sebelah ratingmu hanyalah nama yang lebih ramah untuk angka tersebut — tidak ada perhitungan apa pun yang berasal darinya.",
          ],
        },
      },
      {
        key: "provisional",
        q: { en: "Why does it say my rating is still settling?", id: "Kenapa tertulis ratingku masih menyesuaikan?" },
        a: {
          en: [
            "Because the app doesn't trust the number yet. A new rating carries a wide margin of error, and that margin shrinks as you play.",
            "It takes roughly three sessions for the number to become reliable, and until then it can move a long way in one evening. That's the rating finding you, not you getting better or worse.",
            "This has nothing to do with how well you're playing — winning everything or losing everything takes the same three sessions.",
          ],
          id: [
            "Karena aplikasi belum bisa mempercayai angka tersebut. Rating baru punya margin kesalahan yang lebar, dan margin itu menyempit seiring kamu bermain.",
            "Butuh sekitar tiga sesi sampai angkanya bisa diandalkan, dan sebelum itu ratingmu bisa bergerak jauh hanya dalam satu malam. Itu rating yang sedang mencari levelmu, bukan kamu yang tiba-tiba membaik atau memburuk.",
            "Ini tidak ada hubungannya dengan sebagus apa permainanmu — menang terus atau kalah terus sama-sama butuh tiga sesi.",
          ],
        },
      },
      {
        key: "record",
        q: { en: "What does my record show?", id: "Apa isi rekorku?" },
        a: {
          en: [
            "Your wins, losses and draws across every finished game you've played, in every session, plus the win rate those add up to.",
            "Recent form is your last five results, newest first, so you can see whether you're on a run.",
          ],
          id: [
            "Jumlah menang, kalah, dan seri dari setiap game yang sudah selesai kamu mainkan, di semua sesi, beserta persentase kemenangan yang dihasilkan.",
            "Form terkini adalah lima hasil terakhirmu, dari yang terbaru, jadi kamu bisa melihat apakah sedang dalam tren bagus.",
          ],
        },
      },
      {
        key: "partners-rivals",
        q: { en: "What are best partner and toughest rival?", id: "Apa itu partner terbaik dan lawan terberat?" },
        a: {
          en: [
            "Best partner is the person you win most often alongside. Toughest rival is the opponent who beats you most often. Both need a few games together before they mean anything.",
            "These appear only on your own profile, never on the public one. They describe another player's record as much as yours, and that isn't ours to publish about someone who didn't ask for it.",
          ],
          id: [
            "Partner terbaik adalah orang yang paling sering menang bersamamu. Lawan terberat adalah lawan yang paling sering mengalahkanmu. Keduanya butuh beberapa game dulu sebelum berarti.",
            "Keduanya hanya muncul di profilmu sendiri, tidak pernah di profil publik. Informasi ini juga menggambarkan rekor pemain lain, dan itu bukan hak kami untuk menampilkannya tentang orang yang tidak memintanya.",
          ],
        },
      },
      {
        key: "public-profile",
        q: { en: "What can other people see about me?", id: "Apa yang bisa dilihat orang lain tentangku?" },
        a: {
          en: [
            "Your public profile shows your name, photo, the short line you write about yourself, your rating and its label, your all-time record, recent form, rating trend, and the clubs you belong to.",
            "It does not show your email, your best partner or toughest rival, or any detail of individual matches. A profile link can be opened by anyone, including people without an account.",
          ],
          id: [
            "Profil publikmu menampilkan nama, foto, kalimat singkat yang kamu tulis tentang dirimu, rating beserta labelnya, rekor sepanjang masa, form terkini, tren rating, dan klub yang kamu ikuti.",
            "Profil publik tidak menampilkan emailmu, partner terbaik atau lawan terberatmu, maupun detail pertandingan satu per satu. Tautan profil bisa dibuka siapa saja, termasuk orang tanpa akun.",
          ],
        },
      },
      {
        key: "settings",
        q: { en: "Where do I change my name, photo or password?", id: "Di mana aku bisa mengubah nama, foto, atau kata sandi?" },
        a: {
          en: [
            "All of it lives behind the gear on your profile — name, photo, the line about yourself, your preferred side of the court, and your password.",
            "Your preferred side and gender are used only to build fairer draws in the formats that need them.",
          ],
          id: [
            "Semuanya ada di balik ikon gerigi di profilmu — nama, foto, kalimat tentang dirimu, sisi lapangan yang kamu sukai, dan kata sandi.",
            "Sisi lapangan dan jenis kelamin hanya dipakai untuk menyusun undian yang lebih adil pada format yang membutuhkannya.",
          ],
        },
      },
    ],
  },

  // ────────────────────────────────────────── When something goes wrong ──
  // Public on purpose, like the rest of this page: the person who most needs
  // to read "what does this code mean" is the one looking at an error, and
  // they may not even be signed in when they see it.
  {
    key: "trouble",
    title: { en: "When something goes wrong", id: "Kalau ada yang tidak beres" },
    blurb: {
      en: "What happens to your scores when the signal drops. (Error codes have their own page — see Settings.)",
      id: "Apa yang terjadi pada skormu saat sinyal hilang. (Kode error punya halaman sendiri — lihat Pengaturan.)",
    },
    entries: [
      {
        key: "offline",
        q: { en: "What happens to scores if the signal drops mid-session?", id: "Apa yang terjadi pada skor kalau sinyal hilang di tengah sesi?" },
        a: {
          en: [
            "Nothing is lost. A score you enter is saved on the phone first and shown immediately, then sent up on its own as soon as there's signal \u2014 including after you close the app and come back.",
            "Formats that draw every round at the start \u2014 Americano, Fixed Position, Fixed Partner and Mix Americano \u2014 can be played through from beginning to end with no connection at all. The Mexicano formats need a moment of signal between rounds, because the next pairing is worked out from the scores just played.",
          ],
          id: [
            "Tidak ada yang hilang. Skor yang kamu masukkan disimpan dulu di ponsel dan langsung tampil, lalu dikirim sendiri begitu ada sinyal \u2014 termasuk setelah aplikasi ditutup dan dibuka lagi.",
            "Format yang menyusun semua ronde di awal \u2014 Americano, Fixed Position, Fixed Partner, dan Mix Americano \u2014 bisa dimainkan dari awal sampai akhir tanpa koneksi sama sekali. Format Mexicano butuh sinyal sebentar di antara ronde, karena pasangan berikutnya dihitung dari skor yang baru saja dimainkan.",
          ],
        },
      },
    ],
  },
];

export const UI: Record<Lang, Record<string, string>> = {
  en: {
    title: "About Padelier",
    intro: "How everything works — the formats, the scoring, clubs, and your rating.",
    contact: "Still stuck? Email us and a human will answer.",
    other: "Bahasa Indonesia",
  },
  id: {
    title: "Tentang Padelier",
    intro: "Cara kerja semuanya — format, penilaian, klub, dan ratingmu.",
    contact: "Masih bingung? Kirim email dan akan dijawab langsung oleh kami.",
    other: "English",
  },
};

export const CONTACT_EMAIL = "info@padelier.id";
