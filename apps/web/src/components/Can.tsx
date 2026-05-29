import { ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";

/**
 * <Can do="members.balance:view_full"> ... </Can>
 *
 * Render eder sadece kullanıcının izin matrisinde resource:action varsa.
 *
 * Örnekler:
 *   <Can do="members:freeze"><Button>Dondur</Button></Can>
 *   <Can do="transactions:refund" fallback={<i>Yetkin yok</i>}>...</Can>
 *   <Can any={["members.balance:view_full","members.balance:view_masked"]}>...</Can>
 */
type Props = {
  children: ReactNode;
  /** "resource:action" formatında tek izin */
  do?: string;
  /** Birden fazla — herhangi biri varsa render eder */
  any?: string[];
  /** Tüm izinler gerekli ise */
  all?: string[];
  /** Yetki yoksa render edilecek (varsayılan: null) */
  fallback?: ReactNode;
};

function parse(spec: string): { resource: string; action: string } {
  const [resource, action = "view"] = spec.split(":");
  return { resource, action };
}

export function Can({ children, do: single, any, all, fallback = null }: Props) {
  const { can } = useAuth();

  let allowed = false;
  if (single) {
    const { resource, action } = parse(single);
    allowed = can(resource, action);
  } else if (any && any.length > 0) {
    allowed = any.some((s) => {
      const { resource, action } = parse(s);
      return can(resource, action);
    });
  } else if (all && all.length > 0) {
    allowed = all.every((s) => {
      const { resource, action } = parse(s);
      return can(resource, action);
    });
  }

  return <>{allowed ? children : fallback}</>;
}

/** Hook formu: koşullu işlemler için */
export function useCan() {
  const { can, canAny } = useAuth();
  return { can, canAny };
}
