import { createContext, useContext } from "react";

/* The context object and its reader, apart from the provider component so that
   file can export a component only (eslint react-refresh/only-export-components). */
export const SessionContext = createContext(null);

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside <SessionProvider>");
  return value;
}

/* Has this signed-in user any free analyses left? False for a signed-out visitor
   too, so a caller can ask one question. The server decides for real — this only
   chooses which button to draw. */
export const hasQuota = ({ user, usage }) =>
  Boolean(user) && (!usage || usage.used < usage.limit);
