// GDK game flow — an explicit finite state machine (LOG.FSM).
// Pure logic: no DOM, no rendering, headless-testable, serializable.

export const GameState = {
  FREE_ROAM: 'FREE_ROAM',
  MISSION_ACTIVE: 'MISSION_ACTIVE',
  BUSTED: 'BUSTED',
} as const;

export type GameStateId = (typeof GameState)[keyof typeof GameState];

const LEGAL_TRANSITIONS: Record<GameStateId, GameStateId[]> = {
  FREE_ROAM: ['MISSION_ACTIVE', 'BUSTED'],
  MISSION_ACTIVE: ['FREE_ROAM', 'BUSTED'],
  BUSTED: ['FREE_ROAM'],
};

/** The single legality table — anything not listed here is illegal. */
export function can_transition(from: GameStateId, to: GameStateId): boolean {
  return LEGAL_TRANSITIONS[from].includes(to);
}

export class GameFlow {
  state: GameStateId = GameState.FREE_ROAM;
  enteredAtTick = 0;

  transitionTo(to: GameStateId, tick: number): boolean {
    if (!can_transition(this.state, to)) {
      return false;
    }
    this.state = to;
    this.enteredAtTick = tick;
    return true;
  }

  ticksInState(tick: number): number {
    return tick - this.enteredAtTick;
  }
}
