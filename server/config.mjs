import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOME = os.homedir();
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  port: Number(process.env.AGENTIC_OS_PORT || 4177),
  host: process.env.AGENTIC_OS_HOST || '127.0.0.1',
  defaultAgent: process.env.AGENTIC_OS_AGENT || 'opencode',
  claudeDir: process.env.CLAUDE_DIR || path.join(HOME, '.claude'),
  agyDir: process.env.AGY_DIR || path.join(HOME, '.gemini', 'antigravity-cli'),
  projectsRoot: process.env.PROJECTS_ROOT || path.join(HOME, 'Projects'),
  vaultDir: process.env.VAULT_DIR || path.join(HOME, 'Projects', 'secondbrain'),
  memoryDir:
    process.env.MEMORY_DIR ||
    path.join(HOME, '.claude', 'projects', '-home-ravi-Projects', 'memory'),
  dataDir: process.env.AGENTIC_OS_DATA || path.join(ROOT, 'data'),
  distDir: path.join(ROOT, 'dist'),
  claudeBin: process.env.CLAUDE_BIN || 'claude',
  opencodeBin: process.env.OPENCODE_BIN || '/etc/profiles/per-user/ravi/bin/opencode',
  commandCodeBin: process.env.COMMAND_CODE_BIN || 'cmd',
};

export const paths = {
  transcripts: path.join(config.claudeDir, 'projects'),
  historyFile: path.join(config.claudeDir, 'history.jsonl'),
  statsCache: path.join(config.claudeDir, 'stats-cache.json'),
  liveSessions: path.join(config.claudeDir, 'sessions'),
  agyBrain: path.join(config.agyDir, 'brain'),
  agyDb: path.join(config.agyDir, 'conversation_summaries.db'),
  agyHistory: path.join(config.agyDir, 'history.jsonl'),
  agyPresence: path.join(config.agyDir, 'presence'),
  usageCache: path.join(config.dataDir, 'cache', 'usage-cache.json'),
  runsDir: path.join(config.dataDir, 'runs'),
  runsIndex: path.join(config.dataDir, 'runs', 'index.jsonl'),
};
