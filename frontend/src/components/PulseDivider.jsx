// The recurring signature element: a thin ECG-style pulse line.
// Used as a section divider throughout the app. `animate` makes it
// draw itself in once on mount - used sparingly (hero + key moments only).
export default function PulseDivider({ animate = false, color = "#2F6F4E" }) {
  return (
    <svg
      viewBox="0 0 400 20"
      className="pulse-divider"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path
        d="M0,10 L140,10 L155,10 L162,1 L170,19 L178,10 L192,10 L200,10 L400,10"
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={
          animate
            ? {
                strokeDasharray: 500,
                strokeDashoffset: 500,
                animation: "draw-pulse 1.4s ease-out forwards",
              }
            : undefined
        }
      />
      {animate && (
        <style>{`
          @keyframes draw-pulse {
            to { stroke-dashoffset: 0; }
          }
        `}</style>
      )}
    </svg>
  );
}
