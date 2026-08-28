import type { BacktestGoal } from '../../shared/types';

export function goalLabel(goal: BacktestGoal): string {
  return goal === 'win' ? 'vinstträff' : 'topp 3-träff';
}
