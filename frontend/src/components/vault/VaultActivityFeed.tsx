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
          <p data-testid="vault-activity-empty" className="text-sm text-text-secondary">No activity yet.</p>
        ) : (
          <ul data-testid="vault-activity-list" className="space-y-4">
            {events.map((event) => (
              <li key={event.id} data-testid="vault-activity-item">
                <p className="text-sm font-medium text-text-primary">{event.title}</p>
                <p className="text-xs text-text-secondary">{event.metadata}</p>
              </li>
            ))}
          </ul>
        )}
        {isLoading && (
          <p role="status" data-testid="vault-activity-loading" className="text-sm text-text-secondary">
            Loading…
          </p>
        )}
        {hasMore && !isLoading && (
          <button type="button" data-testid="vault-activity-load-more" onClick={onLoadMore} className="mt-4 text-sm text-emerald">
            Load more
          </button>
        )}
      </ErrorBoundary>
    </BentoCard>
  );
}
