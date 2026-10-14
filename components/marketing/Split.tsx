import { Fragment, cloneElement, isValidElement, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Word splitter for the elastic "unfold" headline reveal (globals.css, Play pass).
 * Every word becomes a .sw span carrying its index in --wi, so CSS can stagger them.
 * Spaces stay plain text between the spans, so line breaking, text-balance, copy-paste
 * and screen readers all see ordinary words. A nested element (an accent-serif word,
 * say) is kept whole and counts as one word.
 */
export function splitWords(node: ReactNode, start = 0): { nodes: ReactNode; next: number } {
  let i = start;
  const walk = (n: ReactNode, key: string): ReactNode => {
    if (typeof n === "string") {
      return n.split(/(\s+)/).map((part, j) => {
        if (!part) return null;
        if (/^\s+$/.test(part)) return part;
        const idx = i++;
        return (
          <span key={`${key}-${j}`} className="sw" style={{ ["--wi" as string]: idx }}>
            {part}
          </span>
        );
      });
    }
    if (typeof n === "number") return walk(String(n), key);
    if (Array.isArray(n)) return n.map((c, j) => <Fragment key={`${key}.${j}`}>{walk(c, `${key}.${j}`)}</Fragment>);
    if (isValidElement(n)) {
      const el = n as ReactElement<{ className?: string; style?: CSSProperties; children?: ReactNode }>;
      if (el.type === Fragment) return walk(el.props.children, key);
      const idx = i++;
      return cloneElement(el, { className: cn(el.props.className, "sw"), style: { ...el.props.style, ["--wi" as string]: idx } });
    }
    return n;
  };
  const nodes = walk(node, "w");
  return { nodes, next: i };
}

/**
 * Button label whose letters squash and spring back when the pointer arrives (MotionFx
 * replays it via [data-bounce] on the link). The real text sits in an sr-only span; the
 * letter-by-letter copy is aria-hidden, so assistive tech reads one clean label.
 */
export function BounceText({ text }: { text: string }) {
  const total = Array.from(text.replace(/\s+/g, "")).length;
  let ci = 0;
  return (
    <span className="bt" style={{ ["--cn" as string]: Math.max(1, total - 1) }}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {text.split(/(\s+)/).map((part, j) => {
          if (!part) return null;
          if (/^\s+$/.test(part)) return part;
          return (
            <span key={j} className="bt-w">
              {Array.from(part).map((c, k) => (
                <span key={k} className="bt-c" style={{ ["--ci" as string]: ci++ }}>
                  {c}
                </span>
              ))}
            </span>
          );
        })}
      </span>
    </span>
  );
}
