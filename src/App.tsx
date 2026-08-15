import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider } from './store/appStore';
import { DataProvider } from './store/dataStore';
import { HermesProvider } from './store/hermesStore';
import { CodexProvider } from './store/codexStore';
import { ProjectProvider } from './store/projectStore';
import AppShell from './components/layout/AppShell';
import ErrorBoundary from './components/ErrorBoundary';

/* ─── Pages ─── */
import MissionControl from './pages/MissionControlPage';
import JarvisStudio from './pages/JarvisStudio';
import { JarvisV2Demo } from './components/jarvis-visualization-v2';
import MemoryStudio from './pages/MemoryStudio';
import AgentsGallery from './pages/AgentsGallery';
import AgentDetail from './pages/AgentDetail';
import OrnithDashboard from './pages/OrnithDashboard';
import RunsInspector from './pages/RunsInspector';
import ProvidersBoard from './pages/ProvidersBoard';
import MemoryBoard from './pages/MemoryBoard';
import BuildsGallery from './pages/BuildsGallery';
import ControlRoom from './pages/ControlRoom';
import BoardsGallery from './pages/BoardsGallery';
import ResearchBoard from './pages/ResearchBoard';
import PipelineBoard from './pages/PipelineBoard';
import ModelsPage from './pages/ModelsPage';
import SettingsPage from './pages/SettingsPage';
import SkillsPage from './pages/Skills';
// Phase 9 — new modules
import LoopsPage from './pages/LoopsPage';
import VideoBoard from './pages/VideoBoard';
import DesktopBoard from './pages/DesktopBoard';
import WarmMode from './pages/WarmMode';
import KanbanBoardPage from './pages/KanbanBoardPage';
import HermesStudioHub from './pages/HermesStudioHub';
import WeldersPipelinePage from './pages/WeldersPipelinePage';
import HermesWorkspace from './pages/HermesWorkspace';
import CodeXStudio from './pages/CodeXStudio';
import MagnitudeStudio from './pages/MagnitudeStudio';
import { MagnitudeProvider } from './store/magnitudeStore';
import EvolutionDashboard from './pages/evolution/EvolutionDashboard';
import PromptLab from './pages/evolution/PromptLab';
import AgentTeamsDashboard from './pages/AgentTeamsDashboard';
import TeamDetailView from './pages/TeamDetailView';
import SystemDoctorPage from './pages/SystemDoctorPage';
import ProjectsPage from './pages/ProjectsPage';
import { uiDiagnostics } from './diagnostics/uiSnapshot';
import { useEffect } from 'react';

function App() {
  // Startup: publish configured/selected frontend diagnostic state as soon as
  // it is available (before AgentRuntimeSelector/ProviderBadge mount).
  useEffect(() => {
    uiDiagnostics.init();
  }, []);
  return (
    <ErrorBoundary name="AppRoot">
      <DataProvider>
        <AppProvider>
          <ProjectProvider>
            <HermesProvider>
              <CodexProvider>
                <MagnitudeProvider>
                  <HashRouter>
                    <Routes>
                      {/* Main Desktop OS Routes (with AppShell) */}
                      <Route path="/" element={<AppShell />}>
                        <Route index element={<Navigate to="/jarvis" replace />} />
                        <Route path="dashboard" element={<Navigate to="/mission-control" replace />} />
                        <Route path="mission-control" element={<MissionControl />} />
                        <Route path="jarvis" element={<JarvisStudio />} />
                        <Route path="agents" element={<AgentsGallery />} />
                        <Route path="agents/:agentId" element={<AgentDetail />} />
                        <Route path="ornith" element={<OrnithDashboard />} />
                        <Route path="runs" element={<RunsInspector />} />
                        <Route path="skills" element={<SkillsPage />} />
                        <Route path="providers" element={<ProvidersBoard />} />
                        <Route path="memory" element={<MemoryStudio />} />
                        <Route path="builds" element={<BuildsGallery />} />
                        <Route path="control-room" element={<ControlRoom />} />
                        <Route path="boards" element={<BoardsGallery />} />
                        <Route path="research" element={<ResearchBoard />} />
                        <Route path="files" element={<BuildsGallery />} />
                        <Route path="pipeline" element={<PipelineBoard />} />
                        <Route path="automations" element={<LoopsPage />} />
                        <Route path="models" element={<ModelsPage />} />
                        <Route path="settings" element={<SettingsPage />} />
                        {/* Phase 9 */}
                        <Route path="loops" element={<LoopsPage />} />
                        <Route path="video" element={<VideoBoard />} />
                        <Route path="warm-mode" element={<WarmMode />} />
                        <Route path="jarvis-v2-demo" element={<JarvisV2Demo />} />
                        <Route path="kanban/:boardId" element={<KanbanBoardPage />} />
                        <Route path="welders" element={<WeldersPipelinePage />} />
                        <Route path="hermes-studio" element={<HermesStudioHub />} />
                        <Route path="evolution" element={<EvolutionDashboard />} />
                        <Route path="prompt-lab" element={<PromptLab />} />
                        <Route path="teams" element={<AgentTeamsDashboard />} />
                        <Route path="agent-teams" element={<AgentTeamsDashboard />} />
                        <Route path="teams/:id" element={<TeamDetailView />} />
                        <Route path="hermes" element={<Navigate to="/hermes-studio?view=kanban" replace />} />
                        <Route path="codex" element={<CodeXStudio />} />
                        <Route path="magnitude" element={<MagnitudeStudio />} />
                        <Route path="apollo" element={<Navigate to="/hermes-studio?view=apollo" replace />} />
                        <Route path="doctor" element={<SystemDoctorPage />} />
                        <Route path="projects" element={<ProjectsPage />} />
                      </Route>
                    </Routes>
                  </HashRouter>
                </MagnitudeProvider>
              </CodexProvider>
            </HermesProvider>
          </ProjectProvider>
        </AppProvider>
      </DataProvider>
    </ErrorBoundary>
  );
}

export default App;
