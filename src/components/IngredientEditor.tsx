import { useRef, useState } from "react";
import { GripVertical } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { IngLine } from "@/lib/ingredientUtils";

interface IngredientEditorProps {
  lines: IngLine[];
  onUpdate: (lines: IngLine[]) => void;
  onCommit: () => void;
}

/**
 * Shared ingredient editing grid used by MealCard and PossibleMealCard.
 * Supports drag & drop reordering of ingredient lines.
 */
export function IngredientEditor({ lines, onUpdate, onCommit }: IngredientEditorProps) {
  const qtyRefs = useRef<(HTMLInputElement | null)[]>([]);
  const countRefs = useRef<(HTMLInputElement | null)[]>([]);
  const nameRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const updateLine = (idx: number, field: "qty" | "count" | "name" | "cal" | "pro", value: string) => {
    const next = [...lines];
    next[idx] = { ...next[idx], [field]: value };
    if (field === "name" && idx === next.length - 1 && value.trim()) {
      next.push({ qty: "", count: "", name: "", cal: "", pro: "", isOr: false, isOptional: false });
    }
    onUpdate(next);
  };

  const toggleOr = (idx: number) => {
    if (idx === 0) return;
    const next = [...lines];
    next[idx] = { ...next[idx], isOr: !next[idx].isOr };
    onUpdate(next);
  };

  const toggleOptional = (idx: number) => {
    const next = [...lines];
    next[idx] = { ...next[idx], isOptional: !next[idx].isOptional };
    onUpdate(next);
  };

  const handleKeyDown = (idx: number, field: "qty" | "count" | "name", e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (field === "qty") countRefs.current[idx]?.focus();
      else if (field === "count") nameRefs.current[idx]?.focus();
      else if (idx < lines.length - 1) qtyRefs.current[idx + 1]?.focus();
      else if (lines[idx].name.trim()) setTimeout(() => qtyRefs.current[idx + 1]?.focus(), 0);
      else onCommit();
    }
    if (e.key === "Escape") onCommit();
  };

  const handleDragStart = (e: React.DragEvent, idx: number) => {
    e.dataTransfer.effectAllowed = "move";
    setDragIdx(idx);
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverIdx(idx);
  };

  const handleDrop = (e: React.DragEvent, targetIdx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === targetIdx) { setDragIdx(null); setDragOverIdx(null); return; }
    const next = [...lines];
    const [moved] = next.splice(dragIdx, 1);
    next.splice(targetIdx, 0, moved);
    onUpdate(next);
    setDragIdx(null);
    setDragOverIdx(null);
  };

  const handleDragEnd = () => {
    setDragIdx(null);
    setDragOverIdx(null);
  };

  return (
    <div
      onBlur={(e) => {
        // Delay to allow focus to settle (e.g. clicking drag handle)
        setTimeout(() => {
          const container = e.currentTarget;
          if (container && !container.contains(document.activeElement)) onCommit();
        }, 100);
      }}
      className="flex flex-col gap-1"
    >
      <div className="grid grid-cols-[0.8rem_1.2rem_0.8rem_2.5rem_1.8rem_1fr_2rem_2rem] gap-x-0.5 gap-y-0.5 mb-0.5 pl-0 pr-0">
        <span className="text-[8px] text-white/50 text-center"></span>
        <span className="text-[8px] text-white/50 text-center">Ou</span>
        <span className="text-[8px] text-white/50 text-center">?</span>
        <span className="text-[8px] text-white/50 text-center">g</span>
        <span className="text-[8px] text-white/50 text-center">#</span>
        <span className="text-[8px] text-white/50">Nom</span>
        <span className="text-[8px] text-white/50 text-center">Cal</span>
        <span className="text-[8px] text-white/50 text-center">P</span>
      </div>
      {lines.map((line, idx) => (
        <div
          key={idx}
          draggable
          onDragStart={(e) => handleDragStart(e, idx)}
          onDragOver={(e) => handleDragOver(e, idx)}
          onDrop={(e) => handleDrop(e, idx)}
          onDragEnd={handleDragEnd}
          className={`grid grid-cols-[0.8rem_1.2rem_0.8rem_2.5rem_1.8rem_1fr_2rem_2rem] gap-x-0.5 gap-y-0.5 pl-0 pr-0 transition-opacity ${
            dragIdx === idx ? 'opacity-30' : ''
          } ${dragOverIdx === idx && dragIdx !== idx ? 'border-t-2 border-yellow-300/60' : ''}`}
        >
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()}
            className="h-7 flex items-center justify-center cursor-grab active:cursor-grabbing text-white/30 hover:text-white/60"
          >
            <GripVertical className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => toggleOr(idx)}
            className={`h-7 flex items-center justify-center rounded text-[9px] font-bold transition-all ${
              idx === 0
                ? 'text-white/15 cursor-default'
                : line.isOr
                  ? 'bg-yellow-400/30 text-yellow-200 border border-yellow-400/50'
                  : 'text-white/30 hover:text-white/60 hover:bg-white/10'
            }`}
            disabled={idx === 0}
            title={idx === 0 ? "" : line.isOr ? "Cet ingrédient est un OU du précédent" : "Marquer comme alternative (OU)"}
          >
            {line.isOr ? "ou" : idx > 0 ? "+" : ""}
          </button>
          <button
            type="button"
            onClick={() => toggleOptional(idx)}
            className={`h-7 flex items-center justify-center rounded text-[9px] font-bold transition-all ${
              line.isOptional
                ? 'bg-purple-400/30 text-purple-200 border border-purple-400/50'
                : 'text-white/20 hover:text-white/50 hover:bg-white/10'
            }`}
            title="Ingrédient optionnel"
          >
            ?
          </button>
          <Input
            ref={el => { qtyRefs.current[idx] = el; }}
            autoFocus={idx === 0}
            placeholder="g"
            inputMode="decimal"
            value={line.qty}
            onChange={e => updateLine(idx, "qty", e.target.value)}
            onKeyDown={e => handleKeyDown(idx, "qty", e)}
            className="h-7 border-white/30 bg-white/20 text-white placeholder:text-white/40 text-xs px-1.5"
          />
          <Input
            ref={el => { countRefs.current[idx] = el; }}
            placeholder="#"
            inputMode="numeric"
            value={line.count}
            onChange={e => updateLine(idx, "count", e.target.value)}
            onKeyDown={e => handleKeyDown(idx, "count", e)}
            className="h-7 border-white/30 bg-white/20 text-white placeholder:text-white/40 text-xs px-1"
          />
          <Input
            ref={el => { nameRefs.current[idx] = el; }}
            placeholder={`Ingrédient ${idx + 1}`}
            value={line.name}
            onChange={e => updateLine(idx, "name", e.target.value)}
            onKeyDown={e => handleKeyDown(idx, "name", e)}
            className="h-7 border-white/30 bg-white/20 text-white placeholder:text-white/40 text-xs px-2"
          />
          <Input
            placeholder="cal"
            inputMode="decimal"
            value={line.cal}
            onChange={e => updateLine(idx, "cal", e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") onCommit(); if (e.key === "Escape") onCommit(); }}
            className="h-7 border-white/30 bg-white/20 text-white placeholder:text-white/40 text-[10px] px-1"
          />
          <Input
            placeholder="prot"
            inputMode="decimal"
            value={line.pro}
            onChange={e => updateLine(idx, "pro", e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") onCommit(); if (e.key === "Escape") onCommit(); }}
            className="h-7 border-white/30 bg-blue-500/20 text-white placeholder:text-white/40 text-[10px] px-1"
          />
        </div>
      ))}
      <button onClick={onCommit} className="text-[10px] text-white/60 hover:text-white text-left mt-0.5">✓ Valider</button>
    </div>
  );
}
