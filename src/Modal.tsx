import { useEffect, type ReactNode } from 'react'

interface ModalProps {
  title: string
  onClose: () => void
  children: ReactNode
  // Most panels are simple forms that read best at a fixed, narrow width.
  // A content-heavy panel (e.g. the multi-column import review table) can
  // pass 'none' to grow to whatever width its content needs — still capped
  // by the overlay's own side padding below, so it never exceeds the
  // viewport.
  maxWidth?: number | 'none'
}

// A simple overlay dialog — used for the Import CSV / Add group / Add user
// panels so they float above the list rather than expanding the page.
function Modal({ title, onClose, children, maxWidth = 720 }: ModalProps) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      role="presentation"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.4)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
        padding: '48px 16px',
        overflowY: 'auto',
        zIndex: 100,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="card"
        style={
          maxWidth === 'none'
            // Shrinks to its content's natural width (e.g. a short review
            // table stays narrow) but never past the overlay's own side
            // padding — the viewport is still the hard cap either way.
            ? { padding: '28px 32px', width: 'fit-content', maxWidth: 'calc(100vw - 32px)', marginBottom: 48 }
            : { padding: '28px 32px', maxWidth, width: '100%', marginBottom: 48 }
        }
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button type="button" className="btn" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export default Modal
