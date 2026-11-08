export type ParticipantIdentity = {
  id: string;
  name: string;
  color: string;
};

const STORAGE_KEY = "brainstorm-space-participant";

const CURSOR_COLORS = [
  "#8B5CF6",
  "#EC4899",
  "#0EA5E9",
  "#10B981",
  "#F59E0B",
  "#EF4444",
  "#6366F1",
  "#14B8A6",
];

export function getParticipantIdentity(): ParticipantIdentity {
  const existing = sessionStorage.getItem(STORAGE_KEY);

  if (existing) {
    try {
      const parsed: unknown = JSON.parse(existing);

      if (parsed && typeof parsed === "object") {
        const candidate = parsed as Record<string, unknown>;

        if (
          typeof candidate.id === "string" &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            candidate.id,
          ) &&
          typeof candidate.name === "string" &&
          candidate.name.trim().length > 0 &&
          candidate.name.length <= 32 &&
          typeof candidate.color === "string" &&
          CURSOR_COLORS.includes(candidate.color)
        ) {
          return {
            id: candidate.id,
            name: candidate.name,
            color: candidate.color,
          };
        }
      }
    } catch {
      // Generate a new identity if stored data is invalid.
    }

    sessionStorage.removeItem(STORAGE_KEY);
  }

  const id = crypto.randomUUID();
  const shortId = id.replace(/-/g, "").slice(0, 4).toUpperCase();

  let hash = 0;

  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }

  const identity: ParticipantIdentity = {
    id,
    name: `Guest ${shortId}`,
    color: CURSOR_COLORS[hash % CURSOR_COLORS.length],
  };

  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(identity));

  return identity;
}