/**
 * ThemeToggle — Badge d'affichage de la date du jour.
 *
 * Affiche le jour de la semaine abrégé (ex: "Lun") et le numéro
 * du jour dans un badge compact. Utilisé dans la barre de navigation.
 */
import { format } from "date-fns";
import { fr } from "date-fns/locale";

export function ThemeToggle() {
  const today = new Date();
  const dayName = format(today, 'EEE', { locale: fr });
  const dayNum = format(today, 'd');

  return (
    <div className="flex items-center gap-1 bg-muted/60 rounded-full px-2.5 py-1 text-foreground select-none">
      <span className="text-[10px] font-semibold capitalize">{dayName}</span>
      <span className="text-sm font-black">{dayNum}</span>
    </div>
  );
}
