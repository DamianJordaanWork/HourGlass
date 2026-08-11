import type { HarvestProjectId, HarvestTaskId } from '@domain/common/types';
import type { Hg1Scheme } from '@domain/harvest/hg1-codec';

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
  /** The user's own Google Cloud OAuth Client ID (public, not a secret). */
  readonly googleClientId?: string;
  readonly defaultProjectId?: HarvestProjectId;
  readonly defaultTaskId?: HarvestTaskId;
  /** Stop any running timer when a new one starts. */
  readonly autoStopOnSwitch: boolean;
  /** Roll multiple same-day/same-task sessions into one Harvest entry (Phase 2). */
  readonly aggregateSameTaskPerDay: boolean;
  /** Embed the hidden `hg1` reconciliation tag in Harvest notes. Off by default. */
  readonly embedMetadata: boolean;
  /**
   * The hg1 tag's body encoding, only consulted when `embedMetadata` is on.
   * `plain` (default) keeps pre-existing tags on other entries decodable and
   * requires no key. `scramble` is a keyless, reversible obfuscation. `aes` is
   * reserved for a future real-encryption scheme and is not yet available.
   */
  readonly hg1Scheme: Hg1Scheme;
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
  hg1Scheme: 'plain',
};
