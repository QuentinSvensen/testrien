export function colorFromName(name: string): string {
  if (!name || !name.trim()) return "#374151"; // Default slate-700

  const trimmedName = name.trim();
  const firstChar = trimmedName.charAt(0).toLowerCase();
  
  // 1. Generate hash from full trimmed name
  let hash = 0;
  for (let i = 0; i < trimmedName.length; i++) {
    hash = trimmedName.charCodeAt(i) + ((hash << 5) - hash);
  }
  hash = Math.abs(hash);

  // 2. Hue: 0-360 based on name hash (provides full rainbow diversity)
  const hue = hash % 360;

  // 3. Saturation: 35-55% (Softer, less neon)
  const saturation = 35 + (hash % 21);
  
  // 4. Lightness: 25-35% (Good contrast with white text)
  const lightness = 25 + (hash % 11);

  return `hsl(${Math.round(hue)}, ${saturation}%, ${lightness}%)`;
}
