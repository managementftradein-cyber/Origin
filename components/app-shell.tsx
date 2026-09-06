export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell-bg">
      <div className="app-shell-frame">{children}</div>
    </div>
  );
}
