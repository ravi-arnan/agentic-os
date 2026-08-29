import { useCallback, useMemo, useState } from 'react';
import { useApi } from './api.js';
import Sidebar from './components/Sidebar.jsx';
import Header from './components/Header.jsx';
import SkillDeck from './components/SkillDeck.jsx';
import RunConsole from './components/RunConsole.jsx';
import CostChart from './components/CostChart.jsx';
import WeeklyUsage from './components/WeeklyUsage.jsx';
import StatTiles from './components/StatTiles.jsx';
import Heatmap from './components/Heatmap.jsx';
import VaultCard from './components/VaultCard.jsx';
import VaultGraph from './components/VaultGraph.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import ProjectList from './components/ProjectList.jsx';
import RunHistory from './components/RunHistory.jsx';
import AlertBanner from './components/AlertBanner.jsx';

export default function App() {
  const overview = useApi('/overview', { pollMs: 15000 });
  const usage = useApi('/usage?days=45');
  const activity = useApi('/activity');
  const vault = useApi('/vault');
  const projects = useApi('/projects');
  const skillsApi = useApi('/skills', { pollMs: 60000 });
  const runs = useApi('/runs', { pollMs: 20000 });

  // { runId, skill, fallback? } — what the console is showing
  const [active, setActive] = useState(null);
  const [view, setView] = useState('overview');

  const skills = skillsApi.data?.skills;

  const runningSkillIds = useMemo(() => {
    const ids = new Set((runs.data || []).filter((r) => r.status === 'running').map((r) => r.skillId));
    if (active?.live) ids.add(active.skill?.id);
    return ids;
  }, [runs.data, active]);

  const onStart = useCallback((runId, skill) => {
    setActive({ runId, skill, live: true });
    runs.refresh();
  }, [runs]);

  const onFinished = useCallback(() => {
    setActive((a) => (a ? { ...a, live: false } : a));
    runs.refresh();
    skillsApi.refresh();
    vault.refresh();
    overview.refresh();
  }, [runs, skillsApi, vault, overview]);

  const onSelectRun = useCallback((run) => {
    const skill = (skillsApi.data?.skills || []).find((s) => s.id === run.skillId);
    setActive({ runId: run.id, skill, live: run.status === 'running', fallback: run });
    setView('runs');
  }, [skillsApi.data]);

  const runConsole = active && (
    <RunConsole
      key={active.runId}
      runId={active.runId}
      skill={active.skill}
      fallback={active.fallback}
      onClose={() => setActive(null)}
      onFinished={onFinished}
    />
  );

  return (
    <div className="flex min-h-screen">
      <Sidebar view={view} onNav={setView} running={runningSkillIds.size} />

      <div className="flex min-w-0 flex-1 flex-col">
        <Header view={view} overview={overview.data} />

        <main className="mx-auto w-full max-w-[1400px] flex-1 space-y-4 p-6">
          <AlertBanner
            alerts={skillsApi.data?.alerts}
            skills={skills}
            onSelect={() => setView('skills')}
          />
          {view === 'overview' && (
            <div className="grid grid-cols-12 gap-3">
              <div className="col-span-12 lg:col-span-8">
                <CostChart usage={usage.data} />
              </div>
              <div className="col-span-12 lg:col-span-4">
                <StatTiles overview={overview.data} usage={usage.data} />
              </div>
              <div className="col-span-12">
                <WeeklyUsage usage={usage.data} />
              </div>
              <div className="col-span-12">
                <Heatmap activity={activity.data} />
              </div>
            </div>
          )}

          {view === 'skills' && (
            <>
              <SkillDeck
                skills={skills}
                lastRuns={skillsApi.data?.lastRuns}
                runningSkillIds={runningSkillIds}
                onStart={onStart}
              />
              {runConsole}
            </>
          )}

          {view === 'runs' && (
            <>
              {runConsole}
              <RunHistory runs={runs.data} skills={skills} onSelect={onSelectRun} />
            </>
          )}

          {view === 'vault' && (
            <>
              <VaultCard vault={vault.data} />
              <ErrorBoundary>
                <VaultGraph graph={vault.data?.graph} />
              </ErrorBoundary>
            </>
          )}

          {view === 'projects' && <ProjectList projects={projects.data} />}
        </main>

        <footer className="text-faint pb-1 text-center font-mono text-[0.62rem] tracking-wider">
          agentic-os · wraps opencode headless · costs are API-equivalent estimates (claude usage only)
        </footer>
      </div>
    </div>
  );
}
