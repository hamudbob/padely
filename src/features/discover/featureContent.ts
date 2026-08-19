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
 * The last one is why these read as useful rather than as marketing.
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

export const FEATURES: Feature[] = [
  // ────────────────────────────────────────────────────────────── format ──
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
];

export function featureBySlug(slug: string): Feature | undefined {
  return FEATURES.find((f) => f.slug === slug);
}

export const PAGE_UI: Record<Lang, Record<string, string>> = {
  en: {
    howItWorks: "How a round works",
    bestFor: "Good for",
    notFor: "Worth knowing",
    allFeatures: "See everything Padelier does",
    back: "All features",
  },
  id: {
    howItWorks: "Cara satu ronde berjalan",
    bestFor: "Cocok untuk",
    notFor: "Perlu diketahui",
    allFeatures: "Lihat semua yang bisa Padelier lakukan",
    back: "Semua fitur",
  },
};
