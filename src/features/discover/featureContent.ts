import { Lang } from "../about/aboutContent";
import { PosterKind } from "./FeaturePoster";

/**
 * One entry per feature. The pages are generated from this, so adding a
 * feature is content, not code.
 *
 * These are PUBLIC and shareable: a host pastes one into a group chat to
 * explain a format before anyone has an account, and the CTA at the bottom is
 * then the way in. That shapes the writing — no "tap Settings", no assumed
 * account, no jargon from inside the app.
 *
 * Every entry earns its place by answering four things in order: what it is,
 * how a round actually works, who it suits, and — honestly — who it doesn't.
 * The last one is why these read as useful rather than as marketing. If a
 * feature has no caveat worth writing, that's usually a sign I haven't
 * understood it well enough yet.
 *
 * The facts here are the same facts as /about. Where the two disagree, /about
 * wins and this file is the bug.
 */

export interface Feature {
  slug: string;
  family: "format" | "scoring" | "club" | "you" | "together";
  poster: PosterKind;
  name: Record<Lang, string>;
  /** One line, under the title. The promise, not a description. */
  promise: Record<Lang, string>;
  what: Record<Lang, string[]>;
  /** How a round / the thing actually works, in order. */
  steps: Record<Lang, string[]>;
  bestFor: Record<Lang, string[]>;
  /** The honest caveat. Optional only because a few features have none. */
  notFor?: Record<Lang, string>;
  cta: { label: Record<Lang, string>; to: string };
  /** Shown under the CTA when the action needs saying out loud. */
  ctaNote?: Record<Lang, string>;
}

const NEEDS_ACCOUNT: Record<Lang, string> = {
  en: "You'll need an account to host — it takes an email and a password.",
  id: "Untuk menjadi host kamu perlu akun — cukup email dan kata sandi.",
};

