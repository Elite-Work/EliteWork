import { BentoCard } from "@/components/ui/BentoCard";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { Activity } from "lucide-react";

export interface VaultActivityEvent {
  id: string;
  title: string;
  metadata: string;
}

interface VaultActivityFeedProps {
  events: VaultActivityEvent[];
  isLoading?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
}

export function VaultActivityFeed({
  events,
  isLoading = false,
  hasMore = false,
  onLoadMore,
}: VaultActivityFeedProps) {
  return (
    <BentoCard title="Activity" icon={<Activity className="w-5 h-5" />}>
      <ErrorBoundary>
        {events.length === 0 && !isLoading ? (
          <p className="text-sm text-text-secondary">No activity yet.</p>
        ) : (
          <ul className="space-y-4">
            {events.map((event) => (
              <li key={event.id}>
                <p className="text-sm font-medium text-text-primary">{event.title}</p>
                <p className="text-xs text-text-secondary">{event.metadata}</p>
              </li>
            ))}
          </ul>
        )}
        {isLoading && (
          <p role="status" className="text-sm text-text-secondary">
            Loading…
          </p>
        )}
        {hasMore && !isLoading && (
          <button type="button" onClick={onLoadMore} className="mt-4 text-sm text-emerald">
            Load more
          </button>
        )}
      </ErrorBoundary>
    </BentoCard>
  );
}
