

# 🍽️ Mon Gestionnaire de Repas

## Concept
Une application colorée et fun pour gérer tes repas selon ce que tu as dans le frigo. Deux listes de cartes côte à côte : tous tes repas d'un côté, les repas possibles de l'autre.

---

## Pages & Layout

### Page principale — Vue en deux colonnes
- **Colonne gauche : "Tous mes repas"** — La liste complète de tous tes repas enregistrés
- **Colonne droite : "Repas possibles 🍳"** — Les repas que tu peux faire avec ce que tu as dans le frigo
- Header avec le titre de l'app et un bouton pour ajouter un nouveau repas

### Cartes de repas
- Chaque carte affiche le **nom du repas** avec un fond coloré aléatoire parmi une palette fun
- Bouton pour **déplacer** la carte vers l'autre liste (flèche droite/gauche)
- Menu d'actions (3 points) pour **modifier le nom** ou **supprimer** la carte
- **Drag & drop** entre les deux listes en plus des boutons

---

## Fonctionnalités

1. **Ajouter un repas** — Bouton + formulaire simple pour créer une nouvelle carte dans "Tous mes repas"
2. **Déplacer un repas** — Clic sur un bouton flèche OU drag & drop pour basculer entre les deux listes
3. **Modifier un repas** — Éditer le nom d'une carte directement
4. **Supprimer un repas** — Retirer définitivement une carte
5. **Persistance des données** — Sauvegarde via Supabase pour ne rien perdre

---

## Backend (Supabase / Lovable Cloud)

- **Table `meals`** : id, name, is_available (booléen pour savoir dans quelle liste se trouve le repas), created_at
- Pas d'authentification pour commencer (accès libre)

---

## Style visuel
- Palette de couleurs vives et variées pour les cartes (rose, orange, vert, bleu, violet…)
- Coins arrondis, ombres douces, typographie amicale
- Responsive : sur mobile, les deux listes s'empilent verticalement
- Animations fluides lors du déplacement des cartes

