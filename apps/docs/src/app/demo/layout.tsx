/**
 * Demo layout - renders children without DocsShell for full-screen canvas.
 * Theme is inherited from the root layout's DocsTheme. `kd-canvas` sets Inter, the face the
 * MSDF labels are cut from; `display: contents` so the wrapper takes no box.
 */
export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="kd-canvas" style={{ display: 'contents' }}>
      {children}
    </div>
  );
}
