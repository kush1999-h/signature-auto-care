import { Skeleton } from "./skeleton";

export function MetricSkeletonGrid() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {Array.from({ length: 4 }).map((_, idx) => (
        <div key={idx} className="rounded-lg border border-border bg-muted/20 p-4">
          <Skeleton className="h-4 w-20 mb-2" />
          <Skeleton className="h-6 w-28" />
        </div>
      ))}
    </div>
  );
}
