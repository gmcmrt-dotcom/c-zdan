import { rpc } from "@/lib/rpc";
import { dbSelect } from "@/lib/db";

export interface TxLike {
  id: string;
  type: string;
  reference_id : string | null;
}

interface TxRefRow { id: string; reference_id: string | null }
interface PointsLogRow { reference_id: string | null; points: number; reason: string }

/**
 * Returns Map<transaction.id, totalPoints> by joining loyalty_points_log
 * via reference_id. For refunds, transactions.reference_id points to the
 * original spend transaction.id, so we resolve that hop first.
 */
export async function fetchPointsForTxs (txs: TxLike[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (!txs.length) return result;

    // Direct ref ids for non-refund rows
    const directRefs = new Set<string>();
    // Refund rows whose reference_id is a transaction id (need a hop)
    const refundTxIds = new Set<string>();

    for (const t of txs) {
      if (!t.reference_id) continue;
      if (t.type === "refund") refundTxIds.add(t.reference_id);
      else directRefs.add(t.reference_id);
    }

    const refundTxToOriginalRef = new Map<string, string>();
    if (refundTxIds.size) {
      const origTxs = await rpc<TxRefRow[]>("my_transaction_refs", {
        _tx_ids: Array.from(refundTxIds),
      }).catch(() => [] as TxRefRow[]);
      origTxs.forEach((row) => {
        if (row.reference_id) {
          refundTxToOriginalRef.set(row.id, row.reference_id);
          directRefs.add(row.reference_id);
        }
      });
    }

    if (!directRefs.size) return result;
    const logs = await dbSelect<PointsLogRow>("loyalty_points_log", {
      cols: "reference_id, points, reason",
      where: [{ col: "reference_id", op: "in", val: Array.from(directRefs) }],
    }).catch(() => [] as PointsLogRow[]);

    const earnByRef = new Map<string, number>();
    const reversalByRef = new Map<string, number>();
    logs.forEach((l) => {
      if (!l.reference_id) return;
      if (l.reason === "refund_reversal") {
        reversalByRef.set(l.reference_id, (reversalByRef.get(l.reference_id) ?? 0) + Number(l.points));
      } else {
        earnByRef.set(l.reference_id, (earnByRef.get(l.reference_id) ?? 0) + Number(l.points));
      }
    });

    // Map back to transaction ids
    for (const t of txs) {
      if (!t.reference_id) continue;
      if (t.type === "refund") {
        const origRef = refundTxToOriginalRef .get(t.reference_id);
        if (origRef) {
          // refund_reversal log uses original payment_codes.id as reference_id
          const rev = reversalByRef .get(origRef) ?? 0;
          if (rev !== 0) result.set(t.id, rev);
        }
      } else {
        const pts = earnByRef.get(t.reference_id) ?? 0;
        if (pts !== 0) result.set(t.id, pts);
      }
    }

    return result;
}
