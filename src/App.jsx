import { useCallback, useMemo, useState } from 'react';
import { useApi } from './api.js';
import Header from './components/Header.jsx';
import SkillDeck from './components/SkillDeck.jsx';
import RunConsole from './components/RunConsole.jsx';
import CostChart from './components/CostChart.jsx';
import StatTiles from './components/StatTiles.jsx';
import Heatmap from './components/Heatmap.jsx';
import VaultCard from './components/VaultCard.jsx';
import ProjectList from './components/ProjectList.jsx';
import RunHistory from './components/RunHistory.jsx';

export default function App() {
  const overview = useApi('/overview', { pollMs: 15000 });
  const usage = useApi('/usage?days=45');
  const activity = useApi('/activity');
  const vault = useApi('/vault');
  const projects = useApi('/projects');
  const skillsApi = useApi('/skills');
  const runs = useApi('/runs', { pollMs: 20000 });

  // { runId, skill, fallback? } — what the console is showing
  const [active, setActive] = useState(null);

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
  }, [skillsApi.data]);

  return (
    <div className="mx-auto max-w-[1360px] space-y-4 px-5 py-5">
      <Header overview={overview.data} />

      <SkillDeck
        skills={skills}
        lastRuns={skillsApi.data?.lastRuns}
        runningSkillIds={runningSkillIds}
        onStart={onStart}
      />

      {active && (
        <RunConsole
          key={active.runId}
          runId={active.runId}
          skill={active.skill}
          fallback={active.fallback}
          onClose={() => setActive(null)}
          onFinished={onFinished}
        />
      )}

      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-12 lg:col-span-8">
          <CostChart usage={usage.data} />
        </div>
        <div className="col-span-12 lg:col-span-4">
          <StatTiles overview={overview.data} usage={usage.data} />
        </div>

        <div className="col-span-12 lg:col-span-7">
          <Heatmap activity={activity.data} />
        </div>
        <div className="col-span-12 lg:col-span-5">
          <VaultCard vault={vault.data} />
        </div>

        <div className="col-span-12 lg:col-span-7">
          <RunHistory runs={runs.data} skills={skills} onSelect={onSelectRun} />
        </div>
        <div className="col-span-12 lg:col-span-5">
          <ProjectList projects={projects.data} />
        </div>
      </div>

      <footer className="pb-2 text-center font-mono text-[0.62rem] tracking-wider text-faint">
        agentic-os · wraps claude code headless · vault: secondbrain · costs are API-equivalent estimates
      </footer>
    </div>
  );
}
