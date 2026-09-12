/**
 * Header demo layout — full-screen board, no docs shell. Theme comes from the root DocsTheme.
 * `kd-canvas` sets Inter, the face the MSDF labels are cut from; `display: contents` so the
 * wrapper takes no box.
 */
export default function DemoHeaderLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="kd-canvas" style={{ display: 'contents' }}>
      {children}
    </div>
  );
}
