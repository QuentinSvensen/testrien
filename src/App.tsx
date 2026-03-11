import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 1000 * 60 * 60 * 24, // 24h — keep cache for offline
      staleTime: 1000 * 30, // 30s — refetch in background when stale
      retry: (failureCount, error) => {
        // Don't retry on auth errors (expired session)
        if (error && typeof error === 'object' && 'code' in error) {
          const code = (error as { code?: string }).code;
          if (code === 'PGRST301' || code === '401' || code === 'refresh_token_not_found') return false;
        }
        if (error && typeof error === 'object' && 'message' in error) {
          const msg = (error as { message?: string }).message || '';
          if (msg.includes('JWT') || msg.includes('token') || msg.includes('401')) return false;
        }
        return failureCount < 2;
      },
    },
  },
});

const persister = createSyncStoragePersister({
  storage: window.localStorage,
  key: "mealcards-cache",
});

const App = () => (
  <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
    <PersistQueryClientProvider client={queryClient} persistOptions={{ persister, maxAge: 1000 * 60 * 60 * 24 }}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
  <BrowserRouter>
          <Routes>
            <Route path="/" element={<Navigate to="/repas" replace />} />
            <Route path="/aliments" element={<Index />} />
            <Route path="/repas" element={<Index />} />
            <Route path="/planning" element={<Index />} />
            <Route path="/courses" element={<Index />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </PersistQueryClientProvider>
  </ThemeProvider>
);

export default App;
