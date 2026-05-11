export default function Page() {
  return (
    <main
      style={{
        fontFamily: "system-ui, -apple-system, sans-serif",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        padding: "2rem",
        textAlign: "center"
      }}
    >
      <h1 style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>Atlas sandbox is live</h1>
      <p style={{ color: "#475569", marginBottom: "1.5rem" }}>
        This blank Next.js app is the starting point. Atlas's developer role
        will write code into <code>/code/src/</code>; the dev server picks it
        up via HMR and you'll see it here.
      </p>
      <p style={{ color: "#94a3b8", fontSize: "0.875rem" }}>
        next.js 15 · port 3000 · {new Date().getFullYear()}
      </p>
    </main>
  );
}
