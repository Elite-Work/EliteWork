"use client";
import { createContext, useContext, useState, useEffect } from "react";

export type TradeData = {
  // Step 1
  commodity: string;
  quantity: string;
  unit: string;
  pricePerUnit: string;
  currency: string;
  sellerAddress: string;
  // Step 2
  buyerRatio: number;
  sellerRatio: number;
  deliveryDays: string;
  notes: string;
};

type TradeContextType = {
  step: number;
  setStep: (s: number) => void;
  data: TradeData;
  update: (partial: Partial<TradeData>) => void;
};

const defaults: TradeData = {
  commodity: "",
  quantity: "",
  unit: "kg",
  pricePerUnit: "",
  currency: "NGN",
  sellerAddress: "",
  buyerRatio: 50,
  sellerRatio: 50,
  deliveryDays: "7",
  notes: "",
};

const TradeContext = createContext<TradeContextType>({} as TradeContextType);

const STORAGE_KEY = "amana:draft-trade";

export function TradeProvider({ children }: { children: React.ReactNode }) {
  const [step, setStep] = useState(() => {
    if (typeof window !== "undefined") {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed.step) return parsed.step;
        }
      } catch {}
    }
    return 1;
  });
  const [data, setData] = useState<TradeData>(() => {
    if (typeof window !== "undefined") {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          return { ...defaults, ...parsed.data } as TradeData;
        }
      } catch {}
    }
    return defaults;
  });

  // Persist draft locally — survives refresh/restart, replays via offline queue
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ data, step, savedAt: new Date().toISOString() }));
    } catch {}
  }, [data, step]);

  const update = (partial: Partial<TradeData>) =>
    setData((prev) => ({ ...prev, ...partial }));

  return (
    <TradeContext.Provider value={{ step, setStep, data, update }}>
      {children}
    </TradeContext.Provider>
  );
}

export const useTrade = () => useContext(TradeContext);
