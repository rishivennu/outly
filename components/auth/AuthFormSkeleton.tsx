/** Shown for the instant the form's client code is still arriving, so the card is never empty. Same rhythm as AuthForm. */
export function AuthFormSkeleton({ fields = 2 }: { fields?: number }) {
  return (
    <div aria-hidden="true" className="animate-pulse motion-reduce:animate-none">
      <div className="mb-4 h-[34px] w-[34px] rounded-xl bg-secondary" />
      <div className="h-9 w-3/4 rounded-lg bg-secondary" />
      <div className="mb-6 mt-3.5 h-4 w-11/12 rounded bg-secondary/70" />
      <div className="space-y-4">
        {Array.from({ length: fields }, (_, i) => (
          <div key={i}>
            <div className="mb-1.5 h-4 w-24 rounded bg-secondary/80" />
            <div className="h-12 rounded-xl bg-secondary/60 hairline" />
          </div>
        ))}
        <div className="h-12 rounded-full bg-lime/40" />
        <div className="h-12 rounded-full bg-secondary" />
      </div>
    </div>
  );
}
