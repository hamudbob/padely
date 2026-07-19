import { useParams } from "react-router-dom";

/**
 * Matches padel_wireframe.html screen 12. Stub — should call the
 * `get_public_session(public_token)` RPC (schema.sql) and subscribe to the
 * same realtime channel as HostLivePage, read-only. See README.
 */
export default function PublicLivePage() {
  const { publicToken } = useParams();
  return (
    <div className="mx-auto max-w-sm min-h-screen bg-white px-4 py-8">
      <h1 className="text-xl font-extrabold mb-4">Public Live View</h1>
      <p className="text-sm text-slate-500">TODO: fetch via get_public_session("{publicToken}"), read-only.</p>
    </div>
  );
}
