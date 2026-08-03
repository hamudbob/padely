import { supabase } from "./client";

/**
 * Per-account profile: the lasting identity a player carries across sessions
 * (display name, avatar, persisted global rating, cached stats). Backed by the
 * `profiles` table + `avatars` Storage bucket (0012_profiles.sql). Every row is
 * publicly readable by signed-in users; a user may only write their own.
 */

export interface Profile {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  /** Persisted Glicko-2 state (global skill; never resets). */
  rating: number;
  ratingDeviation: number;
  ratingVolatility: number;
  ratingGames: number;
  /** Cached insights blob (populated at session end in a later increment). */
  stats: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

interface ProfileRow {
  id: string;
  display_name: string;
  avatar_url: string | null;
  rating: number;
  rating_deviation: number;
  rating_volatility: number;
  rating_games: number;
  stats: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

function mapProfile(r: ProfileRow): Profile {
  return {
    id: r.id,
    displayName: r.display_name,
    avatarUrl: r.avatar_url,
    rating: r.rating,
    ratingDeviation: r.rating_deviation,
    ratingVolatility: r.rating_volatility,
    ratingGames: r.rating_games,
    stats: r.stats,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** The signed-in user's own profile (null if not signed in). */
export async function getMyProfile(): Promise<Profile | null> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!userData.user) return null;
  return getProfile(userData.user.id);
}

/** Any single profile by user id. */
export async function getProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (error) throw error;
  return data ? mapProfile(data as ProfileRow) : null;
}

/** Batch-fetch profiles (for leaderboards / rosters), keyed by user id. */
export async function getProfiles(userIds: string[]): Promise<Map<string, Profile>> {
  if (userIds.length === 0) return new Map();
  const { data, error } = await supabase.from("profiles").select("*").in("id", userIds);
  if (error) throw error;
  return new Map((data ?? []).map((r) => [r.id, mapProfile(r as ProfileRow)]));
}

/**
 * Update the signed-in user's own profile. Also mirrors the display name into
 * auth metadata, so existing screens that read `user.user_metadata.name` stay
 * in sync while `profiles` becomes the source of truth.
 */
export async function updateMyProfile(patch: { displayName?: string; avatarUrl?: string | null }): Promise<Profile> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  const user = userData.user;
  if (!user) throw new Error("You're not signed in.");

  const row: { id: string; display_name?: string; avatar_url?: string | null; updated_at: string } = {
    id: user.id,
    updated_at: new Date().toISOString(),
  };
  if (patch.displayName !== undefined) row.display_name = patch.displayName.trim() || "Player";
  if (patch.avatarUrl !== undefined) row.avatar_url = patch.avatarUrl;

  const { data, error } = await supabase.from("profiles").upsert(row).select("*").single();
  if (error) throw error;

  if (patch.displayName !== undefined) {
    // best-effort mirror; a failure here must not fail the profile save
    await supabase.auth.updateUser({ data: { name: row.display_name } }).catch(() => undefined);
  }
  return mapProfile(data as ProfileRow);
}

/**
 * Resize/compress an image entirely in the browser before upload, so avatars
 * stay small (default 512px longest edge, JPEG). Keeps Storage cheap and loads
 * fast; also normalises weird formats to a plain JPEG.
 */
export async function resizeImage(file: File, maxEdge = 512, quality = 0.85): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Your browser can't process images here.");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't process that image."))), "image/jpeg", quality),
  );
}

/**
 * Upload a new avatar for the signed-in user: resize → store at
 * `<uid>/avatar.jpg` (overwriting any previous one) → save the public URL onto
 * the profile. Returns the cache-busted URL.
 */
export async function uploadAvatar(file: File): Promise<string> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  const user = userData.user;
  if (!user) throw new Error("You're not signed in.");

  const blob = await resizeImage(file);
  const path = `${user.id}/avatar.jpg`;
  const { error: uploadError } = await supabase.storage
    .from("avatars")
    .upload(path, blob, { upsert: true, contentType: "image/jpeg", cacheControl: "3600" });
  if (uploadError) throw uploadError;

  const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
  // Cache-bust so the new image shows immediately even though the path is stable.
  const url = `${pub.publicUrl}?v=${Date.now()}`;
  await updateMyProfile({ avatarUrl: url });
  return url;
}
