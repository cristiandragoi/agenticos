import React, { createContext, useContext, useReducer, type ReactNode } from 'react';
import type { DrawerState, ChatState, RouteContext, DrawerEntityType, ChatMessage, JarvisVoiceState, JarvisTranscriptEntry } from '../types';

/* ─── State Shape ─── */

interface AppState {
  drawer: DrawerState;
  chat: ChatState;
  route: RouteContext;
  commandPaletteOpen: boolean;
  jarvis: JarvisVoiceState;
}

const initialState: AppState = {
  drawer: {
    isOpen: false,
    entityType: null,
    entityId: null,
    isPinned: false,
  },
  chat: {
    targetAgentId: "agent-jarvis",
    routingMode: "manual",
    sessionId: "sess-live",
    messages: [
      {
        id: "msg-sys-1",
        role: "system",
        content: "Agentic OS ready. Select an agent or use auto-routing.",
        timestamp: new Date().toISOString(),
      },
    ],
    isExpanded: false,
  },
  route: {
    currentBoard: null,
    currentWorkspace: "ws-1",
    activeFilters: {},
    viewMode: "board",
  },
  commandPaletteOpen: false,
  jarvis: {
    status: "idle",
    transcript: [],
  },
};

/* ─── Actions ─── */

type AppAction =
  | { type: "OPEN_DRAWER"; entityType: DrawerEntityType; entityId: string }
  | { type: "CLOSE_DRAWER" }
  | { type: "PIN_DRAWER" }
  | { type: "UNPIN_DRAWER" }
  | { type: "NAVIGATE_DRAWER"; direction: "next" | "prev"; entityId: string }
  | { type: "SET_CHAT_TARGET"; agentId: string | null }
  | { type: "SET_ROUTING_MODE"; mode: "manual" | "auto" | "delegated" }
  | { type: "SEND_MESSAGE"; message: ChatMessage }
  | { type: "TOGGLE_CHAT_EXPANDED" }
  | { type: "SET_VIEW_MODE"; mode: "board" | "gallery" | "list" }
  | { type: "SET_CURRENT_BOARD"; boardId: string | null }
  | { type: "SEND_MESSAGE"; message: ChatMessage }
  | { type: "UPDATE_MESSAGE_CONTENT"; payload: { id: string; content: string } }
  | { type: "APPEND_MESSAGE_CHUNK"; payload: { id: string; chunk: string } }
  | { type: "UPDATE_MESSAGE_GATEWAY_STATE"; payload: { id: string; gateway: Partial<ChatMessage['gateway']> } }
  | { type: "SET_JARVIS_STATE"; status: JarvisVoiceState["status"] }
  | { type: "ADD_JARVIS_TRANSCRIPT"; entry: JarvisTranscriptEntry }
  | { type: "CLEAR_JARVIS_TRANSCRIPT" }
  | { type: "TOGGLE_COMMAND_PALETTE" };

/* ─── Reducer ─── */

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "OPEN_DRAWER":
      return {
        ...state,
        drawer: {
          ...state.drawer,
          isOpen: true,
          entityType: action.entityType,
          entityId: action.entityId,
        },
      };
    case "CLOSE_DRAWER":
      return {
        ...state,
        drawer: { ...state.drawer, isOpen: false, entityType: null, entityId: null, isPinned: false },
      };
    case "PIN_DRAWER":
      return { ...state, drawer: { ...state.drawer, isPinned: true } };
    case "UNPIN_DRAWER":
      return { ...state, drawer: { ...state.drawer, isPinned: false } };
    case "NAVIGATE_DRAWER":
      return {
        ...state,
        drawer: { ...state.drawer, entityId: action.entityId },
      };
    case "SET_CHAT_TARGET":
      return {
        ...state,
        chat: {
          ...state.chat,
          targetAgentId: action.agentId,
          routingMode: action.agentId ? "manual" : "auto",
        },
      };
    case "SET_ROUTING_MODE":
      return {
        ...state,
        chat: { ...state.chat, routingMode: action.mode },
      };
    case "SEND_MESSAGE":
      return {
        ...state,
        chat: {
          ...state.chat,
          messages: [...state.chat.messages, action.message],
        },
      };
    case "UPDATE_MESSAGE_CONTENT":
      return {
        ...state,
        chat: {
          ...state.chat,
          messages: state.chat.messages.map(m =>
            m.id === action.payload.id
              ? { ...m, content: action.payload.content }
              : m
          ),
        },
      };
    case "APPEND_MESSAGE_CHUNK":
      return {
        ...state,
        chat: {
          ...state.chat,
          messages: state.chat.messages.map(m => 
            m.id === action.payload.id 
              ? { ...m, content: m.content + action.payload.chunk }
              : m
          ),
        },
      };
    case "UPDATE_MESSAGE_GATEWAY_STATE":
      return {
        ...state,
        chat: {
          ...state.chat,
          messages: state.chat.messages.map(m => {
            if (m.id !== action.payload.id) return m;
            
            const prevGateway = m.gateway || {};
            const newGateway = { ...prevGateway, ...action.payload.gateway };
            
            // Append events safely and deduplicate by operationId+type+provider+target+timestamp
            if (action.payload.gateway?.events) {
              const prevEvents = prevGateway.events || [];
              const getEventKey = (e: any) => `${e.operationId || 'unknown'}:${e.type}:${e.provider || ''}:${e.target || ''}:${e.timestamp || ''}`;
              const eventSet = new Set(prevEvents.map(getEventKey));
              
              const dedupedNew = action.payload.gateway.events.filter(e => {
                const key = getEventKey(e);
                if (eventSet.has(key)) return false;
                eventSet.add(key);
                return true;
              });
              
              newGateway.events = [...prevEvents, ...dedupedNew].slice(-20); // bounded to 20 events
            }
            
            return { ...m, gateway: newGateway };
          }),
        },
      };
    case "TOGGLE_CHAT_EXPANDED":
      return {
        ...state,
        chat: { ...state.chat, isExpanded: !state.chat.isExpanded },
      };
    case "SET_VIEW_MODE":
      return {
        ...state,
        route: { ...state.route, viewMode: action.mode },
      };
    case "SET_CURRENT_BOARD":
      return {
        ...state,
        route: { ...state.route, currentBoard: action.boardId },
      };
    case "TOGGLE_COMMAND_PALETTE":
      return { ...state, commandPaletteOpen: !state.commandPaletteOpen };
    case "SET_JARVIS_STATE":
      return { ...state, jarvis: { ...state.jarvis, status: action.status } };
    case "ADD_JARVIS_TRANSCRIPT":
      // Dedup by id: if the same entry is already in state (e.g. a replay/
      // persistence path appends a record that just entered), skip it —
      // duplicate rows with identical ids would render duplicate React keys.
      // This removes genuinely duplicated records instead of hiding them.
      if (state.jarvis.transcript.some((e) => e.id === action.entry.id)) {
        return state;
      }
      return { ...state, jarvis: { ...state.jarvis, transcript: [...state.jarvis.transcript, action.entry] } };
    case "CLEAR_JARVIS_TRANSCRIPT":
      return { ...state, jarvis: { ...state.jarvis, transcript: [] } };
    default:
      return state;
  }
}

