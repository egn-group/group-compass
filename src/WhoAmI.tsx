// Pure display — App.tsx owns the single /api/getMe fetch (it needs the
// roles too, to decide what else to render) and passes the email down,
// rather than this component fetching its own copy.
function WhoAmI({ email }: { email: string | null }) {
  return (
    <section className="card" style={{ padding: '16px 24px', marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <p data-testid="who-am-i">{email ? `Signed in as ${email}` : 'Loading…'}</p>
      <a className="btn btn-secondary" href="/.auth/logout">
        Sign out
      </a>
    </section>
  )
}

export default WhoAmI
