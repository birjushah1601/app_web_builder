// Visual fixture route: <EmptyCanvas> placeholder rendered standalone.
import EmptyCanvas from "@/components/canvas/EmptyCanvas";

export const dynamic = "force-dynamic";

export default function EmptyCanvasFixture() {
  return (
    <div style={{ height: "100vh" }}>
      <EmptyCanvas />
    </div>
  );
}
