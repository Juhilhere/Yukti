import { Component, type ReactNode } from 'react';
import { AlertTriangle, Bug, RotateCcw } from 'lucide-react';
import { recordProblem } from '../lib/diagnostics';
import { tr } from '../lib/i18n';
import { uiStore } from '../lib/queries';

/** A crash in one page shows a friendly screen (reload / report) instead of a blank window. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) { return { error }; }

  componentDidCatch(error: Error) { recordProblem('crash', `${error.name}: ${error.message}`); }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });  // navigating away recovers
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-[460px] rounded-lg border border-border bg-surface p-6 text-center">
          <AlertTriangle size={28} className="mx-auto text-amber" />
          <h2 className="mt-3 text-[17px] font-semibold">{tr('crash.title', 'Something went wrong on this page')}</h2>
          <p className="mt-1.5 text-[13px] text-muted">{tr('crash.body', 'Your work is saved. Reload the page to continue. If it happens again, please report it so we can fix it.')}</p>
          <div className="mt-4 flex justify-center gap-2">
            <button className="btn" onClick={() => uiStore.openReport(`${tr('crash.reportPrefix', 'The page crashed')}: ${error.message}`)}><Bug size={13} />{tr('report.title', 'Report a problem')}</button>
            <button className="btn btn-primary" onClick={() => window.location.reload()}><RotateCcw size={13} />{tr('crash.reload', 'Reload page')}</button>
          </div>
        </div>
      </div>
    );
  }
}
