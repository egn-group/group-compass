import NotificationBell from './NotificationBell'

interface HeaderProps {
  email: string | null
  name: string | null
  initials: string | null
  isAdmin: boolean
  onOpenViewAs: () => void
}

// Same division as My Path's header (the sibling app this one mirrors):
// logo + app name on the left; notifications, admin-only actions, the
// signed-in identity, and sign-out on the right, in a full-width sticky
// bar above the page content.
function Header({ email, name, initials, isAdmin, onOpenViewAs }: HeaderProps) {
  const displayName = name ?? email ?? 'Loading…'
  const displayInitials = initials ?? (email ? email[0]!.toUpperCase() : '?')

  return (
    <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, zIndex: 100 }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 68 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              background: 'var(--egn-navy)',
              color: 'var(--egn-white)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: 14,
              flexShrink: 0,
            }}
          >
            GC
          </div>
          <span style={{ fontWeight: 700, color: 'var(--text-main)', fontSize: 18 }}>Group Compass</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <NotificationBell />

          {isAdmin && (
            <button type="button" className="btn" onClick={onOpenViewAs}>
              View as…
            </button>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--egn-sand)', borderRadius: 999, padding: '6px 16px 6px 6px' }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                background: 'var(--egn-navy)',
                color: 'var(--egn-white)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 12,
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              {displayInitials}
            </div>
            <span data-testid="who-am-i" style={{ fontSize: 14, color: 'var(--text-main)', whiteSpace: 'nowrap' }}>
              {displayName}
            </span>
          </div>

          <a className="btn" href="/.auth/logout" aria-label="Sign out" title="Sign out" style={{ padding: 8 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </a>
        </div>
      </div>
    </div>
  )
}

export default Header
