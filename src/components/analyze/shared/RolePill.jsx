import { ROLE } from "../../utils/core/roles.constants.js";

/* Shared by TargetStep (the picker) and OverviewTab (the report) so a column's
   role can never be colored differently in the two places — see frontend.md
   "Target step" spec. identifier gets the warning tint (the one role the engine
   recommends dropping); temporal gets the neutral accent wash as a deliberate, sparing
   accent — dates are the rarest/most notable role. */
const PILL_STYLE = {
  [ROLE.NUMERIC]:     "bg-info-tint text-info",
  [ROLE.CATEGORICAL]: "bg-paper text-ink-soft border border-line",
  [ROLE.BINARY]:      "bg-success-tint text-success",
  [ROLE.IDENTIFIER]:  "bg-warning-tint text-warning",
  [ROLE.TEMPORAL]:    "bg-accent-tint text-accent-ink",
  /* Free text sits with categorical in weight — it is not a problem role like
     identifier — but must be distinguishable from it, since telling the two apart
     is the entire point of adding the role. */
  [ROLE.TEXT]:        "bg-paper-sunken text-ink-soft border border-line-strong",
};
const FALLBACK_PILL = PILL_STYLE[ROLE.CATEGORICAL];

function RolePill({ role }) {
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium ${PILL_STYLE[role] ?? FALLBACK_PILL}`}>
      {role}
    </span>
  );
}

export default RolePill;
