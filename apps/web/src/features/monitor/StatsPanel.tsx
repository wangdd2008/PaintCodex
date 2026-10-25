import type { MonitorStats } from '@paintcodex/protocol';
import { formatDuration, formatPercent } from './monitor-format';

interface StatsPanelProps {
  stats: MonitorStats | null;
  error: string | null;
}

export function StatsPanel({ stats, error }: StatsPanelProps) {
  if (stats === null) {
    return (
      <section className="stats-panel" aria-label="Monitor stats">
        <div className="stats-panel__header">
          <h2 className="monitor-heading">Overview</h2>
        </div>
        {error ? (
          <p className="monitor-error">{error}</p>
        ) : (
          <p className="monitor-empty">Waiting for stats…</p>
        )}
      </section>
    );
  }

  const maxCount = Math.max(1, ...stats.categoryCounts.map((entry) => entry.count));

  return (
    <section className="stats-panel" aria-label="Monitor stats">
      <div className="stats-panel__header">
        <h2 className="monitor-heading">Overview</h2>
        <span className="monitor-muted">
          Last {Math.max(1, Math.round(stats.windowMs / 60_000))} min
        </span>
        <span className="monitor-spacer" />
        <span className="monitor-muted">{stats.totalLogs} logs</span>
      </div>

      {error ? <p className="monitor-error">{error}</p> : null}

      <div className="stat-cards">
        <StatCard label="Requests / s" value={stats.requestsPerSecond.toFixed(2)} />
        <StatCard label="Requests" value={String(stats.requestCount)} />
        <StatCard
          label="Error rate"
          value={formatPercent(stats.errorRate)}
          hint={`${stats.errorCount} errors`}
          tone={stats.errorRate > 0 ? 'danger' : undefined}
        />
        <StatCard label="Avg duration" value={formatDuration(stats.avgDurationMs)} />
        <StatCard
          label="AI success"
          value={formatPercent(stats.aiChatSuccessRate)}
          hint={`${stats.aiChatSuccessCount} / ${stats.aiChatCount} chats`}
        />
      </div>

      <div className="category-bars">
        {stats.categoryCounts.map((entry) => {
          const width = entry.count === 0 ? 0 : Math.max(2, (entry.count / maxCount) * 100);
          const errorShare = entry.count === 0 ? 0 : (entry.errorCount / entry.count) * 100;

          return (
            <div className="category-bar" key={entry.category}>
              <span className="category-bar__label">{entry.category}</span>
              <div
                className="category-bar__track"
                title={`${entry.count} logs, ${entry.errorCount} errors`}
              >
                <div className="category-bar__fill" style={{ width: `${width}%` }}>
                  <div className="category-bar__errors" style={{ width: `${errorShare}%` }} />
                </div>
              </div>
              <span className="category-bar__value">
                {entry.count}
                {entry.errorCount > 0 ? (
                  <span className="category-bar__error-count"> · {entry.errorCount} err</span>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

interface StatCardProps {
  label: string;
  value: string;
  hint?: string;
  tone?: 'danger';
}

function StatCard({ label, value, hint, tone }: StatCardProps) {
  return (
    <div className={tone === 'danger' ? 'stat-card stat-card--danger' : 'stat-card'}>
      <span className="stat-card__label">{label}</span>
      <span className="stat-card__value">{value}</span>
      {hint ? <span className="stat-card__hint">{hint}</span> : null}
    </div>
  );
}
