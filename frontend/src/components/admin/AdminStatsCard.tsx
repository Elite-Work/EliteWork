"use client";

export interface AdminStatsCardProps {
  label: string;
  value?: string | number;
  loading?: boolean;
  error?: string;
}

export function AdminStatsCard({ label, value, loading, error }: AdminStatsCardProps) {
  if (loading) {
    return (
      <div aria-busy="true" data-testid="admin-stats-card-skeleton">
        <span className="sr-only">Loading {label}</span>
        <div className="animate-pulse h-6 w-24 bg-gray-200 rounded" />
      </div>
    );
  }
  if (error) {
    return (
      <div data-testid="admin-stats-card-error" role="alert">
        <span className="text-red-600">{error}</span>
      </div>
    );
  }
  return (
    <div data-testid="admin-stats-card">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-2xl font-semibold">{value ?? "—"}</p>
    </div>
  );
}
