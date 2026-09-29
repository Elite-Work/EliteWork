"use client";

import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

interface VirtualizedListProps<T> {
  /** Array of items to render. */
  items: T[];
  /** Height of each row in pixels. */
  rowHeight: number;
  /** Maximum height of the scrollable container. Falls back to items × rowHeight if smaller. */
  maxHeight?: number;
  /** Render function for each item. */
  renderItem: (item: T, index: number) => React.ReactNode;
  /** Unique key extractor for React keys. */
  keyExtractor: (item: T, index: number) => string;
  /** Optional className for the scroll container. */
  className?: string;
  /** Whether the list is empty. */
  isEmpty?: boolean;
  /** Empty state render. */
  emptyState?: React.ReactNode;
}

/**
 * Virtualized list component that only renders visible rows for optimal
 * performance with large datasets (10k+ rows).
 *
 * Preserves scroll position and supports keyboard/screen-reader semantics
 * via aria attributes on the scroll container.
 *
 * Usage:
 * ```tsx
 * <VirtualizedList
 *   items={trades}
 *   rowHeight={56}
 *   maxHeight={600}
 *   keyExtractor={(t) => t.tradeId}
 *   renderItem={(trade) => <TradeRow trade={trade} />}
 * />
 * ```
 */
export function VirtualizedList<T>({
  items,
  rowHeight,
  maxHeight = 600,
  renderItem,
  keyExtractor,
  className,
  isEmpty = false,
  emptyState,
}: VirtualizedListProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null);

  // useVirtualizer() returns functions that cannot be memoized, which causes
  // react-hooks/incompatible-library warnings with React Compiler. This is
  // acceptable because the virtualizer is recreated on each render and its
  // functions are used immediately in the same render cycle, so there's no
  // risk of stale UI from unmemoized functions.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 10,
  });

  const totalHeight = Math.min(items.length * rowHeight, maxHeight);

  if (isEmpty) {
    return (
      <div className={className} role="list" aria-label="Empty list">
        {emptyState ?? (
          <div className="py-12 text-center text-text-secondary text-sm">
            No items to display
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      className={`overflow-auto ${className ?? ""}`}
      style={{ height: totalHeight }}
      role="list"
      aria-label="Virtualized list"
      tabIndex={0}
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const item = items[virtualRow.index];
          return (
            <div
              key={keyExtractor(item, virtualRow.index)}
              role="listitem"
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              data-virtual-row=""
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              {renderItem(item, virtualRow.index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
