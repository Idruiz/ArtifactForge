import { useParams, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ExternalLink, Home } from "lucide-react";

export default function Preview() {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { id } = params;

  if (!id) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-foreground mb-4">Invalid Site ID</h1>
          <Button onClick={() => setLocation("/")} data-testid="button-back-home">
            <Home className="mr-2 h-4 w-4" />
            Back to Home
          </Button>
        </div>
      </div>
    );
  }

  const siteUrl = `/sites/${id}/`;
  
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b bg-card/50 backdrop-blur">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLocation("/")}
            data-testid="button-back"
          >
            <Home className="mr-2 h-4 w-4" />
            Back
          </Button>
          <h1 className="text-lg font-semibold text-foreground">Website Preview</h1>
          <Button
            variant="default"
            size="sm"
            onClick={() => window.open(siteUrl, '_blank')}
            data-testid="button-open-new-tab"
          >
            <ExternalLink className="mr-2 h-4 w-4" />
            Open in New Tab
          </Button>
        </div>
      </header>
      
      <main className="flex-1 relative">
        <iframe
          src={siteUrl}
          className="absolute inset-0 w-full h-full border-0"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
          title={`Website Preview ${id}`}
          data-testid="iframe-preview"
        />
      </main>
    </div>
  );
}
