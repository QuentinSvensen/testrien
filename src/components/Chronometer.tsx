import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Play, Pause, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";

interface ChronoState {
  running: boolean;
  startedAt: string | null;
  accumulated: number; // ms
}

const DEFAULT_STATE: ChronoState = { running: false, startedAt: null, accumulated: 0 };

export function Chronometer({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const qc = useQueryClient();
  const [display, setDisplay] = useState("00:00:00");

  const { data: storedState = DEFAULT_STATE } = useQuery({
    queryKey: ["chronometer_state"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_preferences")
        .select("value")
        .eq("key", "chronometer_state")
        .maybeSingle();
      if (error) throw error;
      return (data?.value as unknown as ChronoState) ?? DEFAULT_STATE;
    },
    refetchInterval: open ? 1000 : false,
    enabled: open,
    retry: 2,
  });

  const saveMutation = useMutation({
    mutationFn: async (state: ChronoState) => {
      const { data: existing } = await supabase
        .from("user_preferences")
        .select("id")
        .eq("key", "chronometer_state")
        .maybeSingle();
      if (existing) {
        await supabase
          .from("user_preferences")
          .update({ value: state as any, updated_at: new Date().toISOString() })
          .eq("id", existing.id);
      } else {
        await supabase
          .from("user_preferences")
          .insert({ key: "chronometer_state", value: state as any });
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chronometer_state"] }),
  });

  const getElapsed = (s: ChronoState) => {
    if (s.running && s.startedAt) {
      return s.accumulated + (Date.now() - new Date(s.startedAt).getTime());
    }
    return s.accumulated;
  };

  const formatTime = (ms: number) => {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  useEffect(() => {
    const id = setInterval(() => setDisplay(formatTime(getElapsed(storedState))), 100);
    return () => clearInterval(id);
  }, [storedState]);

  const handleStart = () => {
    saveMutation.mutate({
      running: true,
      startedAt: new Date().toISOString(),
      accumulated: storedState.accumulated,
    });
  };

  const handlePause = () => {
    saveMutation.mutate({
      running: false,
      startedAt: null,
      accumulated: getElapsed(storedState),
    });
  };

  const handleReset = () => {
    saveMutation.mutate(DEFAULT_STATE);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[300px] rounded-[24px] sm:rounded-[34px] border-0 bg-card/95 backdrop-blur-xl shadow-2xl p-0 overflow-hidden" aria-describedby={undefined}>
        <div className="flex flex-col items-center gap-5 px-6 py-8">
          <div className="text-5xl font-mono font-black text-foreground tabular-nums tracking-wider">
            {display}
          </div>
          <div className="flex items-center gap-3">
            {storedState.running ? (
              <Button onClick={handlePause} size="lg" variant="secondary" className="rounded-full h-14 w-14 shadow-lg">
                <Pause className="h-6 w-6" />
              </Button>
            ) : (
              <Button onClick={handleStart} size="lg" className="rounded-full h-14 w-14 shadow-lg">
                <Play className="h-6 w-6 ml-0.5" />
              </Button>
            )}
            <Button onClick={handleReset} size="lg" variant="outline" className="rounded-full h-14 w-14 shadow-lg">
              <RotateCcw className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
