import { lazy, Suspense } from "react";
import { useRoute } from "@/lib/router";
import { AppShell } from "@/components/shell";
import { InspectorPage } from "@/pages/InspectorPage";

const NewOperationPage = lazy(() => import("@/pages/NewOperationPage").then((m) => ({ default: m.NewOperationPage })));

export function App() {
  const route = useRoute();
  return (
    <AppShell route={route}>
      {route.name === "new" ? (
        <Suspense fallback={<div className="p-8 text-[13px] text-fg-3">Loading editor…</div>}>
          <NewOperationPage />
        </Suspense>
      ) : (
        <InspectorPage id={route.name === "session" ? route.id : undefined} />
      )}
    </AppShell>
  );
}
