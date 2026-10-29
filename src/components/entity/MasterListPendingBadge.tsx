/** Pink pending-approval diamond — sits on top of the list card, not clipped inside the avatar. */
export function MasterListPendingBadge({ count }: { count: number }) {
  if (!(count > 0)) return null;
  return (
    <span className="pl-master-list-pending-badge" aria-label={`${count} pending approval`}>
      <span>{count}</span>
    </span>
  );
}
