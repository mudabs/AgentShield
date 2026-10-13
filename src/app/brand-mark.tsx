/** The AgentShield shield mark, drawn inline so it stays sharp at any size. */
export function BrandMark({ className = "h-10 w-10" }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 100 100">
      <rect fill="#080a0d" height="100" rx="22" width="100" />
      <path d="M50 10 L83 19 V53 C83 72 68 84 50 92 C32 84 17 72 17 53 V19 Z" fill="#bef264" />
      <path d="M50 18 L76 25 V53 C76 67 64 77 50 84 C36 77 24 67 24 53 V25 Z" fill="none" stroke="#080a0d" strokeWidth="4" />
      <text fill="#080a0d" fontFamily="Inter, Arial, Helvetica, sans-serif" fontSize="36" fontWeight="900" textAnchor="middle" x="50" y="63">
        A
      </text>
    </svg>
  );
}
