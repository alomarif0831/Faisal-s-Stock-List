// Text matching shared by the catalog search, Find a Deal and deal alerts,
// so "16 pm 256" finds the same listings everywhere. Pure functions (no DB)
// so they're easy to test.

export type ParsedQuery = {
  tokens: string[];
  minCents: number | null;
  maxCents: number | null;
};

// Reseller shorthand -> words the listings use.
const ALIASES: [RegExp, string][] = [
  [/\b(\d+)\s*pm\b/g, "$1 pro max"],
  [/\bpm\b/g, "pro max"],
  [/\bs(\d{2})\s*u\b/g, "s$1 ultra"],
  [/\bs(\d{2})\s*\+/g, "s$1 plus"],
  [/\b(\d{2})\s*\+/g, "$1 plus"],
  [/\bip\s*(?=\d)/g, "iphone "],
  [/\bip\b/g, "iphone"],
  [/\bmbp\b/g, "macbook pro"],
  [/\bmba\b/g, "macbook air"],
  [/\baw\b/g, "apple watch"],
  [/\bapp\b/g, "airpods pro"],
  [/\bsealed\b/g, "new sealed"],
];

const STOPWORDS = new Set(["the", "a", "an", "for", "and", "with", "in", "of", "gb", "or", "any", "looking", "need", "want", "wtb"]);

/** Lowercase words, split at letter/digit boundaries: "S25U 256GB" -> s 25 u 256 gb. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function dollars(raw: string): number | null {
  const m = raw.replace(/,/g, "").match(/^(\d+(?:\.\d+)?)(k?)$/i);
  if (!m) return null;
  const n = Number(m[1]) * (m[2] ? 1000 : 1);
  return n > 0 ? Math.round(n * 100) : null;
}

/**
 * "iphone 16 pm 256 under $900" -> tokens [iphone, 16, pro, max, 256], max $900.
 * Prices count only with a $ sign or a word like under/below/over, so model
 * numbers ("256", "15") are never mistaken for prices.
 */
export function parseQuery(q: string): ParsedQuery {
  let text = ` ${q.toLowerCase()} `;
  let minCents: number | null = null;
  let maxCents: number | null = null;
  const num = String.raw`\$?\s*(\d[\d,]*(?:\.\d+)?k?)`;

  text = text.replace(new RegExp(String.raw`\b(under|below|less than|up to|upto|at most|budget)\s*${num}`, "g"), (_, __, v) => {
    maxCents = dollars(v) ?? maxCents;
    return " ";
  });
  text = text.replace(new RegExp(String.raw`(<=?)\s*${num}`, "g"), (_, __, v) => {
    maxCents = dollars(v) ?? maxCents;
    return " ";
  });
  text = text.replace(new RegExp(String.raw`\b(over|above|more than|at least)\s*${num}`, "g"), (_, __, v) => {
    minCents = dollars(v) ?? minCents;
    return " ";
  });
  text = text.replace(new RegExp(String.raw`\$\s*(\d[\d,]*(?:\.\d+)?k?)\s*-\s*\$?\s*(\d[\d,]*(?:\.\d+)?k?)`, "g"), (_, a, b) => {
    minCents = dollars(a) ?? minCents;
    maxCents = dollars(b) ?? maxCents;
    return " ";
  });
  text = text.replace(/\$\s*(\d[\d,]*(?:\.\d+)?k?)/g, (_, v) => {
    maxCents = dollars(v) ?? maxCents;
    return " ";
  });

  for (const [re, to] of ALIASES) text = text.replace(re, to);
  const tokens = [...new Set(tokenize(text).filter((t) => !STOPWORDS.has(t)))].slice(0, 12);
  return { tokens, minCents, maxCents };
}

export type Searchable = {
  title: string;
  brand: string;
  model: string | null;
  storage: string | null;
  color: string | null;
  condition: string;
  details: string | null;
  sellerName: string | null;
};

/** Returns a predicate that's true when a listing contains every query word. */
export function textMatcher(tokens: string[]): (l: Searchable) => boolean {
  if (!tokens.length) return () => true;
  return (l) => {
    const text = [l.title, l.brand, l.model, l.storage, l.color, l.condition, l.details, l.sellerName]
      .filter(Boolean)
      .join(" ");
    const words = tokenize(text);
    const compact = words.join("");
    return tokens.every((t) => {
      if (/^\d+$/.test(t)) {
        // numbers match whole: "12" must not match "128"
        return words.includes(t);
      }
      // words match by prefix ("sams" -> samsung); longer letter runs also
      // match across word gaps ("promax" -> "pro max")
      return words.some((w) => w.startsWith(t)) || (t.length >= 4 && compact.includes(t));
    });
  };
}

/** Matcher for a full query string, including any price in it. */
export function queryMatcher(
  q: string,
  opts: { maxCents?: number | null; minCents?: number | null; condition?: string | null } = {},
): (l: Searchable & { salePriceCents: number | null }) => boolean {
  const parsed = parseQuery(q);
  const text = textMatcher(parsed.tokens);
  const max = opts.maxCents ?? parsed.maxCents;
  const min = opts.minCents ?? parsed.minCents;
  return (l) => {
    if (opts.condition && l.condition !== opts.condition) return false;
    if (max != null && (l.salePriceCents == null || l.salePriceCents > max)) return false;
    if (min != null && (l.salePriceCents == null || l.salePriceCents < min)) return false;
    return text(l);
  };
}
