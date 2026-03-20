
-- Drop existing restrictive policies and replace with anon-friendly ones
-- (No auth system yet; PIN is the access control layer)

-- meals
DROP POLICY IF EXISTS "Users can view own meals" ON public.meals;
DROP POLICY IF EXISTS "Users can insert own meals" ON public.meals;
DROP POLICY IF EXISTS "Users can update own meals" ON public.meals;
DROP POLICY IF EXISTS "Users can delete own meals" ON public.meals;

CREATE POLICY "Anon can view meals" ON public.meals FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can insert meals" ON public.meals FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Anon can update meals" ON public.meals FOR UPDATE TO anon USING (true);
CREATE POLICY "Anon can delete meals" ON public.meals FOR DELETE TO anon USING (true);

-- possible_meals
DROP POLICY IF EXISTS "Users can view own possible_meals" ON public.possible_meals;
DROP POLICY IF EXISTS "Users can insert own possible_meals" ON public.possible_meals;
DROP POLICY IF EXISTS "Users can update own possible_meals" ON public.possible_meals;
DROP POLICY IF EXISTS "Users can delete own possible_meals" ON public.possible_meals;

CREATE POLICY "Anon can view possible_meals" ON public.possible_meals FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can insert possible_meals" ON public.possible_meals FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Anon can update possible_meals" ON public.possible_meals FOR UPDATE TO anon USING (true);
CREATE POLICY "Anon can delete possible_meals" ON public.possible_meals FOR DELETE TO anon USING (true);

-- shopping_groups
DROP POLICY IF EXISTS "Users can view own shopping_groups" ON public.shopping_groups;
DROP POLICY IF EXISTS "Users can insert own shopping_groups" ON public.shopping_groups;
DROP POLICY IF EXISTS "Users can update own shopping_groups" ON public.shopping_groups;
DROP POLICY IF EXISTS "Users can delete own shopping_groups" ON public.shopping_groups;

CREATE POLICY "Anon can view shopping_groups" ON public.shopping_groups FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can insert shopping_groups" ON public.shopping_groups FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Anon can update shopping_groups" ON public.shopping_groups FOR UPDATE TO anon USING (true);
CREATE POLICY "Anon can delete shopping_groups" ON public.shopping_groups FOR DELETE TO anon USING (true);

-- shopping_items
DROP POLICY IF EXISTS "Users can view own shopping_items" ON public.shopping_items;
DROP POLICY IF EXISTS "Users can insert own shopping_items" ON public.shopping_items;
DROP POLICY IF EXISTS "Users can update own shopping_items" ON public.shopping_items;
DROP POLICY IF EXISTS "Users can delete own shopping_items" ON public.shopping_items;

CREATE POLICY "Anon can view shopping_items" ON public.shopping_items FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can insert shopping_items" ON public.shopping_items FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Anon can update shopping_items" ON public.shopping_items FOR UPDATE TO anon USING (true);
CREATE POLICY "Anon can delete shopping_items" ON public.shopping_items FOR DELETE TO anon USING (true);
