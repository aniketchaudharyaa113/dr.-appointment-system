export default function StarRating({ value, size = "text-sm" }) {
  const rounded = Math.round(value);
  return (
    <span className={`font-mono ${size} text-clay-500`} aria-label={`${value} out of 5 stars`}>
      {"★".repeat(rounded)}
      <span className="text-line">{"★".repeat(5 - rounded)}</span>
    </span>
  );
}
