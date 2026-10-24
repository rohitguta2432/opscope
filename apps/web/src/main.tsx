import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { initialTheme } from "@/lib/theme";
import { TooltipProvider } from "@/components/ui/tooltip";
import { App } from "./App";
import "./index.css";

document.documentElement.dataset.theme = initialTheme();
const qc = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } } });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <App />
        <Toaster position="bottom-right" toastOptions={{ style: { background: "var(--raised)", border: "1px solid var(--line-strong)", color: "var(--fg)", fontFamily: "var(--font-sans)", fontSize: 13 } }} />
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
);
