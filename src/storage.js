// Key-value storage backed by the SQLite API server (see /server).
export const storage = {
  async get(key) {
    const res = await fetch(`/api/kv/${encodeURIComponent(key)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`storage.get(${key}) failed: ${res.status}`);
    return res.json();
  },
  async set(key, value) {
    const res = await fetch(`/api/kv/${encodeURIComponent(key)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    });
    if (!res.ok) throw new Error(`storage.set(${key}) failed: ${res.status}`);
  },
  async delete(key) {
    const res = await fetch(`/api/kv/${encodeURIComponent(key)}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`storage.delete(${key}) failed: ${res.status}`);
  },
};
