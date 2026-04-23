import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import AssetsPage from "@/pages/AssetsPage";
import AssetTypePage from "@/pages/AssetTypePage";
import ExcelPage from "@/pages/ExcelPage";
import Home from "@/pages/Home";
import NotFound from "@/pages/not-found";
import TransactionsPage from "@/pages/TransactionsPage";
import WealthAllocationPage from "@/pages/WealthAllocationPage";
import WealthAllocationTypePage from "@/pages/WealthAllocationTypePage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchInterval: 15 * 60 * 1000,
      staleTime: 5 * 60 * 1000,
    },
  },
});

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/assets" component={AssetsPage} />
      <Route path="/assets/type/:type" component={AssetTypePage} />
      <Route path="/transactions" component={TransactionsPage} />
      <Route path="/wealth-allocation" component={WealthAllocationPage} />
      <Route path="/wealth-allocation/type/:type" component={WealthAllocationTypePage} />
      <Route path="/excel" component={ExcelPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
