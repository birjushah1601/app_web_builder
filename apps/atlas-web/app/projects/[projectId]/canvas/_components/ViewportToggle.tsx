"use client";

export type ViewportId = "desktop" | "tablet" | "mobile";

export const VIEWPORTS: Record<ViewportId, { width: number; height: number }> = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 375, height: 667 },
};

const LABELS: Record<ViewportId, string> = {
  desktop: "Desktop",
  tablet: "Tablet",
  mobile: "Mobile",
};

interface ViewportToggleProps {
  viewport: ViewportId;
  onViewportChange: (v: ViewportId) => void;
  className?: string;
}

export function ViewportToggle({ viewport, onViewportChange, className }: ViewportToggleProps) {
  return (
    <div
      role="group"
      aria-label="Preview viewport"
      className={className ?? "flex gap-1 rounded-md border p-1"}
    >
      {(["desktop", "tablet", "mobile"] as ViewportId[]).map((id) => (
        <button
          key={id}
          type="button"
          aria-pressed={viewport === id}
          onClick={() => onViewportChange(id)}
          className={[
            "rounded px-3 py-1 text-sm font-medium transition-colors",
            viewport === id
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted",
          ].join(" ")}
        >
          {LABELS[id]}
        </button>
      ))}
    </div>
  );
}
