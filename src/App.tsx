import { Toaster } from "sonner";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <Toaster position="top-right" />
    <BrowserRouter>
      <Routes>
        <Route path="*" element={<Index />} />
      </Routes>
    </BrowserRouter>
  </QueryClientProvider>
);

export default App;
