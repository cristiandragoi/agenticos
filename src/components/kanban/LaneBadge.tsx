"use client";
export default function LaneBadge({ kind }: { kind: string }) {
  const color =
    kind === "claude"
      ? "#d97706"
      : kind === "codex"
      ? "#10b981"
      : kind === "hermes"
      ? "#3b82f6"
      : "#94a3b8";
  return (
    <span
      style={{
        background: color,
        color: "#000",
        padding: "1px 6px",
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 600,
      }}
    >
      {kind}
    </span>
  );
}
