import type { ReactElement } from "react";
import type { ClaudeRun } from "@shared/domain";
import { Panel } from "../../ui/Panel";
import styles from "./review.module.css";

const RUN_LABELS = { chunking: "Chunking", review: "Review", qa: "Question" } as const satisfies Record<ClaudeRun["kind"], string>;

const formatCost = (usd: number): string => `$${usd.toFixed(usd > 0 && usd < 0.01 ? 3 : 2)}`;

/** Sum of the recorded cost of every run; runs without a cost count as zero. */
export const totalCostUsd = (runs: readonly ClaudeRun[]): number => runs.reduce((sum, run) => sum + (run.costUsd ?? 0), 0);

/** Every Claude run for the review with its model, tokens and cost, plus the PR's total spend. */
export const CostPanel = ({ runs }: { readonly runs: readonly ClaudeRun[] }): ReactElement => {
  const ordered = [...runs].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  return (
    <Panel title={`claude usage · ${formatCost(totalCostUsd(runs))} total`}>
      {ordered.length === 0 ? (
        <p className={styles.muted}>No Claude runs yet.</p>
      ) : (
        <table className={styles.costTable}>
          <caption className={styles.visuallyHidden}>Claude runs for this review</caption>
          <thead>
            <tr>
              <th scope="col">run</th>
              <th scope="col">model</th>
              <th scope="col">status</th>
              <th scope="col">tokens in / out</th>
              <th scope="col">cost</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((run) => (
              <tr key={run.id}>
                <td>{RUN_LABELS[run.kind]}</td>
                <td>{run.model}</td>
                <td>{run.status}</td>
                <td>
                  {run.inputTokens ?? 0} / {run.outputTokens ?? 0}
                </td>
                <td>{run.costUsd === null ? "–" : formatCost(run.costUsd)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={4}>
                total
              </th>
              <td>{formatCost(totalCostUsd(runs))}</td>
            </tr>
          </tfoot>
        </table>
      )}
    </Panel>
  );
};
