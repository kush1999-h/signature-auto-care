import { Skeleton } from "./skeleton";

export function ChartSkeleton() {
  return (
    <div className="w-full rounded-lg border border-border bg-muted/20 p-4">
      <Skeleton className="h-5 w-32 mb-3" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}
