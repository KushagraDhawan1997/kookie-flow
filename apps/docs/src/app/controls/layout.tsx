/**
 * Controls layout - renders children without DocsShell for full-screen canvas, as /demo does.
 * `kd-canvas` sets Inter, the face the MSDF labels are cut from; `display: contents` so the
 * wrapper takes no box.
 */
export default function ControlsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="kd-canvas" style={{ display: 'contents' }}>
      {children}
    </div>
  );
}
