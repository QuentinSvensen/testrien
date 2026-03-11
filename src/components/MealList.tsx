import { useState, useCallback } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

interface MealListProps {
  title: string;
  emoji: string;
  count: number;
  children: React.ReactNode;
  onExternalDrop?: (mealId: string, source: string) => void;
  headerActions?: React.ReactNode;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function MealList({ title, emoji, count, children, onExternalDrop, headerActions, collapsed, onToggleCollapse }: MealListProps) {
  const [dragOver, setDragOver] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => setDragOver(false), []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const mealId = e.dataTransfer.getData("mealId");
    const source = e.dataTransfer.getData("source");
    // Don't handle drops from within the same possible list (internal reorder)
    if (source === "possible") return;
    if (mealId && source !== title && onExternalDrop) {
      onExternalDrop(mealId, source);
    }
  }, [onExternalDrop, title]);

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`flex flex-col rounded-3xl bg-card/80 backdrop-blur-sm p-5 min-h-[80px] transition-all ${
        dragOver ? "ring-4 ring-primary/40 bg-primary/5" : ""
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        {onToggleCollapse && (
          <button onClick={onToggleCollapse} className="text-muted-foreground shrink-0">
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        )}
        <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
          <span className="text-2xl">{emoji}</span> {title}
        </h2>
        <span className="text-sm font-normal text-muted-foreground">{count}</span>
        <div className="ml-auto flex items-center gap-1">
          {headerActions}
        </div>
      </div>

      {!collapsed && (
        <div className="flex flex-col gap-2 flex-1 mt-2">
          {children}
        </div>
      )}
    </div>
  );
}
