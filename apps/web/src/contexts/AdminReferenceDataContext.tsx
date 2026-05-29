import { createContext, useContext, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { dbSelect } from "@/lib/db";

export type AdminMerchantPicker = {
  id: string;
  name: string;
  merchant_type: string;
  merchant_scope: string | null;
  parent_merchant_id: string | null;
  is_active: boolean;
};

type AdminReferenceData = {
  merchants: AdminMerchantPicker[];
  merchantsLoading: boolean;
  refetchMerchants: () => void;
};

const STALE_MS = 10 * 60 * 1000;

const AdminReferenceDataContext = createContext<AdminReferenceData | null>(null);

async function fetchMerchantsPicker(): Promise<AdminMerchantPicker[]> {
  return dbSelect<AdminMerchantPicker>("merchants", {
    cols: "id, name, merchant_type, merchant_scope, parent_merchant_id, is_active",
    order: { col: "name", asc: true },
  });
}

export function AdminReferenceDataProvider({ children }: { children: ReactNode }) {
  const merchantsQ = useQuery({
    queryKey: ["admin", "merchants-picker"],
    queryFn: fetchMerchantsPicker,
    staleTime: STALE_MS,
    gcTime: STALE_MS * 2,
  });

  const value: AdminReferenceData = {
    merchants: merchantsQ.data ?? [],
    merchantsLoading: merchantsQ.isLoading,
    refetchMerchants: () => { void merchantsQ.refetch(); },
  };

  return (
    <AdminReferenceDataContext.Provider value={value}>
      {children}
    </AdminReferenceDataContext.Provider>
  );
}

export function useAdminReferenceData(): AdminReferenceData {
  const ctx = useContext(AdminReferenceDataContext);
  if (!ctx) {
    throw new Error("useAdminReferenceData must be used within AdminReferenceDataProvider");
  }
  return ctx;
}

export function useAdminMerchantsPicker() {
  const { merchants, merchantsLoading, refetchMerchants } = useAdminReferenceData();
  return { merchants, loading: merchantsLoading, refetch: refetchMerchants };
}
