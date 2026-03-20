
-- Replace overly permissive anonymous RLS policies with authenticated-user-only policies
-- This blocks direct anonymous API access while keeping the app working after PIN auth returns a real session

-- ===== MEALS =====
DROP POLICY IF EXISTS "Anon can view meals" ON public.meals;
DROP POLICY IF EXISTS "Anon can insert meals" ON public.meals;
DROP POLICY IF EXISTS "Anon can update meals" ON public.meals;
DROP POLICY IF EXISTS "Anon can delete meals" ON public.meals;

CREATE POLICY "Auth users can view meals" ON public.meals
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Auth users can insert meals" ON public.meals
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Auth users can update meals" ON public.meals
  FOR UPDATE USING (auth.uid() IS NOT NULL);

CREATE POLICY "Auth users can delete meals" ON public.meals
  FOR DELETE USING (auth.uid() IS NOT NULL);

-- ===== POSSIBLE_MEALS =====
DROP POLICY IF EXISTS "Anon can view possible_meals" ON public.possible_meals;
DROP POLICY IF EXISTS "Anon can insert possible_meals" ON public.possible_meals;
DROP POLICY IF EXISTS "Anon can update possible_meals" ON public.possible_meals;
DROP POLICY IF EXISTS "Anon can delete possible_meals" ON public.possible_meals;

CREATE POLICY "Auth users can view possible_meals" ON public.possible_meals
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Auth users can insert possible_meals" ON public.possible_meals
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Auth users can update possible_meals" ON public.possible_meals
  FOR UPDATE USING (auth.uid() IS NOT NULL);

CREATE POLICY "Auth users can delete possible_meals" ON public.possible_meals
  FOR DELETE USING (auth.uid() IS NOT NULL);

-- ===== SHOPPING_GROUPS =====
DROP POLICY IF EXISTS "Anon can view shopping_groups" ON public.shopping_groups;
DROP POLICY IF EXISTS "Anon can insert shopping_groups" ON public.shopping_groups;
DROP POLICY IF EXISTS "Anon can update shopping_groups" ON public.shopping_groups;
DROP POLICY IF EXISTS "Anon can delete shopping_groups" ON public.shopping_groups;

CREATE POLICY "Auth users can view shopping_groups" ON public.shopping_groups
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Auth users can insert shopping_groups" ON public.shopping_groups
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Auth users can update shopping_groups" ON public.shopping_groups
  FOR UPDATE USING (auth.uid() IS NOT NULL);

CREATE POLICY "Auth users can delete shopping_groups" ON public.shopping_groups
  FOR DELETE USING (auth.uid() IS NOT NULL);

-- ===== SHOPPING_ITEMS =====
DROP POLICY IF EXISTS "Anon can view shopping_items" ON public.shopping_items;
DROP POLICY IF EXISTS "Anon can insert shopping_items" ON public.shopping_items;
DROP POLICY IF EXISTS "Anon can update shopping_items" ON public.shopping_items;
DROP POLICY IF EXISTS "Anon can delete shopping_items" ON public.shopping_items;

CREATE POLICY "Auth users can view shopping_items" ON public.shopping_items
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Auth users can insert shopping_items" ON public.shopping_items
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Auth users can update shopping_items" ON public.shopping_items
  FOR UPDATE USING (auth.uid() IS NOT NULL);

CREATE POLICY "Auth users can delete shopping_items" ON public.shopping_items
  FOR DELETE USING (auth.uid() IS NOT NULL);
