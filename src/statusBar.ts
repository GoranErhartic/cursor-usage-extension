import * as vscode from "vscode";
import { formatCents, formatUsage, percentUsed } from "./format";
import type { UsageOverall } from "./usageApi";
import { usageErrorFromCode, type UsageFetchErrorCode } from "./usageApi";

export type StatusBarView =
  | { kind: "loading" }
  | {
      kind: "ok";
      overall: UsageOverall;
      updatedAt: Date;
      billingCycleStart?: string;
      billingCycleEnd?: string;
    }
  | { kind: "error"; message: string; code?: UsageFetchErrorCode };

function formatCycleDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

export class UsageStatusBar {
  private readonly item: vscode.StatusBarItem;
  private lastUpdated: Date | undefined;

  constructor(priority: number) {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      priority,
    );
    this.item.command = "cursorUsage.refresh";
    this.item.name = "Cursor Usage";
  }

  show(): void {
    this.item.show();
  }

  dispose(): void {
    this.item.dispose();
  }

  render(view: StatusBarView): void {
    switch (view.kind) {
      case "loading":
        this.item.text = "$(sync~spin) Usage";
        this.item.tooltip = "Loading Cursor plan usage…";
        this.item.backgroundColor = undefined;
        break;
      case "error":
        this.item.text = "$(warning) Usage";
        this.item.tooltip = view.message;
        this.item.backgroundColor = new vscode.ThemeColor(
          "statusBarItem.warningBackground",
        );
        break;
      case "ok": {
        const { overall, updatedAt, billingCycleStart, billingCycleEnd } = view;
        this.lastUpdated = updatedAt;
        if (!overall.enabled) {
          this.item.text = "$(graph) Usage";
          this.item.tooltip = "Plan usage tracking is disabled for this account.";
          this.item.backgroundColor = undefined;
          break;
        }
        this.item.text = `$(graph) ${formatUsage(overall.used, overall.limit)}`;
        const pct = percentUsed(overall.used, overall.limit);
        const cycleLine =
          billingCycleStart && billingCycleEnd
            ? `Billing cycle: ${formatCycleDate(billingCycleStart)} – ${formatCycleDate(billingCycleEnd)}`
            : undefined;
        const lines = [
          `Used: ${formatUsage(overall.used, overall.limit)}`,
          `Remaining: ${formatCents(overall.remaining)}`,
          pct !== null ? `${pct.toFixed(1)}% of limit` : undefined,
          cycleLine,
          `Last updated: ${updatedAt.toLocaleString()}`,
          "Click to refresh",
        ].filter(Boolean);
        this.item.tooltip = lines.join("\n");
        if (pct !== null && pct > 100) {
          this.item.backgroundColor = new vscode.ThemeColor(
            "statusBarItem.errorBackground",
          );
        } else if (pct !== null && pct > 80) {
          this.item.backgroundColor = new vscode.ThemeColor(
            "statusBarItem.warningBackground",
          );
        } else {
          this.item.backgroundColor = undefined;
        }
        break;
      }
    }
  }

  renderFromError(err: unknown): void {
    if (err && typeof err === "object" && "code" in err) {
      const code = (err as { code: UsageFetchErrorCode }).code;
      this.render({
        kind: "error",
        code,
        message: usageErrorFromCode(code),
      });
      return;
    }
    const message =
      err instanceof Error ? err.message : "Failed to load usage.";
    this.render({ kind: "error", message });
  }
}
