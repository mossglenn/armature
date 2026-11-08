import type { ReactNode } from 'react';

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="mb-6">
      <h1 className="text-xl font-semibold">{title}</h1>
      {children && <div className="text-muted-foreground mt-1 text-sm">{children}</div>}
    </header>
  );
}
