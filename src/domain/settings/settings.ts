import type { HarvestProjectId, HarvestTaskId } from '@domain/common/types';

export type ThemePref = 'system' | 'light' | 'dark';

/** App-wide settings (single row). */
export interface Settings {
  readonly workDayStart: string; // 'HH:mm'
  readonly workDayEnd: string; // 'HH:mm'
  readonly breakMinutes: number;
  readonly minDeadTimeMinutes: number;
  readonly weeklyGoalHours: number;
  readonly refreshIntervalMinutes: number;
  readonly theme: ThemePref;
  readonly harvestAccountId?: string;
  /** The user's own Azure AD app registration Client ID (public, not a secret). */
  readonly microsoftClientId?: string;
  readonly defaultProjectId?: HarvestProjectId;
  readonly defaultTaskId?: HarvestTaskId;
  /** Stop any running timer when a new one starts. */
  readonly autoStopOnSwitch: boolean;
  /** Roll multiple same-day/same-task sessions into one Harvest entry (Phase 2). */
  readonly aggregateSameTaskPerDay: boolean;
  /** Embed the hidden `hg1` reconciliation tag in Harvest notes. Off by default. */
  readonly embedMetadata: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  workDayStart: '08:00',
  workDayEnd: '17:00',
  breakMinutes: 60,
  minDeadTimeMinutes: 15,
  weeklyGoalHours: 40,
  refreshIntervalMinutes: 15,
  theme: 'system',
  autoStopOnSwitch: true,
  aggregateSameTaskPerDay: false,
  embedMetadata: false,
};
