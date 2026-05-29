import React, { Component, ReactNode } from "react";
import { rpc } from "@/lib/rpc";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface State {
  hasError: boolean;
  error: Error | null;
  diagnosticId: number | null;
}

/**
 * Tüm React component tree'sini saran error boundary.
 * Yakalanan hatayı:
 *   1) Konsola yazar
 *   2) error_diagnostics tablosuna log atar (proactive detection için)
 *   3) Kullanıcıya nazik bir mesaj + "yeniden dene" butonu gösterir
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { hasError: false, error: null, diagnosticId: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, diagnosticId: null };
  }

  async componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info);
    try {
      // I1 — Cap log_error RPC calls so a render loop that keeps throwing
      // doesn't DDOS our own server. 5 reports per minute per tab is more
      // than enough for human debugging; beyond that the report is dropped.
      // Stack trace also truncated so an attacker-controlled error message
      // can't write multi-MB rows.
      const now = Date.now();
      const w = window as Window & { __wallet_log_error?: { ts: number[] } };
      w.__wallet_log_error = w.__wallet_log_error ?? { ts: [] };
      w.__wallet_log_error.ts = w.__wallet_log_error.ts.filter((t) => now - t < 60_000);
      if (w.__wallet_log_error.ts.length >= 5) {
        console.warn("ErrorBoundary: log_error rate-limited (5/min)");
        return;
      }
      w.__wallet_log_error.ts.push(now);
      const MAX_STACK = 8_000;
      const MAX_MSG = 1_000;
      const MAX_COMPONENT_STACK = 4_000;
      const data = await rpc<number | null>("log_error", {
        _surface: "web",
        _page_key: typeof window !== "undefined" ? window.location.pathname : null,
        _function_name: null,
        _error_code: (error.name ?? "Error").slice(0, 100),
        _error_message: (error.message ?? "").slice(0, MAX_MSG),
        _stack: (error.stack ?? "").slice(0, MAX_STACK) || null,
        _context: {
          component_stack: (info.componentStack ?? "").slice(0, MAX_COMPONENT_STACK),
        },
      });
      if (typeof data === "number") this.setState({ diagnosticId: data });
    } catch {
      // sessizce yut — log atılmasa bile UI sağlam kalmalı
    }
  }

  reset = () => this.setState({ hasError: false, error: null, diagnosticId: null });

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-background border rounded-2xl p-6 text-center space-y-4">
          <div className="size-12 rounded-full bg-destructive/10 mx-auto flex items-center justify-center">
            <AlertTriangle className="size-6 text-destructive" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Bir şeyler ters gitti</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Hata sistem tarafından kayıt altına alındı. Tekrar denemek istersen aşağıdaki butona basabilirsin.
            </p>
          </div>
          {this.state.error?.message && (
            <p className="text-xs font-mono bg-muted/50 rounded p-2 text-left text-muted-foreground break-all">
              {this.state.error.message}
            </p>
          )}
          {this.state.diagnosticId && (
            <p className="text-[10px] text-muted-foreground">Ref: #{this.state.diagnosticId}</p>
          )}
          <div className="flex justify-center gap-2">
            <Button onClick={this.reset} variant="outline">
              <RefreshCw className="size-4 mr-1" /> Tekrar dene
            </Button>
            <Button onClick={() => window.location.assign("/")} variant="default">
              Ana sayfaya dön
            </Button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
