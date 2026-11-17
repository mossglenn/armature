import { useEffect, useRef, type ReactNode } from 'react';

/**
 * A page's heading. When the page opens, the keyboard's focus moves to it, so a screen reader says
 * which page this is and the next Tab starts at the page's top; before, focus stayed on the sidebar's
 * button, or was lost with the page that held it, and nothing said the page had changed (the
 * 2026-11-09 review's P13). A field the page itself put the focus in (the connect page's address)
 * keeps it.
 */
export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const active = document.activeElement;
    const inField = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement;
    if (!inField) heading.current?.focus();
  }, []);
  return (
    <header className="mb-6">
      <h1 ref={heading} tabIndex={-1} className="text-xl font-semibold outline-none">
        {title}
      </h1>
      {children && <div className="text-muted-foreground mt-1 text-sm">{children}</div>}
    </header>
  );
}
