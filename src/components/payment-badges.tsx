import {
  siAfterpay,
  siAmericanexpress,
  siApplepay,
  siCashapp,
  siDiscover,
  siGooglepay,
  siKlarna,
  siMastercard,
  siVisa,
  type SimpleIcon,
} from "simple-icons";

// Payment marks shown to buyers. Logos come from simple-icons; brands it
// doesn't carry (Affirm, Amazon Pay) are drawn as wordmarks in their colors.
type Mark =
  | { kind: "icon"; icon: SimpleIcon; bg?: string; fg?: string }
  | { kind: "word"; title: string; text: string; bg: string; fg: string };

const CARDS: Mark[] = [
  { kind: "icon", icon: siVisa },
  { kind: "icon", icon: siMastercard },
  { kind: "icon", icon: siAmericanexpress },
  { kind: "icon", icon: siDiscover },
];

const WALLETS_AND_LATER: Mark[] = [
  { kind: "icon", icon: siApplepay },
  { kind: "icon", icon: siGooglepay },
  { kind: "icon", icon: siKlarna, bg: "#FFB3C7", fg: "#0B051D" },
  { kind: "icon", icon: siAfterpay, bg: "#B2FCE4", fg: "#000000" },
  { kind: "word", title: "Affirm", text: "affirm", bg: "#FFFFFF", fg: "#4A4AF4" },
  { kind: "word", title: "Amazon Pay", text: "amazon pay", bg: "#232F3E", fg: "#FF9900" },
  { kind: "icon", icon: siCashapp, bg: "#00D64F", fg: "#FFFFFF" },
];

export const ALL_MARKS = [...CARDS, ...WALLETS_AND_LATER];

function Badge({ mark }: { mark: Mark }) {
  const title = mark.kind === "icon" ? mark.icon.title : mark.title;
  const bg = mark.kind === "icon" ? (mark.bg ?? "#FFFFFF") : mark.bg;
  const fg = mark.kind === "icon" ? (mark.fg ?? `#${mark.icon.hex}`) : mark.fg;
  return (
    <span
      title={title}
      aria-label={title}
      role="img"
      className="inline-flex h-8 w-12 shrink-0 overflow-hidden items-center justify-center rounded-md border border-black/10 shadow-sm"
      style={{ backgroundColor: bg }}
    >
      {mark.kind === "icon" ? (
        <svg viewBox="0 0 24 24" className="size-8" fill={fg} aria-hidden="true">
          <path d={mark.icon.path} />
        </svg>
      ) : (
        <span className="text-[9px] font-bold leading-[1.05] tracking-tight text-center" style={{ color: fg }}>
          {mark.text}
        </span>
      )}
    </span>
  );
}

export function PaymentBadges({ marks = ALL_MARKS, className = "" }: { marks?: Mark[]; className?: string }) {
  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`}>
      {marks.map((m) => (
        <Badge key={m.kind === "icon" ? m.icon.slug : m.title} mark={m} />
      ))}
    </div>
  );
}

export const CARD_MARKS = CARDS;
export const CHECKOUT_MARKS = WALLETS_AND_LATER;
