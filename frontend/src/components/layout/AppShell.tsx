"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { AppTopNav } from "@/components/layout/AppTopNav";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { ConnectivityBanner } from "@/components/ui/ConnectivityBanner";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();
  const isAdminRoute = pathname?.startsWith("/admin") ?? false;

  return (
    <div className="flex flex-col h-screen">
      {isAdminRoute && (
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-bg-card focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-text-primary focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-status-info"
        >
          Skip to main content
        </a>
      )}
      <ConnectivityBanner />
      <AppTopNav
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        isSidebarOpen={sidebarOpen}
      />
      <div className="flex flex-1 overflow-hidden">
        <AppSidebar
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />
        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 overflow-y-auto h-full pt-2 focus:outline-none"
        >
          {children}
        </main>
      </div>
    </div>
  );
}