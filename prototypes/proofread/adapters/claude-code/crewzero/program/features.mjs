// 0.44.0 資訊模型第一期（「已代你收起」）：創辦人選 A，發佈版預設打開（2026-11-13）。
// 沒有設定時打開；環境值 SOS_FACT_MERGE=0 才關閉。B 退路：把 FACT_MERGE_DEFAULT 改回 false。
export const FACT_MERGE_DEFAULT = true;
export const JIA_IN_RELEASE = false;

export function factMergeOn() {
  return process.env.SOS_FACT_MERGE === '1' ? true : process.env.SOS_FACT_MERGE === '0' ? false : FACT_MERGE_DEFAULT;
}
