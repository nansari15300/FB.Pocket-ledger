/** Transaction row menu mark: 3×3 dots. */
export function TxnRowMenuGrip() {
  return (
    <span
      aria-hidden="true"
      data-pl-txn-row-menu-grip=""
      className="inline-grid grid-cols-3 gap-[1.5px] text-muted-foreground"
    >
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className="block h-[2.5px] w-[2.5px] rounded-full bg-current" />
      ))}
    </span>
  );
}
