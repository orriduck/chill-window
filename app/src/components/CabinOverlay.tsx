/**
 * Screen-space finishing only. The carriage itself is rendered by the
 * Three.js WindowFrame, so this layer must never introduce a second fake
 * window, sill, or furniture silhouette.
 */
export function CabinOverlay() {
  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-10"
        style={{
          boxShadow: 'inset 0 0 42px 12px rgba(0, 0, 0, 0.28)',
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-10 bg-white/[0.015]"
      />
    </>
  )
}
