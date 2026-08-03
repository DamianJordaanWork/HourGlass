import type { IMappingRuleRepository } from '@domain/ports';
import {
  TemplateMatcher,
  type MappingMatch,
} from '@domain/templates/mapping';
import { buildWorkItemContext, type WorkItem } from '@domain/work-items/work-item';
import { buildMeetingContext, type Meeting } from '@domain/calendar/meeting';

/** Resolves ADO work items and meetings to a Harvest project/task via mapping rules. */
export class MappingService {
  constructor(private readonly rules: IMappingRuleRepository) {}

  async forWorkItem(item: WorkItem): Promise<MappingMatch | null> {
    const rules = await this.rules.list();
    return TemplateMatcher.resolve('WorkItem', buildWorkItemContext(item), rules);
  }

  async forMeeting(meeting: Meeting): Promise<MappingMatch | null> {
    const rules = await this.rules.list();
    return TemplateMatcher.resolve('Meeting', buildMeetingContext(meeting), rules);
  }
}
