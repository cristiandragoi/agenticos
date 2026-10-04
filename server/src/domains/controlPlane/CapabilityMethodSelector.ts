/**
 * CapabilityMethodSelector.ts — Deterministic Capability Method Selection
 *
 * PHASE 5 CONTROL-PLANE COMPONENT
 *
 * Given structured intent, resolved target evidence, and interaction context:
 * - Selects the authoritative capability adapter
 * - Selects the primary acquisition/execution method
 * - Configures controlled fallback boundaries (stays strictly within same target)
 * - Zero LLM calls are used to decide capability routing!
 */

import { logger } from '../../utils/logger.js';
import type { CompiledTurnIntent } from './AuthoritativeIntentCompiler.js';
import type { ResolvedTargetEvidence } from './TargetResolver.js';
import type { AuthoritativeInteractionContextData } from './AuthoritativeInteractionContext.js';
import type { UniversalAcquisitionMethod } from './UniversalContentAcquisition.js';

export interface SelectedCapabilityMethod {
  readonly adapterId: string;
  readonly executionMethod: string;
  readonly requiresAcquisition: boolean;
  readonly preferredAcquisitionMethod?: UniversalAcquisitionMethod;
  readonly allowedFallbackMethods: readonly UniversalAcquisitionMethod[];
  readonly target: ResolvedTargetEvidence;
}

export class CapabilityMethodSelector {
  private static instance: CapabilityMethodSelector;

  private constructor() {}

  public static getInstance(): CapabilityMethodSelector {
    if (!CapabilityMethodSelector.instance) {
      CapabilityMethodSelector.instance = new CapabilityMethodSelector();
    }
    return CapabilityMethodSelector.instance;
  }

  /**
   * Deterministically selects the capability adapter and execution strategy.
   * NO LLM calls allowed here!
   */
  public selectMethod(
    intent: CompiledTurnIntent,
    target: ResolvedTargetEvidence,
    context: AuthoritativeInteractionContextData
  ): SelectedCapabilityMethod {
    const action = intent.action;

    switch (action) {
      case 'OPEN_APPLICATION':
      case 'FOCUS_APPLICATION' as any:
      case 'CLOSE_APPLICATION' as any:
        return {
          adapterId: 'app',
          executionMethod: 'desktop_window_lifecycle',
          requiresAcquisition: false,
          allowedFallbackMethods: [],
          target,
        };

      case 'NAVIGATE_GUI' as any:
      case 'LOCATE_ELEMENT' as any:
      case 'ACTIVATE_CONTROL' as any: {
        const app = (intent.application || target.resolvedApplication || context.activeApplication || '').toLowerCase();
        const isBrowser = app.includes('chrome') || app.includes('edge') || (intent.targetType as string) === 'BROWSER' || (intent.targetType as string) === 'WEB_URL' || (target.resolvedWindow?.toLowerCase().includes('chrome') ?? false);
        if (isBrowser) {
          return {
            adapterId: 'browser',
            executionMethod: 'browser_goal',
            requiresAcquisition: false,
            allowedFallbackMethods: [],
            target,
          };
        }
        return {
          adapterId: 'gui_navigation',
          executionMethod: 'computer_use_goal',
          requiresAcquisition: false,
          allowedFallbackMethods: [],
          target,
        };
      }

      case 'OPEN_CHAT':
        return {
          adapterId: 'chat',
          executionMethod: 'chat_select_and_verify',
          requiresAcquisition: false,
          allowedFallbackMethods: [],
          target,
        };

      case 'READ_MESSAGES':
        return {
          adapterId: 'chat',
          executionMethod: 'chat_message_acquisition',
          requiresAcquisition: true,
          preferredAcquisitionMethod: 'uia',
          allowedFallbackMethods: ['accessibility', 'window_crop_vision'],
          target,
        };

      case 'READ_CONTENT':
      case 'READ_SCREEN' as any:
      case 'READ_WINDOW' as any: {
        const isOrdinal = intent.ordinal !== null && intent.ordinal > 0;
        if (!isOrdinal) {
          const app = (target.resolvedApplication || intent.application || '').toLowerCase();
          const isBrowser = app.includes('chrome') || app.includes('edge') || app.includes('browser') || target.matchType === 'browser_tab' || intent.targetType === 'WEB_URL' || (intent.targetType as string) === 'BROWSER';
          if (isBrowser) {
            return {
              adapterId: 'browser',
              executionMethod: 'web_content_extraction',
              requiresAcquisition: true,
              preferredAcquisitionMethod: 'native_dom',
              allowedFallbackMethods: ['cdp', 'uia', 'window_crop_vision'],
              target,
            };
          }
        }
        return {
          adapterId: 'perception',
          executionMethod: isOrdinal ? 'ordinal_context_extraction' : 'window_content_extraction',
          requiresAcquisition: true,
          preferredAcquisitionMethod: isOrdinal ? 'context_ordinal' : 'uia',
          allowedFallbackMethods: isOrdinal ? [] : ['window_crop_vision', 'fullscreen_vision'],
          target,
        };
      }

      case 'CAMERA_OBSERVE' as any:
        return {
          adapterId: 'perception',
          executionMethod: 'camera_hardware_feed',
          requiresAcquisition: false,
          allowedFallbackMethods: [],
          target,
        };

      case 'NAVIGATE_WEB':
      case 'OPEN_URL':
      case 'BROWSER_GOAL' as any:
      case 'SWITCH_TAB' as any:
        return {
          adapterId: 'browser',
          executionMethod: (action as string) === 'SWITCH_TAB' ? 'browser_switch_tab' : (action as string) === 'BROWSER_GOAL' ? 'browser_goal' : 'browser_navigation',
          requiresAcquisition: false,
          allowedFallbackMethods: [],
          target,
        };

      case 'READ_WEB_CONTENT' as any:
        return {
          adapterId: 'browser',
          executionMethod: 'web_content_extraction',
          requiresAcquisition: true,
          preferredAcquisitionMethod: 'native_dom',
          allowedFallbackMethods: ['cdp', 'uia', 'window_crop_vision'],
          target,
        };

      case 'DELEGATE':
      case 'AUTONOMOUS_TASK' as any:
        return {
          adapterId: 'delegation',
          executionMethod: 'autonomous_task_registry',
          requiresAcquisition: false,
          allowedFallbackMethods: [],
          target,
        };

      case 'CONVERSATIONAL':
      case 'OTHER':
      default:
        return {
          adapterId: 'conversation',
          executionMethod: 'conversational_response',
          requiresAcquisition: false,
          allowedFallbackMethods: [],
          target,
        };
    }
  }
}

export const capabilityMethodSelector = CapabilityMethodSelector.getInstance();
