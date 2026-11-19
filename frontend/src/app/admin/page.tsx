"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { generateBreadcrumbs } from "@/lib/breadcrumbs";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { ForbiddenState } from "@/components/ui/ForbiddenState";
import { DlqViewerPanel } from "@/components/admin/DlqViewerPanel";

export default function AdminDashboardPage() {
  const pathname = usePathname();
  const isAdmin = useIsAdmin();
  const breadcrumbs = generateBreadcrumbs(pathname ?? "/admin");

  if (!isAdmin) {
    return (
      <div className="px-6 py-8 max-w-6xl mx-auto" data-testid="admin-dashboard-page">
        <ForbiddenState />
      </div>
    );
  }

  return (
    <div className="px-6 py-8 max-w-6xl mx-auto space-y-6" data-testid="admin-dashboard-page">
      <div>
        <Breadcrumbs items={breadcrumbs} />
        <h1 className="mt-2 text-3xl font-bold text-text-primary">Admin Dashboard</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Monitor operations, inspect dead-lettered webhook events, and manage platform controls.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link
          href="/admin/streams"
          className="rounded-xl border border-border-default bg-bg-card p-5 transition-colors hover:border-gold"
        >
          <h2 className="text-base font-semibold text-text-primary">Stream Management</h2>
          <p className="mt-1 text-sm text-text-secondary">
            Inspect active payment streams, suspend, reconcile, or preview clawbacks.
          </p>
        </Link>

        <Link
          href="/admin/audit"
          className="rounded-xl border border-border-default bg-bg-card p-5 transition-colors hover:border-gold"
        >
          <h2 className="text-base font-semibold text-text-primary">Audit History</h2>
          <p className="mt-1 text-sm text-text-secondary">
            Review signed administrative actions and operational audit logs.
          </p>
        </Link>
      </div>

      <DlqViewerPanel />
    </div>
  );
}
