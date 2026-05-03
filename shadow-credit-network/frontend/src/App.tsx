import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WalletProvider } from "@/lib/wallet";
import Landing from "./pages/Landing";
import AppLayout from "./components/AppLayout";
import Dashboard from "./pages/app/Dashboard";
import SubmitData from "./pages/app/SubmitData";
import Borrow from "./pages/app/Borrow";
import Delegation from "./pages/app/Delegation";
import Reputation from "./pages/app/Reputation";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <WalletProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/app" element={<AppLayout />}>
              <Route index element={<Dashboard />} />
              <Route path="submit" element={<SubmitData />} />
              <Route path="borrow" element={<Borrow />} />
              <Route path="delegation" element={<Delegation />} />
              <Route path="reputation" element={<Reputation />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </WalletProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
