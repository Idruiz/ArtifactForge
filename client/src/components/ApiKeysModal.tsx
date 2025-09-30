import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiKeys } from '@/lib/types';

interface ApiKeysModalProps {
  isOpen: boolean;
  onClose: () => void;
  apiKeys: ApiKeys;
  onSave: (keys: ApiKeys) => void;
}

export function ApiKeysModal({ isOpen, onClose, apiKeys, onSave }: ApiKeysModalProps) {
  const [keys, setKeys] = useState<ApiKeys>(apiKeys);

  useEffect(() => {
    if (isOpen) {
      setKeys(apiKeys);
    }
  }, [isOpen, apiKeys]);

  const handleSave = () => {
    onSave(keys);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>API Configuration</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <div>
            <Label htmlFor="openai-key" className="text-sm font-medium">
              OpenAI API Key
            </Label>
            <Input
              id="openai-key"
              type="password"
              placeholder="sk-..."
              value={keys.openai}
              onChange={(e) => setKeys({ ...keys, openai: e.target.value })}
              className="mt-2"
            />
          </div>
          
          <div>
            <Label htmlFor="serp-key" className="text-sm font-medium">
              SerpAPI Key (optional)
            </Label>
            <Input
              id="serp-key"
              type="password"
              placeholder="Search API key..."
              value={keys.serpApi || ''}
              onChange={(e) => setKeys({ ...keys, serpApi: e.target.value })}
              className="mt-2"
            />
          </div>
          
          <div>
            <Label htmlFor="unsplash-key" className="text-sm font-medium">
              Unsplash Access Key (optional)
            </Label>
            <Input
              id="unsplash-key"
              type="password"
              placeholder="Image search key..."
              value={keys.unsplash || ''}
              onChange={(e) => setKeys({ ...keys, unsplash: e.target.value })}
              className="mt-2"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-cancel-keys">
            Cancel
          </Button>
          <Button onClick={handleSave} data-testid="button-save-keys">
            Save Keys
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
