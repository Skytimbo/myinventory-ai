import { Switch, Route } from "wouter";
import { apiRequest, queryClient } from "./lib/queryClient";
import { QueryClientProvider, useMutation, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Button } from "@/components/ui/button";
import { Lock, Loader2 } from "lucide-react";
import { FormEvent, useState } from "react";

import Home from "@/pages/home";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <AuthGate />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

function AuthGate() {
  const { data, isLoading } = useQuery<{
    authenticated: boolean;
    authEnabled: boolean;
  }>({
    queryKey: ["/api/auth/status"],
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data?.authenticated) {
    return <LoginScreen />;
  }

  return <Router />;
}

function LoginScreen() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const loginMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/auth/login", { password });
      return response.json();
    },
    onSuccess: () => {
      setError("");
      queryClient.invalidateQueries({ queryKey: ["/api/auth/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
    },
    onError: () => {
      setError("That password did not work.");
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    loginMutation.mutate();
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm border rounded-lg bg-card p-6 shadow-sm space-y-5"
      >
        <div className="space-y-2">
          <div className="w-10 h-10 rounded-md border flex items-center justify-center">
            <Lock className="w-5 h-5 text-muted-foreground" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">MyInventory AI</h1>
            <p className="text-sm text-muted-foreground">Enter the inventory password.</p>
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor="inventory-password" className="text-sm font-medium">
            Password
          </label>
          <input
            id="inventory-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            autoComplete="current-password"
            autoFocus
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <Button type="submit" className="w-full" disabled={loginMutation.isPending}>
          {loginMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Sign in
        </Button>
      </form>
    </div>
  );
}

export default App;
