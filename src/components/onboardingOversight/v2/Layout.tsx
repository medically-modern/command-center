/**
 * The ONE page layout every Onboarding Oversight screen uses (Brandon: "these should all align"): the same centred
 * max-width container, the same left edge and padding, the back link and title in the same place. Screens never set
 * their own width or alignment; every top-level block spans the full container (tested by tools/qa/layout.mjs).
 */
import type { ReactNode } from "react";

export function OOPage({ back, title, children }: { back?: { label: string; onClick: () => void }; title?: ReactNode; children: ReactNode }) {
  return <div className="oo-page">
    {back && <button type="button" className="oo-back oo-block" onClick={back.onClick}>← {back.label}</button>}
    {title && <h2 className="oo-title oo-block">{title}</h2>}
    {children}
  </div>;
}
/** A full-width block on the page; the layout test measures these. */
export const Block = ({ children, className = "" }: { children: ReactNode; className?: string }) => <section className={`oo-block ${className}`}>{children}</section>;