/* ─── Context ─── */

interface AppContextValue {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState);
  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppState() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppState must be used within AppProvider");
  return ctx;
}

export function useAppDispatch() {
  return useAppState().dispatch;
}

/* ─── Convenience hooks ─── */

export function useDrawer() {
  const { state, dispatch } = useAppState();
  return {
    ...state.drawer,
    open: (entityType: DrawerEntityType, entityId: string) => {
      const typeToUse = entityId === 'agent-hermes' ? 'hermes' : entityType;
      dispatch({ type: "OPEN_DRAWER", entityType: typeToUse, entityId });
    },
    close: () => dispatch({ type: "CLOSE_DRAWER" }),
    pin: () => dispatch({ type: "PIN_DRAWER" }),
    unpin: () => dispatch({ type: "UNPIN_DRAWER" }),
    navigate: (direction: "next" | "prev", entityId: string) =>
      dispatch({ type: "NAVIGATE_DRAWER", direction, entityId }),
  };
}

export function useChat() {
  const { state, dispatch } = useAppState();
  return {
    ...state.chat,
    setTarget: (agentId: string | null) =>
      dispatch({ type: "SET_CHAT_TARGET", agentId }),
    setRoutingMode: (mode: "manual" | "auto" | "delegated") =>
      dispatch({ type: "SET_ROUTING_MODE", mode }),
    sendMessage: (message: ChatMessage) =>
      dispatch({ type: "SEND_MESSAGE", message }),
    updateMessageGatewayState: (id: string, gateway: Partial<ChatMessage['gateway']>) =>
      dispatch({ type: "UPDATE_MESSAGE_GATEWAY_STATE", payload: { id, gateway } }),
    toggleExpanded: () => dispatch({ type: "TOGGLE_CHAT_EXPANDED" }),
  };
}

export function useRouteContext() {
  const { state, dispatch } = useAppState();
  return {
    ...state.route,
    setViewMode: (mode: "board" | "gallery" | "list") =>
      dispatch({ type: "SET_VIEW_MODE", mode }),
    setCurrentBoard: (boardId: string | null) =>
      dispatch({ type: "SET_CURRENT_BOARD", boardId }),
  };
}

export function useCommandPalette() {
  const { state, dispatch } = useAppState();
  return {
    isOpen: state.commandPaletteOpen,
    toggle: () => dispatch({ type: "TOGGLE_COMMAND_PALETTE" }),
  };
}

export function useJarvis() {
  const { state, dispatch } = useAppState();
  return {
    ...state.jarvis,
    setStatus: (status: JarvisVoiceState["status"]) => dispatch({ type: "SET_JARVIS_STATE", status }),
    addTranscript: (entry: JarvisTranscriptEntry) => dispatch({ type: "ADD_JARVIS_TRANSCRIPT", entry }),
    clearTranscript: () => dispatch({ type: "CLEAR_JARVIS_TRANSCRIPT" }),
  };
}

