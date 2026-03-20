
-- Drop old permissive "Anyone can" policies from all tables
DROP POLICY IF EXISTS "Anyone can view meals" ON public.meals;
DROP POLICY IF EXISTS "Anyone can insert meals" ON public.meals;
DROP POLICY IF EXISTS "Anyone can update meals" ON public.meals;
DROP POLICY IF EXISTS "Anyone can delete meals" ON public.meals;

DROP POLICY IF EXISTS "Anyone can view possible_meals" ON public.possible_meals;
DROP POLICY IF EXISTS "Anyone can insert possible_meals" ON public.possible_meals;
DROP POLICY IF EXISTS "Anyone can update possible_meals" ON public.possible_meals;
DROP POLICY IF EXISTS "Anyone can delete possible_meals" ON public.possible_meals;

DROP POLICY IF EXISTS "Anyone can select shopping_groups" ON public.shopping_groups;
DROP POLICY IF EXISTS "Anyone can insert shopping_groups" ON public.shopping_groups;
DROP POLICY IF EXISTS "Anyone can update shopping_groups" ON public.shopping_groups;
DROP POLICY IF EXISTS "Anyone can delete shopping_groups" ON public.shopping_groups;

DROP POLICY IF EXISTS "Anyone can select shopping_items" ON public.shopping_items;
DROP POLICY IF EXISTS "Anyone can insert shopping_items" ON public.shopping_items;
DROP POLICY IF EXISTS "Anyone can update shopping_items" ON public.shopping_items;
DROP POLICY IF EXISTS "Anyone can delete shopping_items" ON public.shopping_items;

-- Add user_id columns to all tables (IF NOT EXISTS to avoid errors if already present)
ALTER TABLE public.meals ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT auth.uid();
ALTER TABLE public.possible_meals ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT auth.uid();
ALTER TABLE public.shopping_groups ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT auth.uid();
ALTER TABLE public.shopping_items ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT auth.uid();

-- Ensure user-scoped policies exist on meals
DROP POLICY IF EXISTS "Users can view own meals" ON public.meals;
DROP POLICY IF EXISTS "Users can insert own meals" ON public.meals;
DROP POLICY IF EXISTS "Users can update own meals" ON public.meals;
DROP POLICY IF EXISTS "Users can delete own meals" ON public.meals;

CREATE POLICY "Users can view own meals" ON public.meals
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own meals" ON public.meals
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own meals" ON public.meals
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own meals" ON public.meals
  FOR DELETE USING (auth.uid() = user_id);

-- Ensure user-scoped policies exist on possible_meals
DROP POLICY IF EXISTS "Users can view own possible_meals" ON public.possible_meals;
DROP POLICY IF EXISTS "Users can insert own possible_meals" ON public.possible_meals;
DROP POLICY IF EXISTS "Users can update own possible_meals" ON public.possible_meals;
DROP POLICY IF EXISTS "Users can delete own possible_meals" ON public.possible_meals;

CREATE POLICY "Users can view own possible_meals" ON public.possible_meals
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own possible_meals" ON public.possible_meals
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own possible_meals" ON public.possible_meals
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own possible_meals" ON public.possible_meals
  FOR DELETE USING (auth.uid() = user_id);

-- Ensure user-scoped policies exist on shopping_groups
DROP POLICY IF EXISTS "Users can view own shopping_groups" ON public.shopping_groups;
DROP POLICY IF EXISTS "Users can insert own shopping_groups" ON public.shopping_groups;
DROP POLICY IF EXISTS "Users can update own shopping_groups" ON public.shopping_groups;
DROP POLICY IF EXISTS "Users can delete own shopping_groups" ON public.shopping_groups;

CREATE POLICY "Users can view own shopping_groups" ON public.shopping_groups
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own shopping_groups" ON public.shopping_groups
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own shopping_groups" ON public.shopping_groups
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own shopping_groups" ON public.shopping_groups
  FOR DELETE USING (auth.uid() = user_id);

-- Ensure user-scoped policies exist on shopping_items
DROP POLICY IF EXISTS "Users can view own shopping_items" ON public.shopping_items;
DROP POLICY IF EXISTS "Users can insert own shopping_items" ON public.shopping_items;
DROP POLICY IF EXISTS "Users can update own shopping_items" ON public.shopping_items;
DROP POLICY IF EXISTS "Users can delete own shopping_items" ON public.shopping_items;

CREATE POLICY "Users can view own shopping_items" ON public.shopping_items
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own shopping_items" ON public.shopping_items
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own shopping_items" ON public.shopping_items
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own shopping_items" ON public.shopping_items
  FOR DELETE USING (auth.uid() = user_id);