export const FEATURES: Feature[] = [
  // ────────────────────────────────────────────────────────────── format ──
  {
    slug: "americano",
    family: "format",
    poster: "rotation",
    name: { en: "Americano", id: "Americano" },
    promise: {
      en: "You partner everyone in the room, one round at a time. The fairest way to play a group whose levels don't match.",
      id: "Kamu berpasangan dengan semua orang, satu ronde satu partner. Cara paling adil untuk kelompok dengan level berbeda-beda.",
    },
    what: {
      en: [
        "Americano is an individual format. Your partner changes almost every round, your opponents change with them, and the points you score are yours alone.",
        "The whole schedule is drawn before the first ball, aiming for the classic ideal: everyone partners everyone exactly once. You don't have to guess how many rounds that takes — the app works it out from the number of players and courts you have.",
      ],
      id: [
        "Americano adalah format individu. Partnermu berganti hampir setiap ronde, lawanmu ikut berganti, dan poin yang kamu kumpulkan sepenuhnya milikmu.",
        "Seluruh jadwal disusun sebelum bola pertama, dengan target ideal klasik: setiap orang berpasangan dengan semua orang tepat satu kali. Kamu tidak perlu menebak berapa ronde yang dibutuhkan — aplikasi menghitungnya dari jumlah pemain dan lapangan.",
      ],
    },
    steps: {
      en: [
        "Add the players and the courts. The app proposes the number of rounds that gets full partner coverage.",
        "Each round it names the pairs and the court they're on — no one has to remember whose turn it is.",
        "You enter each court's score as it finishes.",
        "Anyone sitting out is credited neutral points for that round, so resting never costs you a place.",
      ],
      id: [
        "Tambahkan pemain dan lapangan. Aplikasi mengusulkan jumlah ronde agar semua orang sempat berpasangan.",
        "Setiap ronde aplikasi menyebutkan pasangan dan lapangannya — tidak ada yang perlu mengingat siapa yang giliran.",
        "Kamu memasukkan skor setiap lapangan begitu selesai.",
        "Pemain yang beristirahat mendapat poin netral untuk ronde itu, jadi istirahat tidak pernah merugikan posisimu.",
      ],
    },
    bestFor: {
      en: [
        "A group meeting for the first time, where nobody knows who's good",
        "Social nights where playing with everyone matters more than winning",
        "Any number from four up — eight to sixteen is the sweet spot",
      ],
      id: [
        "Kelompok yang baru pertama kali bermain bersama, saat belum ada yang tahu siapa jago",
        "Malam santai, di mana bermain dengan semua orang lebih penting daripada menang",
        "Mulai dari empat pemain — delapan sampai enam belas paling ideal",
      ],
    },
    notFor: {
      en: "Americano doesn't chase the leaders. Because every round is drawn before the session starts, the last fixture is whatever the schedule always said it would be — the top two may never meet. If you want the night to tighten as it goes, that's Mexicano.",
      id: "Americano tidak mengejar pemuncak klasemen. Karena semua ronde disusun sebelum sesi dimulai, pertandingan terakhir sudah ditentukan sejak awal — dua pemain teratas bisa jadi tidak pernah bertemu. Kalau kamu ingin malamnya makin ketat, pilih Mexicano.",
    },
    cta: {
      label: { en: "Start an Americano session", id: "Mulai sesi Americano" },
      to: "/create?format=americano",
    },
    ctaNote: NEEDS_ACCOUNT,
  },

  {
    slug: "mexicano",
    family: "format",
    poster: "rank",
    name: { en: "Mexicano", id: "Mexicano" },
    promise: {
      en: "Every round pairs you by how you're doing, so the games get closer as the night goes on.",
      id: "Setiap ronde memasangkan pemain sesuai performa, jadi pertandingan makin ketat sepanjang malam.",
    },
    what: {
      en: [
        "Mexicano is an individual format: you play with a different partner almost every round, and your points are your own.",
        "What makes it Mexicano is where the pairings come from. After each round the app re-ranks everyone by points, then builds the next round from that order — first with fourth against second with third. The leader gets the weakest partner and the toughest opponents, which is exactly what keeps a mixed-ability group honest.",
      ],
      id: [
        "Mexicano adalah format individu: kamu bermain dengan partner berbeda hampir setiap ronde, dan poin yang kamu kumpulkan milikmu sendiri.",
        "Yang membuatnya Mexicano adalah asal pasangannya. Setelah tiap ronde, aplikasi menyusun ulang peringkat berdasarkan poin, lalu membentuk ronde berikutnya dari urutan itu — peringkat 1 dengan 4 melawan 2 dengan 3. Pemimpin klasemen mendapat partner terlemah dan lawan terberat, dan justru itu yang membuat kelompok dengan level campur tetap seimbang.",
      ],
    },
    steps: {
      en: [
        "Round one is drawn from the order players were added — there are no standings yet to sort by.",
        "You enter each court's score as the round finishes.",
        "The app re-ranks everyone and draws the next round: 1+4 against 2+3 on the top court, 5+8 against 6+7 on the next, and so on.",
        "Anyone sitting out is credited the neutral score for that round, so resting never costs you your place.",
      ],
      id: [
        "Ronde pertama disusun dari urutan pemain ditambahkan — belum ada klasemen untuk diurutkan.",
        "Kamu memasukkan skor setiap lapangan begitu rondenya selesai.",
        "Aplikasi menyusun ulang peringkat dan membentuk ronde berikutnya: 1+4 melawan 2+3 di lapangan teratas, 5+8 melawan 6+7 di lapangan berikutnya, dan seterusnya.",
        "Pemain yang beristirahat mendapat skor netral untuk ronde itu, jadi istirahat tidak pernah merugikan posisimu.",
      ],
    },
    bestFor: {
      en: [
        "A group whose levels are all over the place",
        "Nights where you want the last round to matter",
        "Eight or more players, so the ranking has something to work with",
      ],
      id: [
        "Kelompok dengan level yang beragam",
        "Malam di mana kamu ingin ronde terakhir tetap menentukan",
        "Delapan pemain atau lebih, agar peringkatnya punya bahan",
      ],
    },
    notFor: {
      en: "Mexicano works out the next pairing from the scores just played, so it needs a moment of signal between rounds. On a court with no bars at all, pick Americano or Fixed Position — those draw every round up front.",
      id: "Mexicano menghitung pasangan berikutnya dari skor yang baru dimainkan, jadi butuh sinyal sebentar di antara ronde. Kalau di lapangan sama sekali tidak ada sinyal, pilih Americano atau Fixed Position — keduanya menyusun semua ronde di awal.",
    },
    cta: {
      label: { en: "Start a Mexicano session", id: "Mulai sesi Mexicano" },
      to: "/create?format=mexicano",
    },
    ctaNote: {
      en: "Opens the setup with Mexicano already chosen — you add the players and courts.",
      id: "Membuka pengaturan dengan Mexicano sudah dipilih — kamu tinggal menambahkan pemain dan lapangan.",
    },
  },

  {
    slug: "mix-americano",
    family: "format",
    poster: "mixed",
    name: { en: "Mix Americano", id: "Mix Americano" },
    promise: {
      en: "Americano, with every pair one man and one woman. Rotation does the rest.",
      id: "Americano, dengan setiap pasangan terdiri dari satu pria dan satu wanita. Sisanya diatur oleh rotasi.",
    },
    what: {
      en: [
        "Same idea as Americano — individual points, partners rotating round by round — with one rule added: every team on court is one man and one woman.",
        "That single rule changes the evening more than it sounds like it should. Nobody can hide behind a strong same-gender pairing, and the mixed group that usually splits into two separate sessions stays one session.",
      ],
      id: [
        "Idenya sama dengan Americano — poin individu, partner berotasi tiap ronde — dengan satu aturan tambahan: setiap tim di lapangan terdiri dari satu pria dan satu wanita.",
        "Satu aturan itu mengubah suasana lebih besar dari yang terdengar. Tidak ada yang bisa bersembunyi di balik pasangan sejenis yang kuat, dan kelompok campur yang biasanya terpecah menjadi dua sesi terpisah tetap jadi satu sesi.",
      ],
    },
    steps: {
      en: [
        "Add the players. Each one is marked as a man or a woman — from their profile if they have one, or by you as you type the name in.",
        "The app draws the whole schedule so that every pair on court is mixed.",
        "Partners rotate each round; your points are still your own.",
        "Rests are spread as evenly as the numbers allow, and topped up with neutral points.",
      ],
      id: [
        "Tambahkan pemain. Masing-masing ditandai pria atau wanita — dari profilnya kalau sudah punya, atau olehmu saat memasukkan nama.",
        "Aplikasi menyusun seluruh jadwal agar setiap pasangan di lapangan selalu campur.",
        "Partner berotasi tiap ronde; poinmu tetap milikmu sendiri.",
        "Giliran istirahat dibagi serata mungkin sesuai jumlah pemain, dan diberi tambahan poin netral.",
      ],
    },
    bestFor: {
      en: [
        "Couples nights and family groups",
        "Clubs where the men and women usually book separately",
        "A roughly even split — four men and four women, six and six, eight and eight",
      ],
      id: [
        "Malam pasangan dan kelompok keluarga",
        "Klub yang biasanya memesan lapangan terpisah antara pria dan wanita",
        "Jumlah yang kurang lebih seimbang — empat pria empat wanita, enam-enam, delapan-delapan",
      ],
    },
    notFor: {
      en: "A lopsided group. If eight men turn up with four women, every pair still has to be mixed, so the four women are on court far more often than the men — the app spreads it as evenly as the arithmetic allows, but no draw can make that equal. With a split like that, plain Americano is kinder to everyone.",
      id: "Kelompok yang jumlahnya tidak seimbang. Kalau datang delapan pria dan empat wanita, setiap pasangan tetap harus campur, sehingga keempat wanita jauh lebih sering bermain daripada para pria — aplikasi membaginya serata mungkin, tetapi tidak ada undian yang bisa membuatnya benar-benar sama. Dengan komposisi seperti itu, Americano biasa lebih nyaman untuk semua.",
    },
    cta: {
      label: { en: "Start a Mix Americano session", id: "Mulai sesi Mix Americano" },
      to: "/create?format=mix_americano",
    },
    ctaNote: NEEDS_ACCOUNT,
  },

  {
    slug: "mix-mexicano",
    family: "format",
    poster: "mixed",
    name: { en: "Mix Mexicano", id: "Mix Mexicano" },
    promise: {
      en: "Mixed pairs, drawn from the standings. The competitive version of a mixed night.",
      id: "Pasangan campur, disusun dari klasemen. Versi kompetitif dari malam campur.",
    },
    what: {
      en: [
        "Both ideas at once: the pairing comes from where everyone currently sits in the standings, and each pair is one man and one woman.",
        "The two rules can pull against each other. The app starts from the ranking order and mixes wherever the numbers allow it; where a mixed pair simply isn't available it takes the closest ranked alternative rather than stalling the round.",
      ],
      id: [
        "Dua ide sekaligus: pasangan ditentukan dari posisi klasemen saat itu, dan setiap pasangan terdiri dari satu pria dan satu wanita.",
        "Dua aturan itu bisa saling bertarik. Aplikasi mulai dari urutan peringkat dan mencampur selama jumlahnya memungkinkan; kalau pasangan campur benar-benar tidak tersedia, aplikasi mengambil alternatif peringkat terdekat daripada menghentikan ronde.",
      ],
    },
    steps: {
      en: [
        "Round one comes from the order players were added — there are no standings yet.",
        "You enter the scores as each court finishes.",
        "The app re-ranks everyone, then builds the next round from that order, mixing each pair where the numbers allow.",
        "Rests are spread evenly and credited with neutral points.",
      ],
      id: [
        "Ronde pertama berasal dari urutan pemain ditambahkan — belum ada klasemen.",
        "Kamu memasukkan skor begitu setiap lapangan selesai.",
        "Aplikasi menyusun ulang peringkat, lalu membentuk ronde berikutnya dari urutan itu, mencampur setiap pasangan selama jumlahnya memungkinkan.",
        "Giliran istirahat dibagi rata dan diberi poin netral.",
      ],
    },
    bestFor: {
      en: [
        "A mixed group that already knows each other's level",
        "Club nights with a table at stake",
        "An even split of men and women, eight players or more",
      ],
      id: [
        "Kelompok campur yang sudah saling tahu levelnya",
        "Malam klub dengan klasemen yang dipertaruhkan",
        "Jumlah pria dan wanita seimbang, delapan pemain atau lebih",
      ],
    },
    notFor: {
      en: "It asks for two things at once, so it needs both to be available: a moment of signal between rounds, because the next pairing is computed from the scores just played, and a reasonably even split of men and women. Missing either one, pick Mix Americano (no signal needed) or Mexicano (no mixing needed).",
      id: "Format ini menuntut dua hal sekaligus, jadi keduanya harus tersedia: sinyal sebentar di antara ronde, karena pasangan berikutnya dihitung dari skor yang baru dimainkan, dan komposisi pria-wanita yang cukup seimbang. Kalau salah satunya tidak ada, pilih Mix Americano (tanpa perlu sinyal) atau Mexicano (tanpa perlu campur).",
    },
    cta: {
      label: { en: "Start a Mix Mexicano session", id: "Mulai sesi Mix Mexicano" },
      to: "/create?format=mix_mexicano",
    },
    ctaNote: NEEDS_ACCOUNT,
  },

  {
    slug: "fixed-position",
    family: "format",
    poster: "sides",
    name: { en: "Fixed Position", id: "Fixed Position" },
    promise: {
      en: "You stay on your side of the court all night. Every pair is one left and one right.",
      id: "Kamu tetap di sisi lapanganmu sepanjang malam. Setiap pasangan terdiri dari satu kiri dan satu kanan.",
    },
    what: {
      en: [
        "Americano's rotation, with one constraint: you always play the side you prefer, and every pair is built from one left-side player and one right-side player.",
        "For anyone who has spent a season learning to cover the backhand corner, this is the difference between a social night and a useful one — you rotate through partners without ever having to relearn the court.",
      ],
      id: [
        "Rotasi Americano, dengan satu batasan: kamu selalu bermain di sisi yang kamu pilih, dan setiap pasangan dibentuk dari satu pemain sisi kiri dan satu pemain sisi kanan.",
        "Bagi siapa pun yang sudah lama berlatih menutup sudut backhand, ini yang membedakan malam santai dengan malam yang berguna — kamu tetap berganti partner tanpa harus belajar ulang posisi di lapangan.",
      ],
    },
    steps: {
      en: [
        "Each player has a preferred side — left or right — set on their profile, or chosen as you add them.",
        "The app draws every round up front, pairing a left with a right each time.",
        "Partners and opponents change; your side doesn't.",
        "Rests are spread evenly and topped up with neutral points, exactly as in Americano.",
      ],
      id: [
        "Setiap pemain punya sisi favorit — kiri atau kanan — diatur di profilnya, atau dipilih saat kamu menambahkannya.",
        "Aplikasi menyusun semua ronde di awal, setiap kali memasangkan satu kiri dengan satu kanan.",
        "Partner dan lawan berganti; sisimu tidak.",
        "Giliran istirahat dibagi rata dan diberi poin netral, sama seperti Americano.",
      ],
    },
    bestFor: {
      en: [
        "Players who have a real side and know it",
        "Coaching nights and drills where position matters",
        "A group with a reasonable balance of lefts and rights",
      ],
      id: [
        "Pemain yang benar-benar punya sisi dan menyadarinya",
        "Sesi latihan atau drill di mana posisi itu penting",
        "Kelompok dengan komposisi kiri dan kanan yang cukup seimbang",
      ],
    },
    notFor: {
      en: "A group where almost everyone wants the same side. Pairs need one of each, so if ten players out of twelve prefer the right there simply aren't enough pairs to build and somebody ends up playing their weaker side anyway. Plain Americano ignores sides entirely and will feel less arbitrary.",
      id: "Kelompok yang hampir semuanya ingin sisi yang sama. Pasangan butuh satu dari masing-masing sisi, jadi kalau sepuluh dari dua belas pemain memilih kanan, pasangan yang bisa dibentuk tidak cukup dan tetap ada yang harus bermain di sisi lemahnya. Americano biasa sama sekali tidak mempermasalahkan sisi, dan akan terasa lebih wajar.",
    },
    cta: {
      label: { en: "Start a Fixed Position session", id: "Mulai sesi Fixed Position" },
      to: "/create?format=side_americano",
    },
    ctaNote: NEEDS_ACCOUNT,
  },

  {
    slug: "fixed-partner",
    family: "format",
    poster: "pair",
    name: { en: "Fixed Partner", id: "Fixed Partner" },
    promise: {
      en: "You and your partner stay together all night, and you're ranked as one.",
      id: "Kamu dan partnermu tetap bersama sepanjang malam, dan dinilai sebagai satu kesatuan.",
    },
    what: {
      en: [
        "Fixed Partner isn't a separate format so much as a switch you put on top of one. Turn it on with Americano and the pairs rotate through opponents in a round-robin; turn it on with Mexicano and the standings decide who you face next.",
        "Either way the pair is the unit that gets ranked. Wins, points and position on the board belong to the two of you together — which is the whole point, because playing with the same person all evening is how a partnership actually gets better.",
      ],
      id: [
        "Fixed Partner bukan format tersendiri, lebih seperti sakelar yang kamu nyalakan di atas format lain. Nyalakan bersama Americano dan pasangan berotasi melawan semua lawan; nyalakan bersama Mexicano dan klasemen yang menentukan lawan berikutnya.",
        "Bagaimanapun, pasangan adalah unit yang diberi peringkat. Kemenangan, poin, dan posisi di papan milik kalian berdua — dan itulah intinya, karena bermain dengan orang yang sama sepanjang malam adalah cara sebuah pasangan benar-benar berkembang.",
      ],
    },
    steps: {
      en: [
        "Choose Americano or Mexicano, and switch Fixed Partner on.",
        "Set the pairs yourself — who plays with whom is your call, not the app's.",
        "Every round, only the opponents change. Your partner doesn't.",
        "The standings list pairs rather than individuals, and the pair's result is what counts.",
      ],
      id: [
        "Pilih Americano atau Mexicano, lalu nyalakan Fixed Partner.",
        "Tentukan pasangannya sendiri — siapa dengan siapa adalah keputusanmu, bukan aplikasi.",
        "Setiap ronde, hanya lawan yang berganti. Partnermu tidak.",
        "Klasemen memuat pasangan, bukan individu, dan hasil pasangan itulah yang dihitung.",
      ],
    },
    bestFor: {
      en: [
        "Couples, siblings, and anyone with a regular partner",
        "Practice nights before a tournament you're entering as a pair",
        "An even number of pairs who are all staying to the end",
      ],
      id: [
        "Pasangan, saudara, dan siapa pun yang punya partner tetap",
        "Malam latihan sebelum turnamen yang kamu ikuti sebagai pasangan",
        "Jumlah pasangan yang genap dan semuanya bertahan sampai akhir",
      ],
    },
    notFor: {
      en: "A night where people drift in and out. A pair is only as available as both halves of it — when one person goes home early the other has nobody to rotate with, and there's no way to re-pair them without breaking someone else's partnership too. If arrivals are unpredictable, use plain Americano and let the draw absorb it.",
      id: "Malam di mana orang datang dan pergi tidak tentu. Sebuah pasangan hanya ada selama kedua orangnya ada — begitu satu orang pulang lebih awal, yang lain tidak punya siapa pun untuk berotasi, dan tidak ada cara memasangkannya lagi tanpa membongkar pasangan orang lain. Kalau kehadiran belum pasti, gunakan Americano biasa dan biarkan undiannya menyesuaikan.",
    },
    cta: {
      label: { en: "Start a Fixed Partner session", id: "Mulai sesi Fixed Partner" },
      to: "/create?format=americano&fp=1",
    },
    ctaNote: {
      en: "Opens the setup with Americano and Fixed Partner on. Switch to Mexicano on the Format step if you'd rather the standings pick your opponents.",
      id: "Membuka pengaturan dengan Americano dan Fixed Partner aktif. Ganti ke Mexicano di langkah Format kalau kamu ingin klasemen yang memilih lawanmu.",
    },
  },

  {
    slug: "team-sparring",
    family: "format",
    poster: "teams",
    name: { en: "Team Sparring", id: "Team Sparring" },
    promise: {
      en: "Two sides, one running score. Club against club, floor against floor, us against them.",
      id: "Dua kubu, satu skor berjalan. Klub lawan klub, kantor lawan kantor, kami lawan mereka.",
    },
    what: {
      en: [
        "Every player belongs to Team A or Team B, and every match on every court is A against B. Nobody has a personal position to protect: one number goes up, and it belongs to a side.",
        "How that number moves is yours to choose. Sparring by point adds up every player's scored points, so a side can win the night on aggregate — 88–60. Sparring by win adds one for each court a side takes — 5–3. Sparring by round adds one to whichever side wins the majority of courts in a round, which makes each round a small decisive contest of its own.",
      ],
      id: [
        "Setiap pemain masuk Tim A atau Tim B, dan setiap pertandingan di setiap lapangan adalah A melawan B. Tidak ada posisi pribadi yang perlu dijaga: satu angka naik, dan angka itu milik satu kubu.",
        "Bagaimana angka itu bergerak, kamu yang menentukan. Sparring by Point menjumlahkan seluruh poin yang dicetak para pemain, jadi satu kubu bisa menang secara agregat — 88–60. Sparring by Win menambah satu untuk setiap lapangan yang dimenangkan — 5–3. Sparring by Round menambah satu bagi kubu yang menang di mayoritas lapangan dalam satu ronde, sehingga setiap ronde menjadi pertarungan kecil yang menentukan.",
      ],
    },
    steps: {
      en: [
        "Name the two sides and put every player on one of them.",
        "Choose how a result counts: by point, by win, or by round.",
        "Each round pairs A players against B players across the courts.",
        "You enter the scores as courts finish, and the side totals move with them.",
      ],
      id: [
        "Beri nama kedua kubu dan masukkan setiap pemain ke salah satunya.",
        "Pilih cara hasil dihitung: by point, by win, atau by round.",
        "Setiap ronde memasangkan pemain A melawan pemain B di seluruh lapangan.",
        "Kamu memasukkan skor begitu lapangan selesai, dan total kedua kubu bergerak mengikutinya.",
      ],
    },
    bestFor: {
      en: [
        "Two clubs meeting, or one club split in half",
        "Company and community events where the team matters more than the table",
        "Any group that wants one scoreline to talk about afterwards",
      ],
      id: [
        "Dua klub yang bertemu, atau satu klub yang dibagi dua",
        "Acara kantor atau komunitas di mana tim lebih penting daripada klasemen",
        "Kelompok yang ingin punya satu skor akhir untuk dibicarakan setelahnya",
      ],
    },
    notFor: {
      en: "Sparring by round needs an odd number of courts — three, five, seven — so every round has a decisive winner. On two courts a round can finish one-all and nothing moves at all. With an even number of courts, count by point or by win instead.",
      id: "Sparring by Round butuh jumlah lapangan ganjil — tiga, lima, tujuh — agar setiap ronde punya pemenang jelas. Dengan dua lapangan, satu ronde bisa berakhir 1-1 dan tidak ada yang bergerak. Kalau jumlah lapanganmu genap, gunakan by point atau by win.",
    },
    cta: {
      label: { en: "Start a Team Sparring session", id: "Mulai sesi Team Sparring" },
      to: "/create?format=team_sparring",
    },
    ctaNote: NEEDS_ACCOUNT,
  },

  // ───────────────────────────────────────────────────────────── scoring ──
  {
    slug: "scoring-formats",
    family: "scoring",
    poster: "target",
    name: { en: "Scoring formats", id: "Format penilaian" },
    promise: {
      en: "Decide once how a game ends, and every court plays the same way all night.",
      id: "Tentukan sekali bagaimana satu game berakhir, dan semua lapangan bermain dengan cara yang sama sepanjang malam.",
    },
    what: {
      en: [
        "There are five to choose from: points to 21, a fixed four games, a fixed five games, first to four, and first to six.",
        "The fixed formats share a useful property — both scores always add up to the target. Enter one side's score and the other fills itself in, which matters more than it sounds like when you're standing on a windy court with a phone in one hand. The race formats end the moment a side reaches the target, so the two scores don't add up to anything in particular and you enter both.",
      ],
      id: [
        "Ada lima pilihan: poin sampai 21, empat game tetap, lima game tetap, race ke 4, dan race ke 6.",
        "Format tetap punya satu sifat yang berguna — kedua skor selalu berjumlah sama dengan targetnya. Masukkan skor satu sisi dan sisi lainnya terisi sendiri, dan itu jauh lebih berarti saat kamu berdiri di lapangan berangin dengan ponsel di satu tangan. Format race berakhir begitu satu sisi mencapai target, jadi kedua skor tidak berjumlah angka tertentu dan kamu memasukkan keduanya.",
      ],
    },
    steps: {
      en: [
        "You choose the format on the Points step, once, when you set the session up.",
        "It applies to every court and every round from then on.",
        "In a fixed format, typing one score fills in the other — one number per match.",
        "In a race format, you enter both scores, and the match ends when a side hits the target.",
      ],
      id: [
        "Kamu memilih formatnya di langkah Points, sekali saja, saat menyiapkan sesi.",
        "Format itu berlaku untuk semua lapangan dan semua ronde setelahnya.",
        "Pada format tetap, mengisi satu skor otomatis mengisi skor lainnya — satu angka per pertandingan.",
        "Pada format race, kamu memasukkan kedua skor, dan pertandingan berakhir saat satu sisi mencapai target.",
      ],
    },
    bestFor: {
      en: [
        "Points to 21 — a lot of players, short rounds, everyone gets on court",
        "Four or five games — a night that should feel like real padel",
        "Race to 4 or 6 — when court time is booked to the minute and rounds must not overrun",
      ],
      id: [
        "Poin sampai 21 — banyak pemain, ronde singkat, semua kebagian lapangan",
        "Empat atau lima game — malam yang harus terasa seperti padel sungguhan",
        "Race ke 4 atau 6 — saat waktu lapangan dihitung ketat dan ronde tidak boleh melebar",
      ],
    },
    notFor: {
      en: "One format covers the whole session — it isn't chosen per round or per court. That's deliberate: standings built from games of different lengths wouldn't mean anything, so the choice is made once and held.",
      id: "Satu format berlaku untuk seluruh sesi — tidak dipilih per ronde atau per lapangan. Ini memang disengaja: klasemen yang dibangun dari game dengan panjang berbeda tidak akan berarti apa-apa, jadi pilihannya dibuat sekali lalu dipegang.",
    },
    cta: {
      label: { en: "Set up a session", id: "Siapkan sebuah sesi" },
      to: "/create",
    },
    ctaNote: {
      en: "The scoring format is the Points step, after the players and the courts.",
      id: "Format penilaian ada di langkah Points, setelah pemain dan lapangan.",
    },
  },

  {
    slug: "ranking-basis",
    family: "scoring",
    poster: "scale",
    name: { en: "How the board is ordered", id: "Cara papan diurutkan" },
    promise: {
      en: "Points first or wins first — you pick. And sitting out never costs you a place.",
      id: "Poin dulu atau menang dulu — kamu yang pilih. Dan istirahat tidak pernah merugikan posisimu.",
    },
    what: {
      en: [
        "Two rules, and the host chooses between them before the first round. Points first orders the board by total points scored, with wins breaking ties. Wins first orders by number of wins, with points breaking ties.",
        "It isn't a cosmetic setting. Points first rewards playing well in a game you're losing 15–6, because those six points still count. Wins first rewards closing games out and treats a narrow win exactly like a thrashing. Both are defensible; they just produce different evenings, and people play differently once they know which one is running.",
        "Underneath either rule sits the same fairness rule: nobody is punished for the rounds they didn't play. For every game you played fewer than the busiest player in the field, you're credited half the game's target as neutral points — ten points in a session played to 21. It's points only. No wins or losses are invented for games you never played, so your record stays honest even while the board stays fair.",
      ],
      id: [
        "Ada dua aturan, dan host memilih salah satunya sebelum ronde pertama. Poin dulu mengurutkan papan berdasarkan total poin, dengan jumlah kemenangan sebagai penentu jika seri. Menang dulu mengurutkan berdasarkan jumlah kemenangan, dengan poin sebagai penentu.",
        "Ini bukan pengaturan kosmetik. Poin dulu menghargai permainan bagus meski kamu kalah 15–6, karena enam poin itu tetap dihitung. Menang dulu menghargai kemampuan menutup pertandingan dan menganggap kemenangan tipis sama saja dengan kemenangan besar. Keduanya masuk akal; keduanya hanya menghasilkan malam yang berbeda, dan orang bermain berbeda begitu tahu aturan mana yang dipakai.",
        "Di bawah kedua aturan itu berlaku prinsip keadilan yang sama: tidak ada yang dirugikan karena ronde yang tidak ia mainkan. Untuk setiap game yang kamu mainkan lebih sedikit dibanding pemain tersibuk di sesi itu, kamu mendapat setengah target game sebagai poin netral — sepuluh poin pada sesi sampai 21. Ini hanya poin. Tidak ada kemenangan atau kekalahan yang dibuat-buat untuk game yang tidak kamu mainkan, jadi rekormu tetap jujur sementara papan tetap adil.",
      ],
    },
    steps: {
      en: [
        "The host picks points first or wins first when setting the session up.",
        "The board orders by that rule, with the other measure as the tie-breaker.",
        "Anyone who played fewer games than the busiest player is topped up: half the target per missed game.",
        "Their win-loss record is left untouched — the top-up is points, not results.",
      ],
      id: [
        "Host memilih poin dulu atau menang dulu saat menyiapkan sesi.",
        "Papan diurutkan dengan aturan itu, dan ukuran lainnya menjadi penentu jika seri.",
        "Siapa pun yang bermain lebih sedikit dari pemain tersibuk mendapat tambahan: setengah target per game yang terlewat.",
        "Rekor menang-kalahnya tidak diubah — tambahan itu berupa poin, bukan hasil pertandingan.",
      ],
    },
    bestFor: {
      en: [
        "Points first — mixed groups, and nights where more players than court spots means a lot of resting",
        "Wins first — competitive club nights where the result is the result",
        "Anyone who has ever argued about the leaderboard afterwards: say the rule out loud first",
      ],
      id: [
        "Poin dulu — kelompok campur, dan malam di mana pemain lebih banyak dari tempat di lapangan sehingga banyak yang beristirahat",
        "Menang dulu — malam klub kompetitif di mana hasil adalah hasil",
        "Siapa pun yang pernah berdebat soal papan peringkat setelah selesai: sebutkan aturannya lebih dulu",
      ],
    },
    notFor: {
      en: "Neither rule is the correct one, and the app won't pick for you. The host can also switch it mid-session, which re-sorts the board under everyone — occasionally the right call, never a quiet one. Say which rule is running before the first round: both change what a sensible player does in the last five points of a game.",
      id: "Tidak ada aturan yang lebih benar, dan aplikasi tidak akan memilih untukmu. Host juga bisa menggantinya di tengah sesi, dan itu mengurutkan ulang papan untuk semua orang — kadang memang perlu, tetapi jangan pernah dilakukan diam-diam. Sampaikan aturan mana yang dipakai sebelum ronde pertama: keduanya mengubah apa yang masuk akal dilakukan pemain di lima poin terakhir sebuah game.",
    },
    cta: {
      label: { en: "Set up a session", id: "Siapkan sebuah sesi" },
      to: "/create",
    },
  },

  // ──────────────────────────────────────────────────────────────── club ──
  {
    slug: "clubs",
    family: "club",
    poster: "crest",
    name: { en: "Clubs", id: "Klub" },
    promise: {
      en: "Turn a group that plays together into something with a table, a history and a name.",
      id: "Ubah sekelompok orang yang rutin bermain menjadi sesuatu yang punya tabel, riwayat, dan nama.",
    },
    what: {
      en: [
        "A club is the people you play with regularly. Anyone can start one in a few seconds, and it comes with a six-character code you can read out or paste into a group chat.",
        "Sessions you play as a club stack up: a league table for the period, a Champions Hall of everyone who has ever finished first, and a schedule so the next night is on a page rather than in a chat thread nobody can find.",
      ],
      id: [
        "Klub adalah orang-orang yang rutin bermain bersamamu. Siapa pun bisa membuatnya dalam beberapa detik, dan klub langsung punya kode enam karakter yang bisa kamu bacakan atau tempel di grup chat.",
        "Sesi yang dimainkan sebagai klub akan terakumulasi: tabel liga untuk periode berjalan, Champions Hall berisi semua yang pernah juara, dan jadwal agar rencana main berikutnya ada di satu halaman, bukan tenggelam di grup chat.",
      ],
    },
    steps: {
      en: [
        "Create the club and give it a name — that's the whole setup.",
        "Share the code, or invite people by email. They ask to join; you accept.",
        "When you start a session, choose the club. Its results count toward the league unless you say otherwise.",
        "Owners and admins can manage members; everyone else just plays.",
      ],
      id: [
        "Buat klub dan beri nama — hanya itu pengaturannya.",
        "Bagikan kodenya, atau undang lewat email. Mereka mengajukan gabung; kamu menyetujui.",
        "Saat memulai sesi, pilih klubnya. Hasilnya masuk ke liga kecuali kamu menonaktifkannya.",
        "Pemilik dan admin bisa mengelola anggota; yang lain cukup bermain.",
      ],
    },
    bestFor: {
      en: [
        "A regular group that already has a WhatsApp thread",
        "Anyone who wants a season, not just a night",
        "Coaches and organisers running the same faces every week",
      ],
      id: [
        "Kelompok rutin yang sudah punya grup WhatsApp",
        "Siapa pun yang ingin satu musim, bukan hanya satu malam",
        "Pelatih dan penyelenggara yang mengurus orang-orang yang sama setiap minggu",
      ],
    },
    notFor: {
      en: "A one-off game with whoever turned up doesn't need a club — start a session without one and it still counts toward everyone's rating.",
      id: "Permainan sekali jalan dengan siapa pun yang datang tidak perlu klub — mulai sesi tanpa klub, dan hasilnya tetap dihitung ke rating semua pemain.",
    },
    cta: {
      label: { en: "Create your club", id: "Buat klubmu" },
      to: "/teams?new=1",
    },
    ctaNote: {
      en: "You'll need an account for this one — it takes an email and a password.",
      id: "Untuk ini kamu perlu akun — cukup email dan kata sandi.",
    },
  },

  {
    slug: "league",
    family: "club",
    poster: "table",
    name: { en: "League table", id: "Tabel liga" },
    promise: {
      en: "A table that remembers the whole period, not just tonight.",
      id: "Tabel yang mengingat seluruh periode, bukan hanya malam ini.",
    },
    what: {
      en: [
        "Every session a club plays turns finishing positions into league points. You get one point for each player you finished ahead of, plus one — so winning a field of eight earns eight, second earns seven, and last still earns one. Turning up is worth something.",
        "The podium earns a bonus on top: three extra for first, two for second, one for third. Consistency gets you up the table; winning gets you up it faster.",
        "A club decides how long a period runs — monthly through to yearly — and how many sessions someone has to play before they appear on it, so one lucky night can't top a season.",
      ],
      id: [
        "Setiap sesi yang dimainkan klub mengubah posisi akhir menjadi poin liga. Kamu mendapat satu poin untuk setiap pemain yang kamu ungguli, ditambah satu — jadi menang dari delapan pemain menghasilkan delapan poin, kedua tujuh, dan yang terakhir tetap mendapat satu. Datang bermain tetap dihargai.",
        "Podium mendapat bonus tambahan: tiga untuk pertama, dua untuk kedua, satu untuk ketiga. Konsistensi membawamu naik; kemenangan membuatmu naik lebih cepat.",
        "Klub menentukan panjang satu periode — bulanan sampai tahunan — dan berapa sesi minimal yang harus dimainkan sebelum seseorang muncul di tabel, agar satu malam keberuntungan tidak bisa memuncaki satu musim.",
      ],
    },
    steps: {
      en: [
        "Start a session and pick the club it belongs to.",
        "When the host ends the session, the final standings convert to league points.",
        "The table shows the current period, ordered by points.",
        "Anyone below the club's minimum number of sessions is held back until they qualify.",
      ],
      id: [
        "Mulai sesi dan pilih klub yang menaunginya.",
        "Saat host mengakhiri sesi, klasemen akhir dikonversi menjadi poin liga.",
        "Tabel menampilkan periode berjalan, diurutkan berdasarkan poin.",
        "Siapa pun yang belum memenuhi jumlah sesi minimal klub ditahan sampai memenuhi syarat.",
      ],
    },
    bestFor: {
      en: [
        "Clubs that play weekly and want a season out of it",
        "Groups who like a reason to turn up in a quiet month",
        "Anyone who has tried to keep a table like this in a spreadsheet",
      ],
      id: [
        "Klub yang bermain tiap pekan dan ingin punya musim",
        "Kelompok yang butuh alasan untuk tetap datang di bulan yang sepi",
        "Siapa pun yang pernah mencoba membuat tabel seperti ini di spreadsheet",
      ],
    },
    notFor: {
      en: "A casual hit shouldn't move a season, so a host can mark a session as not counting toward the league — and should. The minimum-sessions rule also means a newcomer's first big night won't show up straight away; that isn't the table being slow, it's the table refusing to be decided by one evening.",
      id: "Main santai tidak seharusnya menggeser satu musim, jadi host bisa — dan sebaiknya — menandai sebuah sesi agar tidak dihitung untuk liga. Aturan sesi minimal juga berarti malam pertama seorang pemain baru tidak langsung muncul; itu bukan tabelnya lambat, itu tabelnya menolak ditentukan oleh satu malam saja.",
    },
    cta: {
      label: { en: "Open your clubs", id: "Buka klubmu" },
      to: "/teams",
    },
    ctaNote: {
      en: "The league lives inside a club — open one and it has its own page.",
      id: "Liga ada di dalam klub — buka salah satu klub dan liganya punya halaman sendiri.",
    },
  },

  {
    slug: "champions",
    family: "club",
    poster: "trophy",
    name: { en: "Champions Hall", id: "Champions Hall" },
    promise: {
      en: "Everyone who has ever won, in one place, and it never resets.",
      id: "Semua yang pernah juara, dalam satu tempat, dan tidak pernah direset.",
    },
    what: {
      en: [
        "The league answers who is winning now. The Champions Hall answers who has ever won — the club's long memory, and the part people actually screenshot.",
        "The titles board lists everyone who has finished first at least once, ordered by titles, then podium finishes, then average placing. Beside it sits the recent champions list: the last sessions to finish, each with its winner and full podium.",
      ],
      id: [
        "Liga menjawab siapa yang sedang memimpin. Champions Hall menjawab siapa yang pernah juara — ingatan panjang klub, dan bagian yang benar-benar orang tangkap layar.",
        "Papan gelar memuat semua orang yang pernah finis pertama, diurutkan berdasarkan jumlah gelar, lalu podium, lalu rata-rata posisi akhir. Di sampingnya ada daftar juara terbaru: sesi-sesi terakhir yang selesai, masing-masing dengan pemenang dan podium lengkapnya.",
      ],
    },
    steps: {
      en: [
        "Play a session as the club, and let the host end it properly.",
        "The winner and the full podium are recorded against the club, permanently.",
        "The titles board re-sorts: most titles first, then podiums, then average finish.",
        "Nothing here ever resets when a league period rolls over.",
      ],
      id: [
        "Mainkan sesi sebagai klub, dan pastikan host mengakhirinya dengan benar.",
        "Pemenang dan podium lengkap dicatat untuk klub itu, secara permanen.",
        "Papan gelar diurutkan ulang: gelar terbanyak lebih dulu, lalu podium, lalu rata-rata posisi.",
        "Tidak ada yang direset di sini saat periode liga berganti.",
      ],
    },
    bestFor: {
      en: [
        "Clubs with a year or more of history worth showing",
        "Settling arguments about who used to be the best",
        "Giving a quiet season some weight — a title is forever, the table isn't",
      ],
      id: [
        "Klub dengan riwayat setahun atau lebih yang layak dipamerkan",
        "Menyelesaikan perdebatan soal siapa yang dulu paling jago",
        "Memberi bobot pada musim yang sepi — gelar itu abadi, tabel tidak",
      ],
    },
    notFor: {
      en: "It only counts sessions that were finished. A night that fizzled out and was never ended has no winner, so it never reaches the hall — if a title matters to someone, end the session before everyone leaves the car park.",
      id: "Yang dihitung hanya sesi yang benar-benar diakhiri. Malam yang bubar begitu saja tanpa pernah diakhiri tidak punya pemenang, jadi tidak pernah masuk hall — kalau sebuah gelar penting bagi seseorang, akhiri sesinya sebelum semua orang meninggalkan parkiran.",
    },
    cta: {
      label: { en: "Open your clubs", id: "Buka klubmu" },
      to: "/teams",
    },
  },

  {
    slug: "club-events",
    family: "club",
    poster: "calendar",
    name: { en: "Scheduled sessions", id: "Sesi terjadwal" },
    promise: {
      en: "Next Thursday, on a page — with a straight answer from everyone about whether they're coming.",
      id: "Kamis depan, dalam satu halaman — dengan jawaban jelas dari semua orang soal datang atau tidak.",
    },
    what: {
      en: [
        "An admin puts a session on the club's calendar before it happens: date, time, and where. Every member is notified, and each of them answers going, maybe, or can't make it.",
        "The point is knowing the numbers before you book courts. Six going and two maybes is two courts; eleven going is three and a longer night. Nobody has to scroll back through a chat counting thumbs-up emojis.",
      ],
      id: [
        "Admin memasukkan sesi ke kalender klub sebelum hari-H: tanggal, jam, dan lokasi. Semua anggota mendapat notifikasi, dan masing-masing menjawab ikut, mungkin, atau tidak bisa.",
        "Intinya adalah mengetahui jumlah pemain sebelum memesan lapangan. Enam ikut dan dua mungkin berarti dua lapangan; sebelas ikut berarti tiga lapangan dan malam yang lebih panjang. Tidak ada yang perlu menggulir grup chat menghitung emoji jempol.",
      ],
    },
    steps: {
      en: [
        "An admin creates the entry with the date, the time and the place.",
        "Members are notified and answer going, maybe or can't make it.",
        "The organiser watches the count and books the courts to match.",
        "On the night, the admin starts the real session from that entry.",
      ],
      id: [
        "Admin membuat entri berisi tanggal, jam, dan lokasi.",
        "Anggota mendapat notifikasi dan menjawab ikut, mungkin, atau tidak bisa.",
        "Penyelenggara memantau jumlahnya dan memesan lapangan sesuai kebutuhan.",
        "Pada hari-H, admin memulai sesi sungguhan dari entri tersebut.",
      ],
    },
    bestFor: {
      en: [
        "Clubs whose attendance decides how many courts to book",
        "Groups where the same three people always end up organising",
        "Fixtures set a week or a month ahead",
      ],
      id: [
        "Klub yang jumlah kehadirannya menentukan berapa lapangan dipesan",
        "Kelompok di mana tiga orang yang sama selalu jadi penyelenggara",
        "Jadwal yang ditetapkan sepekan atau sebulan sebelumnya",
      ],
    },
    notFor: {
      en: "An RSVP is an answer, not a reserved spot in the draw. When the session starts, the host still puts the players in — which is the right way round, because the people who actually walk onto the court are never quite the people who said they would.",
      id: "Konfirmasi kehadiran adalah jawaban, bukan tempat yang sudah dikunci di undian. Saat sesi dimulai, host tetap memasukkan pemainnya sendiri — dan memang seharusnya begitu, karena orang yang benar-benar melangkah ke lapangan tidak pernah persis sama dengan yang menyatakan akan datang.",
    },
    cta: {
      label: { en: "Open your clubs", id: "Buka klubmu" },
      to: "/teams",
    },
    ctaNote: {
      en: "Scheduling is an admin job — open your club and it's on the club's page.",
      id: "Penjadwalan adalah tugas admin — buka klubmu dan fiturnya ada di halaman klub.",
    },
  },

  // ───────────────────────────────────────────────────────────────── you ──
  {
    slug: "rating",
    family: "you",
    poster: "dial",
    name: { en: "Your rating", id: "Ratingmu" },
    promise: {
      en: "One number that follows you between sessions, and moves for who you beat — not how many.",
      id: "Satu angka yang mengikutimu dari sesi ke sesi, dan bergerak sesuai siapa yang kamu kalahkan — bukan berapa banyak.",
    },
    what: {
      en: [
        "Everyone starts at 1500. When a session ends, the app replays every game you played and moves your number according to who was on the other side of the net.",
        "Beating someone rated well above you moves it a long way. Losing to them barely costs you anything. That's why two people with the same win rate can sit two hundred points apart — the rating is reading the difficulty of your wins, not counting them.",
        "For the first few sessions it says your rating is still settling, because the app doesn't trust the number yet. It carries a wide margin of error that narrows as you play; about three sessions in, it stops swinging. That's the rating finding you, not you getting better or worse overnight.",
      ],
      id: [
        "Semua orang mulai dari 1500. Saat sebuah sesi berakhir, aplikasi memutar ulang setiap game yang kamu mainkan dan menggerakkan angkamu sesuai siapa yang berada di seberang net.",
        "Mengalahkan pemain dengan rating jauh di atasmu menggerakkannya jauh. Kalah dari mereka hampir tidak merugikanmu. Karena itu dua orang dengan persentase kemenangan sama bisa terpisah dua ratus poin — rating membaca tingkat kesulitan kemenanganmu, bukan menghitung jumlahnya.",
        "Pada beberapa sesi pertama, aplikasi menyebut ratingmu masih menyesuaikan, karena angkanya belum bisa dipercaya. Ada margin kesalahan lebar yang menyempit seiring kamu bermain; setelah sekitar tiga sesi, angkanya berhenti berayun. Itu rating yang sedang mencari levelmu, bukan kamu yang tiba-tiba membaik atau memburuk.",
      ],
    },
    steps: {
      en: [
        "Play your first session — you start from 1500 like everyone else.",
        "When the host ends the session, every game is replayed against the actual opponents you faced.",
        "Your number moves by how surprising each result was, not by how many games you won.",
        "After roughly three sessions the margin of error narrows and the number settles.",
      ],
      id: [
        "Mainkan sesi pertamamu — kamu mulai dari 1500 seperti semua orang.",
        "Saat host mengakhiri sesi, setiap game diputar ulang terhadap lawan yang benar-benar kamu hadapi.",
        "Angkamu bergerak sesuai seberapa mengejutkan setiap hasilnya, bukan sesuai jumlah kemenangan.",
        "Setelah sekitar tiga sesi, margin kesalahannya menyempit dan angkanya menetap.",
      ],
    },
    bestFor: {
      en: [
        "Groups splitting into levels for a night without anyone having to say it out loud",
        "Seeing whether a year of playing actually changed anything",
        "Hosts building balanced draws from something better than a hunch",
      ],
      id: [
        "Kelompok yang ingin membagi level tanpa harus menyebutnya terang-terangan",
        "Melihat apakah setahun bermain benar-benar mengubah sesuatu",
        "Host yang ingin menyusun undian seimbang berdasarkan hal yang lebih baik dari perkiraan",
      ],
    },
    notFor: {
      en: "It's relative to the people you actually play with. It tells you where you sit in your circle, not where you'd sit in the world — a 1600 in one group and a 1600 in another are not the same player, and comparing them is the one thing this number can't do. The label next to it is just a friendlier name for the same number; nothing is calculated from it.",
      id: "Rating bersifat relatif terhadap orang-orang yang benar-benar kamu lawan. Rating menunjukkan posisimu di lingkaranmu, bukan di dunia — 1600 di satu kelompok dan 1600 di kelompok lain bukan pemain yang sama, dan membandingkan keduanya justru satu hal yang tidak bisa dilakukan angka ini. Label di sebelahnya hanyalah nama yang lebih ramah untuk angka yang sama; tidak ada perhitungan yang berasal darinya.",
    },
    cta: {
      label: { en: "See your rating", id: "Lihat ratingmu" },
      to: "/profile",
    },
  },

  {
    slug: "record",
    family: "you",
    poster: "chart",
    name: { en: "Your record", id: "Rekormu" },
    promise: {
      en: "Every finished game you've played, and whether you're on a run right now.",
      id: "Setiap game yang sudah kamu selesaikan, dan apakah kamu sedang dalam tren bagus.",
    },
    what: {
      en: [
        "Wins, losses and draws across every game in every session you've played, and the win rate they add up to. Recent form is your last five results, newest first.",
        "Your own profile shows two things the public one never will: best partner — the person you win most often alongside — and toughest rival, the opponent who beats you most. They need a few games together before they mean anything, and they stay private because they describe somebody else's record as much as yours.",
      ],
      id: [
        "Menang, kalah, dan seri dari setiap game di setiap sesi yang kamu mainkan, beserta persentase kemenangannya. Form terkini adalah lima hasil terakhirmu, dari yang terbaru.",
        "Profil pribadimu menampilkan dua hal yang tidak pernah muncul di profil publik: partner terbaik — orang yang paling sering menang bersamamu — dan lawan terberat, lawan yang paling sering mengalahkanmu. Keduanya butuh beberapa game sebelum berarti, dan tetap privat karena keduanya juga menggambarkan rekor orang lain.",
      ],
    },
    steps: {
      en: [
        "Play. Every game that reaches a final score is counted.",
        "Wins, losses and draws add up across all your sessions, in every format.",
        "Recent form keeps the last five, so a bad night is visible but not permanent.",
        "Best partner and toughest rival appear once you've played enough with the same people.",
      ],
      id: [
        "Bermain. Setiap game yang mencapai skor akhir akan dihitung.",
        "Menang, kalah, dan seri diakumulasi dari semua sesimu, di semua format.",
        "Form terkini menyimpan lima hasil terakhir, jadi malam yang buruk terlihat tetapi tidak permanen.",
        "Partner terbaik dan lawan terberat muncul begitu kamu cukup sering bermain dengan orang yang sama.",
      ],
    },
    bestFor: {
      en: [
        "Anyone who wants proof rather than a feeling about their form",
        "Finding out who you actually play well with",
        "Looking back at a season you only half remember",
      ],
      id: [
        "Siapa pun yang ingin bukti, bukan sekadar perasaan soal formanya",
        "Mengetahui dengan siapa kamu sebenarnya bermain paling baik",
        "Melihat kembali satu musim yang hanya kamu ingat separuhnya",
      ],
    },
    notFor: {
      en: "The neutral points you're credited for a round you sat out keep your place on the board that night, but they are never invented into wins here. Your record only counts games you actually played — which is why it can look thinner than the evening felt.",
      id: "Poin netral yang kamu terima untuk ronde yang kamu lewati menjaga posisimu di papan malam itu, tetapi tidak pernah diubah menjadi kemenangan di sini. Rekormu hanya menghitung game yang benar-benar kamu mainkan — karena itu isinya bisa terlihat lebih sedikit dari yang terasa.",
    },
    cta: {
      label: { en: "See your record", id: "Lihat rekormu" },
      to: "/profile",
    },
  },

  {
    slug: "public-profile",
    family: "you",
    poster: "person",
    name: { en: "Public profile", id: "Profil publik" },
    promise: {
      en: "One link that says who you are as a player, openable by anyone.",
      id: "Satu tautan yang menjelaskan siapa kamu sebagai pemain, bisa dibuka siapa saja.",
    },
    what: {
      en: [
        "Your public page carries your name, your photo, the line you write about yourself, your rating and its label, your all-time record, recent form, rating trend, and the clubs you belong to.",
        "It deliberately doesn't carry your email, your best partner or toughest rival, or the detail of individual matches. It's a player card, not a file on you — enough for a host to slot you into the right session, and nothing that belongs to somebody else's record.",
      ],
      id: [
        "Halaman publikmu memuat nama, foto, kalimat yang kamu tulis tentang dirimu, rating beserta labelnya, rekor sepanjang masa, form terkini, tren rating, dan klub yang kamu ikuti.",
        "Halaman itu sengaja tidak memuat emailmu, partner terbaik atau lawan terberatmu, maupun detail pertandingan satu per satu. Ini kartu pemain, bukan dosir tentangmu — cukup bagi host untuk menempatkanmu di sesi yang tepat, dan tidak memuat apa pun yang sebenarnya milik rekor orang lain.",
      ],
    },
    steps: {
      en: [
        "Set your name, photo and the short line about yourself in Settings.",
        "Your profile already has a public link — nothing to switch on.",
        "Anyone can open it, including people without an account.",
        "What's private stays private: email, partner and rival stats, individual matches.",
      ],
      id: [
        "Atur nama, foto, dan kalimat singkat tentang dirimu di Pengaturan.",
        "Profilmu sudah punya tautan publik — tidak ada yang perlu diaktifkan.",
        "Siapa pun bisa membukanya, termasuk orang tanpa akun.",
        "Yang privat tetap privat: email, statistik partner dan lawan, serta pertandingan satu per satu.",
      ],
    },
    bestFor: {
      en: [
        "Introducing yourself to a club before your first session with them",
        "Hosts checking who they're about to add to a draw",
        "Anyone tired of explaining their level in a group chat",
      ],
      id: [
        "Memperkenalkan diri ke klub sebelum sesi pertamamu bersama mereka",
        "Host yang ingin melihat siapa yang akan ia masukkan ke undian",
        "Siapa pun yang lelah menjelaskan levelnya di grup chat",
      ],
    },
    notFor: {
      en: "Public means public. The link works for anyone who has it, with no sign-in and no request to you, so treat the name and photo you choose as the ones a stranger will see — because eventually one will.",
      id: "Publik berarti publik. Tautannya berfungsi untuk siapa pun yang memilikinya, tanpa perlu masuk dan tanpa izin darimu, jadi anggap nama dan foto yang kamu pilih akan dilihat orang yang tidak kamu kenal — karena cepat atau lambat memang begitu.",
    },
    cta: {
      label: { en: "Open your profile", id: "Buka profilmu" },
      to: "/profile",
    },
  },

  // ──────────────────────────────────────────────────────────── together ──
  {
    slug: "join-by-code",
    family: "together",
    poster: "code",
    name: { en: "Join by code", id: "Gabung dengan kode" },
    promise: {
      en: "Six characters and you're in the session. No searching, no invitation, no app store detour.",
      id: "Enam karakter dan kamu masuk ke sesinya. Tanpa mencari, tanpa undangan, tanpa mampir ke app store.",
    },
    what: {
      en: [
        "Every session has a six-character code. The host reads it out across the court or pastes the link into the group chat, and entering it takes you straight to that session — whether it's still being set up or already three rounds in.",
        "The host then confirms you, which is the bit that stops a stranger on the next court from appearing in your draw.",
      ],
      id: [
        "Setiap sesi punya kode enam karakter. Host membacakannya di lapangan atau menempelkan tautannya di grup chat, dan memasukkan kode itu membawamu langsung ke sesi tersebut — baik yang masih disiapkan maupun yang sudah berjalan tiga ronde.",
        "Setelah itu host mengonfirmasimu, dan bagian inilah yang mencegah orang asing di lapangan sebelah muncul di undianmu.",
      ],
    },
    steps: {
      en: [
        "Get the code from the host — spoken, screenshotted, or as a link.",
        "Enter it on the Join screen.",
        "You land on the session as it stands right now.",
        "The host accepts you, and you're in the draw from the next round.",
      ],
      id: [
        "Dapatkan kodenya dari host — diucapkan, ditangkap layar, atau berupa tautan.",
        "Masukkan di layar Gabung.",
        "Kamu langsung masuk ke sesi sesuai kondisi saat itu.",
        "Host menerimamu, dan kamu masuk undian mulai ronde berikutnya.",
      ],
    },
    bestFor: {
      en: [
        "Anyone arriving late to a session already running",
        "Hosts who'd rather not collect email addresses to add four people",
        "Open club nights where you don't know who's coming until they walk in",
      ],
      id: [
        "Siapa pun yang datang terlambat ke sesi yang sudah berjalan",
        "Host yang tidak ingin mengumpulkan email hanya untuk menambah empat orang",
        "Malam klub terbuka, saat kamu baru tahu siapa yang datang setelah mereka tiba",
      ],
    },
    notFor: {
      en: "To play you need to be signed in — results have to attach to an account that will still exist next month. To only watch, you don't need one at all.",
      id: "Untuk bermain kamu harus masuk — hasil pertandingan harus menempel pada akun yang masih ada bulan depan. Kalau hanya menonton, kamu sama sekali tidak perlu akun.",
    },
    cta: {
      label: { en: "Join with a code", id: "Gabung dengan kode" },
      to: "/join",
    },
  },

  {
    slug: "watch-live",
    family: "together",
    poster: "screen",
    name: { en: "Watch live", id: "Tonton langsung" },
    promise: {
      en: "Follow the round, the scores and the board from the bench — with no account at all.",
      id: "Ikuti ronde, skor, dan klasemen dari bangku pinggir lapangan — tanpa akun sama sekali.",
    },
    what: {
      en: [
        "A session's live link opens for anyone: the round being played, the scores as the host enters them, and the standings updating underneath. No sign-in, no download, nothing to accept.",
        "It's the link you send to the four people who are late, to the partner who came to watch, and to the club's chat so people can see how the night is going without asking.",
      ],
      id: [
        "Tautan langsung sebuah sesi bisa dibuka siapa saja: ronde yang sedang berjalan, skor saat dimasukkan host, dan klasemen yang ikut bergerak di bawahnya. Tanpa masuk, tanpa unduh, tanpa persetujuan apa pun.",
        "Ini tautan yang kamu kirim ke empat orang yang telat, ke pasangan yang ikut menonton, dan ke grup klub agar semua bisa melihat jalannya malam tanpa perlu bertanya.",
      ],
    },
    steps: {
      en: [
        "The host copies the session's live link, or gives out the code.",
        "You open it — in any browser, on any device.",
        "You see the current round, the scores as they're entered, and the board.",
        "It keeps updating on its own while the session runs.",
      ],
      id: [
        "Host menyalin tautan langsung sesi, atau membagikan kodenya.",
        "Kamu membukanya — di peramban apa pun, di perangkat apa pun.",
        "Kamu melihat ronde berjalan, skor saat dimasukkan, dan klasemennya.",
        "Halamannya terus memperbarui sendiri selama sesi berlangsung.",
      ],
    },
    bestFor: {
      en: [
        "Family and friends watching from the side",
        "Players resting a round who want to see the table move",
        "A club chat following a night nobody is at yet",
      ],
      id: [
        "Keluarga dan teman yang menonton dari pinggir lapangan",
        "Pemain yang sedang istirahat dan ingin melihat klasemen bergerak",
        "Grup klub yang mengikuti malam yang belum dihadiri siapa pun",
      ],
    },
    notFor: {
      en: "A watcher can't enter scores. Only the host does that, on purpose — two people fixing the same court differently is how a leaderboard starts arguing with itself.",
      id: "Penonton tidak bisa memasukkan skor. Hanya host yang bisa, dan itu memang disengaja — dua orang memperbaiki lapangan yang sama dengan cara berbeda adalah awal dari papan peringkat yang bertentangan dengan dirinya sendiri.",
    },
    cta: {
      label: { en: "Open a live session", id: "Buka sesi langsung" },
      to: "/watch",
    },
    ctaNote: {
      en: "You'll need the code or the link from whoever is hosting.",
      id: "Kamu perlu kode atau tautan dari yang menjadi host.",
    },
  },

  {
    slug: "claim-spot",
    family: "together",
    poster: "claim",
    name: { en: "Claim your spot", id: "Klaim tempatmu" },
    promise: {
      en: "Your name was on the sheet before you arrived. Take it, and the points come with it.",
      id: "Namamu sudah ada di daftar sebelum kamu tiba. Klaim saja, dan poinnya ikut jadi milikmu.",
    },
    what: {
      en: [
        "Hosts type names in fast, so you're often already playing before you've touched the app. Open the session, claim the name that's you, and from the moment the host accepts, that spot belongs to your account.",
        "Everything already recorded under that name becomes yours — the points, the games, and the effect on your rating when the session ends. Nothing is re-entered and nothing is lost.",
      ],
      id: [
        "Host biasanya mengetik nama dengan cepat, jadi sering kali kamu sudah bermain sebelum menyentuh aplikasi. Buka sesinya, klaim nama yang mewakilimu, dan sejak host menerima, tempat itu menjadi milik akunmu.",
        "Semua yang sudah tercatat di bawah nama itu menjadi milikmu — poin, game, dan pengaruhnya pada ratingmu saat sesi berakhir. Tidak ada yang dimasukkan ulang dan tidak ada yang hilang.",
      ],
    },
    steps: {
      en: [
        "Open the session with the code or the live link, and sign in.",
        "Find the name that represents you on the roster and claim it.",
        "The host accepts the claim.",
        "The spot — and its whole history in this session — is now attached to your account.",
      ],
      id: [
        "Buka sesinya dengan kode atau tautan langsung, lalu masuk.",
        "Temukan nama yang mewakilimu di daftar pemain dan klaim.",
        "Host menerima klaim itu.",
        "Tempat itu — beserta seluruh riwayatnya di sesi ini — kini menempel pada akunmu.",
      ],
    },
    bestFor: {
      en: [
        "Turning up to a session someone else set up for you",
        "Your first session, played before you had an account",
        "Regulars whose name the host always types in from memory",
      ],
      id: [
        "Datang ke sesi yang sudah disiapkan orang lain untukmu",
        "Sesi pertamamu, yang dimainkan sebelum kamu punya akun",
        "Pemain rutin yang namanya selalu diketik host dari ingatan",
      ],
    },
    notFor: {
      en: "Claim before the host ends the session. Once it's ended, the results are locked to the name they were played under, and moving them across is a repair somebody has to do for you rather than something you can do yourself.",
      id: "Klaim sebelum host mengakhiri sesi. Begitu sesi diakhiri, hasilnya terkunci pada nama yang dipakai saat bermain, dan memindahkannya menjadi perbaikan yang harus dilakukan orang lain untukmu, bukan sesuatu yang bisa kamu lakukan sendiri.",
    },
    cta: {
      label: { en: "Open the session", id: "Buka sesinya" },
      to: "/join",
    },
    ctaNote: {
      en: "Claiming needs an account, because there'd be nothing to attach the results to otherwise.",
      id: "Mengklaim butuh akun, karena tanpa itu tidak ada tempat untuk menempelkan hasilnya.",
    },
  },

  {
    slug: "offline",
    family: "together",
    poster: "cloud",
    name: { en: "Playing without signal", id: "Bermain tanpa sinyal" },
    promise: {
      en: "Padel courts have terrible WiFi. Entering a score is instant anyway, and nothing is lost.",
      id: "Lapangan padel biasanya sinyalnya buruk. Memasukkan skor tetap seketika, dan tidak ada yang hilang.",
    },
    what: {
      en: [
        "A score you enter is written to the phone first and shown immediately — no spinner, no failure, no waiting on a bar of signal that isn't coming. The app then sends it up on its own in the background, retrying by itself when the connection returns, including after you close the app and come back to it later.",
        "Formats that draw every round at the start — Americano, Fixed Position, Fixed Partner and Mix Americano — can be played from the first round to the last with no connection at all. The Mexicano formats need a moment of signal between rounds, because the next pairing is computed from the scores just played.",
      ],
      id: [
        "Skor yang kamu masukkan ditulis ke ponsel lebih dulu dan langsung tampil — tanpa memutar, tanpa gagal, tanpa menunggu sinyal yang tidak akan datang. Setelah itu aplikasi mengirimkannya sendiri di latar belakang, mencoba ulang otomatis begitu koneksi kembali, termasuk setelah aplikasi kamu tutup dan buka lagi nanti.",
        "Format yang menyusun semua ronde di awal — Americano, Fixed Position, Fixed Partner, dan Mix Americano — bisa dimainkan dari ronde pertama sampai terakhir tanpa koneksi sama sekali. Format Mexicano butuh sinyal sebentar di antara ronde, karena pasangan berikutnya dihitung dari skor yang baru dimainkan.",
      ],
    },
    steps: {
      en: [
        "Enter the score as usual. It appears at once, whether you have signal or not.",
        "It's kept on the phone until it has been sent — closing the app doesn't drop it.",
        "The moment there's a connection, the queue empties itself in the background.",
        "You can see how many scores are still waiting to go up while you play.",
      ],
      id: [
        "Masukkan skor seperti biasa. Skornya langsung tampil, ada sinyal atau tidak.",
        "Skor disimpan di ponsel sampai berhasil terkirim — menutup aplikasi tidak membuatnya hilang.",
        "Begitu ada koneksi, antreannya mengosongkan dirinya sendiri di latar belakang.",
        "Kamu bisa melihat berapa skor yang masih menunggu terkirim sambil bermain.",
      ],
    },
    bestFor: {
      en: [
        "Indoor courts and basements where the signal simply stops",
        "Outdoor venues on the edge of coverage",
        "Anyone who has lost a round's scores to a failed request and had to ask everyone what they got",
      ],
      id: [
        "Lapangan indoor dan basement yang sinyalnya benar-benar hilang",
        "Venue luar ruang di batas jangkauan jaringan",
        "Siapa pun yang pernah kehilangan skor satu ronde karena permintaan gagal dan harus bertanya ulang ke semua orang",
      ],
    },
    notFor: {
      en: "It queues scores, not everything. Drawing the next Mexicano round is worked out from the results, so that step waits until the queue has gone up — and starting a session, adding a player or ending the night all still need a connection. If a score is rejected outright again and again, it's set aside rather than allowed to block the rest, and the host can see it hasn't gone.",
      id: "Yang diantre adalah skor, bukan semuanya. Menyusun ronde Mexicano berikutnya dihitung dari hasil, jadi langkah itu menunggu sampai antrean terkirim — dan memulai sesi, menambah pemain, atau mengakhiri malam tetap butuh koneksi. Kalau satu skor terus-menerus ditolak, skor itu disisihkan agar tidak menghambat yang lain, dan host bisa melihat bahwa skor itu belum terkirim.",
    },
    cta: {
      label: { en: "Start a session", id: "Mulai sebuah sesi" },
      to: "/create",
    },
    ctaNote: {
      en: "Nothing to switch on — this is how score entry already works.",
      id: "Tidak ada yang perlu diaktifkan — begini cara pengisian skor bekerja sejak awal.",
    },
  },

  {
    slug: "hosting-tools",
    family: "together",
    poster: "tools",
    name: { en: "Hosting a session", id: "Menjadi host sesi" },
    promise: {
      en: "Someone's late, someone's leaving, a court got the wrong score. All of it is fixable without restarting the night.",
      id: "Ada yang telat, ada yang pulang, satu lapangan salah skor. Semuanya bisa dibereskan tanpa memulai ulang malam itu.",
    },
    what: {
      en: [
        "A real session doesn't hold still. People arrive two rounds in, a court gets double-booked, someone has to leave at nine, and a score gets typed into the wrong side. The host screen exists to absorb all of that while the games keep going.",
        "You can add a latecomer, accept or turn down whoever entered the code, mark a player as gone home and bring them back if they change their mind, rename the courts to match the venue's numbering, take a court out of play, switch how the board is ordered, and correct a score that's already final. When the night is done you end the session: the standings lock, the results are recorded, and everyone's rating moves.",
      ],
      id: [
        "Sesi sungguhan tidak pernah diam. Ada yang datang saat ronde kedua, satu lapangan bentrok pemesanan, ada yang harus pulang jam sembilan, dan satu skor masuk ke sisi yang salah. Layar host ada untuk menyerap semua itu sambil pertandingan tetap berjalan.",
        "Kamu bisa menambah pemain yang telat, menerima atau menolak siapa pun yang memasukkan kode, menandai pemain yang sudah pulang dan mengembalikannya kalau ia berubah pikiran, mengganti nama lapangan agar sesuai penomoran venue, menonaktifkan satu lapangan, mengubah cara papan diurutkan, dan memperbaiki skor yang sudah final. Saat malamnya selesai, kamu mengakhiri sesi: klasemen dikunci, hasilnya dicatat, dan rating semua orang bergerak.",
      ],
    },
    steps: {
      en: [
        "Start with whoever is actually there — you don't have to wait for the full list.",
        "Add latecomers as they arrive. They play from the next round; rounds already played aren't rewritten.",
        "Mark anyone who leaves early. They keep everything they earned, and the draw stops planning around them.",
        "End the session when you're done. That's the moment the standings lock and ratings are applied.",
      ],
      id: [
        "Mulai dengan siapa pun yang sudah hadir — kamu tidak perlu menunggu daftar lengkap.",
        "Tambahkan yang telat begitu mereka tiba. Mereka bermain mulai ronde berikutnya; ronde yang sudah dimainkan tidak diubah.",
        "Tandai siapa pun yang pulang lebih awal. Ia tetap menyimpan semua yang sudah diraih, dan undian berhenti memperhitungkannya.",
        "Akhiri sesi saat selesai. Di saat itulah klasemen dikunci dan rating diterapkan.",
      ],
    },
    bestFor: {
      en: [
        "Whoever ends up holding the phone every week",
        "Open sessions where the player list is a moving target",
        "Venues that renumber their courts and never tell anyone",
      ],
      id: [
        "Siapa pun yang setiap pekan berakhir memegang ponselnya",
        "Sesi terbuka di mana daftar pemain terus berubah",
        "Venue yang mengganti penomoran lapangan tanpa memberi tahu siapa pun",
      ],
    },
    notFor: {
      en: "Score corrections are logged, not silent: the old score, the new one, who changed it and when all stay attached to the match. That's deliberate. A host who can quietly rewrite the board isn't a host anyone should have to trust.",
      id: "Perbaikan skor dicatat, bukan disembunyikan: skor lama, skor baru, siapa yang mengubah, dan kapan, semuanya tetap menempel pada pertandingan itu. Ini memang disengaja. Host yang bisa diam-diam menulis ulang papan bukan host yang layak dipercaya begitu saja.",
    },
    cta: {
      label: { en: "Start a session", id: "Mulai sebuah sesi" },
      to: "/create",
    },
    ctaNote: NEEDS_ACCOUNT,
  },
];

export function featureBySlug(slug: string): Feature | undefined {
  return FEATURES.find((f) => f.slug === slug);
}

export const PAGE_UI: Record<Lang, Record<string, string>> = {
  en: {
    howItWorks: "How it works",
    bestFor: "Good for",
    notFor: "Worth knowing",
    allFeatures: "See everything Padelier does",
    back: "All features",
  },
  id: {
    howItWorks: "Cara kerjanya",
    bestFor: "Cocok untuk",
    notFor: "Perlu diketahui",
    allFeatures: "Lihat semua yang bisa Padelier lakukan",
    back: "Semua fitur",
  },
};
