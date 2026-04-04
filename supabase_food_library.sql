-- ============================================================
-- Table food_library : Bibliothèque d'aliments avec mémoire
-- des préférences (type, repas, compteur, rangement).
-- ============================================================

CREATE TABLE IF NOT EXISTS food_library (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  food_type TEXT,                        -- 'feculent', 'viande', ou null
  is_meal BOOLEAN DEFAULT false,
  no_counter BOOLEAN DEFAULT false,
  storage_type TEXT DEFAULT 'frigo',     -- 'frigo', 'sec', 'surgele', 'extras', 'toujours'
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, name)
);

-- RLS (Row Level Security)
ALTER TABLE food_library ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'food_library' 
    AND policyname = 'Users can manage their own food library'
  ) THEN
    CREATE POLICY "Users can manage their own food library"
      ON food_library FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- Trigger pour auto-remplir user_id à l'insertion
CREATE OR REPLACE FUNCTION set_food_library_user_id()
RETURNS TRIGGER AS $$
BEGIN
  NEW.user_id := auth.uid();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'food_library_set_user_id'
  ) THEN
    CREATE TRIGGER food_library_set_user_id
      BEFORE INSERT ON food_library
      FOR EACH ROW EXECUTE FUNCTION set_food_library_user_id();
  END IF;
END $$;

-- ============================================================
-- Migration : peupler la bibliothèque avec les aliments existants
-- ============================================================
INSERT INTO food_library (user_id, name, food_type, is_meal, no_counter, storage_type)
SELECT DISTINCT ON (user_id, name) 
    user_id, 
    name, 
    food_type, 
    is_meal, 
    no_counter, 
    storage_type
FROM food_items
ON CONFLICT (user_id, name) DO NOTHING;

