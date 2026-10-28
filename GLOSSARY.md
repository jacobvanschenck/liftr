# Glossary

Terms used in the Liftr code and docs.

**Member** — A person with a Clerk identity and a timezone. Members share a family-scoped exercise catalog and routine list.

**Family** — The shared workspace that owns exercises and routines. A member's `familyId` scopes those records.

**Exercise** — A movement in the shared catalog. A core exercise (`isCore`) feeds the dashboard's strength score.

**Routine** — An ordered set of exercises with target set counts and rep ranges.

**Session** — One training date for one member. A session is either `inProgress` or `completed`.

**Active session** — The single in-progress session a member is currently logging. The app allows one at a time.

**Session lifecycle** — Starting, completing, and discarding a session. Owned by `src/lib/sessions.ts`.

**Session logger** — The active-session read model and set-command pipeline. Owned by `src/lib/session-logger.ts`; it loads the session, applies set commands, and renders the shared set list and htmx fragment.

**Set command** — An add, update, or delete operation on a completed set within an active session.

**Set fragment** — The HTML returned to htmx after a set command. It contains the updated set list, the per-exercise progress line, and out-of-band session totals.

**Plate math** — The shared bar weight, plate weights, load decomposition, and visual plate specs. Owned by `src/lib/plates.ts`.

**Body entry** — A date-keyed set of body metric values, such as weight or waist measurement.

**Core lift** — An exercise marked as core. Core lifts drive the dashboard strength score.

**Training history** — The recent completed sessions and sets used for dashboard and exercise-detail analytics.
