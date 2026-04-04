/**
 * colorFromName — Génère une couleur HSL déterministe à partir d'un nom.
 *
 * Utilise un hash du nom complet pour calculer teinte (0-360),
 * saturation (35-55%) et luminosité (25-35%), garantissant un bon
 * contraste avec le texte blanc et une diversité visuelle maximale.
 */
export function colorFromName(name: string): string {
  if (!name || !name.trim()) return "#374151"; // Ardoise-700 par défaut

  const trimmedName = name.trim();
  const firstChar = trimmedName.charAt(0).toLowerCase();
  
  // 1. Générer le hash à partir du nom complet nettoyé
  let hash = 0;
  for (let i = 0; i < trimmedName.length; i++) {
    hash = trimmedName.charCodeAt(i) + ((hash << 5) - hash);
  }
  hash = Math.abs(hash);

  // 2. Teinte : 0-360 basée sur le hash du nom (offre une diversité arc-en-ciel complète)
  const hue = hash % 360;

  // 3. Saturation : 35-55% (Plus doux, moins néon)
  const saturation = 35 + (hash % 21);
  
  // 4. Luminosité : 25-35% (Bon contraste avec le texte blanc)
  const lightness = 25 + (hash % 11);

  return `hsl(${Math.round(hue)}, ${saturation}%, ${lightness}%)`;
}
