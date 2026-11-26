"use client";

import { useState } from "react";
import Link from "next/link";
import { api, PilotRegisterResponse } from "@/lib/api";

export default function CooperativePage() {
  const [formData, setFormData] = useState({
    name: "",
    adminWallet: "",
    contactEmail: "",
    region: "",
    description: "",
    estimatedMembers: "",
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registeredRecord, setRegisteredRecord] = useState<PilotRegisterResponse | null>(null);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      let record: PilotRegisterResponse;
      if (api.cooperatives && typeof api.cooperatives.pilotRegister === "function") {
        record = await api.cooperatives.pilotRegister({
          name: formData.name,
          adminWallet: formData.adminWallet,
          contactEmail: formData.contactEmail,
          region: formData.region,
          description: formData.description || undefined,
          estimatedMembers: formData.estimatedMembers
            ? parseInt(formData.estimatedMembers, 10)
            : undefined,
        });
      } else {
        const res = await fetch("/api/cooperatives/pilot-register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: formData.name,
            adminWallet: formData.adminWallet,
            contactEmail: formData.contactEmail,
            region: formData.region,
            description: formData.description || undefined,
            estimatedMembers: formData.estimatedMembers
              ? parseInt(formData.estimatedMembers, 10)
              : undefined,
          }),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.message || "Failed to register cooperative");
        }
        record = await res.json();
      }

      setRegisteredRecord(record);
    } catch (err: any) {
      setError(err?.message || "An unexpected error occurred during pilot registration.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    setFormData({
      name: "",
      adminWallet: "",
      contactEmail: "",
      region: "",
      description: "",
      estimatedMembers: "",
    });
    setRegisteredRecord(null);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-2xl mx-auto">
        <header className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">
            Cooperative Pilot Program
          </h1>
          <p className="mt-2 text-slate-600">
            Phase 4 regional cooperative pilot onboarding with complimentary trial-period access.
          </p>
        </header>

        {registeredRecord ? (
          <div
            data-testid="confirmation-state"
            className="bg-white p-8 rounded-xl shadow-sm border border-emerald-200"
          >
            <div className="flex items-center space-x-3 mb-6">
              <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 font-bold">
                ✓
              </div>
              <div>
                <h2 className="text-xl font-semibold text-slate-900">
                  Pilot Registration Confirmed!
                </h2>
                <p className="text-sm text-emerald-700 font-medium">
                  Trial period has been successfully activated.
                </p>
              </div>
            </div>

            <div className="space-y-4 bg-slate-50 p-6 rounded-lg border border-slate-200 mb-6 text-sm text-slate-800">
              <div className="flex justify-between">
                <span className="text-slate-500">Cooperative ID:</span>
                <span className="font-mono font-medium">{registeredRecord.id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Cooperative Name:</span>
                <span className="font-medium">{registeredRecord.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Region:</span>
                <span className="font-medium">{registeredRecord.region}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Admin Wallet:</span>
                <span className="font-mono text-xs truncate max-w-xs">{registeredRecord.adminWallet}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Trial Period:</span>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
                  {registeredRecord.trialDays || 90} Days Active
                </span>
              </div>
              {registeredRecord.trialEndsAt && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Trial Valid Until:</span>
                  <span className="font-medium">
                    {new Date(registeredRecord.trialEndsAt).toLocaleDateString()}
                  </span>
                </div>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-4 justify-between">
              <button
                type="button"
                onClick={handleReset}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition"
              >
                Register Another Cooperative
              </button>
              <Link
                href="/cooperative/bulk-import"
                className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 text-center transition"
              >
                Go to Bulk Import
              </Link>
            </div>
          </div>
        ) : (
          <div className="bg-white p-8 rounded-xl shadow-sm border border-slate-200">
            <h2 className="text-xl font-semibold text-slate-900 mb-6">
              Register Cooperative
            </h2>

            {error && (
              <div
                role="alert"
                className="mb-6 p-4 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-800"
              >
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-slate-700 mb-1">
                  Cooperative Name *
                </label>
                <input
                  type="text"
                  id="name"
                  name="name"
                  required
                  value={formData.name}
                  onChange={handleChange}
                  placeholder="e.g. Northern Valley Farmers Alliance"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label htmlFor="adminWallet" className="block text-sm font-medium text-slate-700 mb-1">
                  Admin Stellar Wallet Address *
                </label>
                <input
                  type="text"
                  id="adminWallet"
                  name="adminWallet"
                  required
                  value={formData.adminWallet}
                  onChange={handleChange}
                  placeholder="G..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono text-sm"
                />
              </div>

              <div>
                <label htmlFor="contactEmail" className="block text-sm font-medium text-slate-700 mb-1">
                  Contact Email *
                </label>
                <input
                  type="email"
                  id="contactEmail"
                  name="contactEmail"
                  required
                  value={formData.contactEmail}
                  onChange={handleChange}
                  placeholder="admin@cooperative.org"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label htmlFor="region" className="block text-sm font-medium text-slate-700 mb-1">
                  Region / State *
                </label>
                <input
                  type="text"
                  id="region"
                  name="region"
                  required
                  value={formData.region}
                  onChange={handleChange}
                  placeholder="e.g. Kano, Nigeria"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label htmlFor="estimatedMembers" className="block text-sm font-medium text-slate-700 mb-1">
                  Estimated Members (optional)
                </label>
                <input
                  type="number"
                  id="estimatedMembers"
                  name="estimatedMembers"
                  min="1"
                  value={formData.estimatedMembers}
                  onChange={handleChange}
                  placeholder="e.g. 150"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label htmlFor="description" className="block text-sm font-medium text-slate-700 mb-1">
                  Description / Commodity Focus (optional)
                </label>
                <textarea
                  id="description"
                  name="description"
                  rows={3}
                  value={formData.description}
                  onChange={handleChange}
                  placeholder="Describe your members' main crops, supply chain needs, or commodities..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                />
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-3 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 disabled:opacity-50 transition"
                >
                  {isSubmitting ? "Submitting Registration..." : "Register Cooperative for Pilot"}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
