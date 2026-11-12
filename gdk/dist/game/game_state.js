// GDK game flow — an explicit finite state machine (LOG.FSM).
// Pure logic: no DOM, no rendering, headless-testable, serializable.
export const GameState = {
    FREE_ROAM: 'FREE_ROAM',
    MISSION_ACTIVE: 'MISSION_ACTIVE',
    BUSTED: 'BUSTED',
};
const LEGAL_TRANSITIONS = {
    FREE_ROAM: ['MISSION_ACTIVE', 'BUSTED'],
    MISSION_ACTIVE: ['FREE_ROAM', 'BUSTED'],
    BUSTED: ['FREE_ROAM'],
};
/** The single legality table — anything not listed here is illegal. */
export function can_transition(from, to) {
    return LEGAL_TRANSITIONS[from].includes(to);
}
export class GameFlow {
    state = GameState.FREE_ROAM;
    enteredAtTick = 0;
    transitionTo(to, tick) {
        if (!can_transition(this.state, to)) {
            return false;
        }
        this.state = to;
        this.enteredAtTick = tick;
        return true;
    }
    ticksInState(tick) {
        return tick - this.enteredAtTick;
    }
}
