import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles } from "lucide-react";

export default function Page() {
  return (
    <main className="container mx-auto flex min-h-screen items-center justify-center p-8">
      <Card className="max-w-2xl">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Sparkles className="text-primary" />
            <CardTitle>Atlas sandbox is live</CardTitle>
            <Badge variant="secondary">v0.2 · shadcn-ready</Badge>
          </div>
          <CardDescription>
            This blank Next.js + Tailwind + shadcn/ui app is the starting point. Atlas&apos;s developer
            role will write code into <code className="rounded bg-muted px-1 py-0.5 text-xs">/code/src/</code>;
            the dev server picks it up via HMR and you&apos;ll see it here.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Button>Primary action</Button>
          <Button variant="outline">Secondary</Button>
        </CardContent>
      </Card>
    </main>
  );
}
