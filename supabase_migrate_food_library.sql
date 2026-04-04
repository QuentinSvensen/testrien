-- Script de migration uniquement (à exécuter si la table food_library est déjà créée)
-- Importe tous les aliments existants dans la bibliothèque

INSERT INTO food_library (user_id, name, food_type, is_meal, no_counter, storage_type)
SELECT DISTINCT ON (user_id, name)
    user_id,
    name,
    food_type,
    is_meal,
    no_counter,
    storage_type
FROM food_items
WHERE user_id IS NOT NULL
  AND name IS NOT NULL
  AND name <> ''
ON CONFLICT (user_id, name) DO UPDATE SET
    food_type    = EXCLUDED.food_type,
    is_meal      = EXCLUDED.is_meal,
    no_counter   = EXCLUDED.no_counter,
    storage_type = EXCLUDED.storage_type,
    updated_at   = now();
