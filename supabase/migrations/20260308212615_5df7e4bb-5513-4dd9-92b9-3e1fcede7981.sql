
-- Drop all RESTRICTIVE policies and recreate as PERMISSIVE

-- food_items
DROP POLICY IF EXISTS "Auth users can view food_items" ON public.food_items;
DROP POLICY IF EXISTS "Auth users can insert food_items" ON public.food_items;
DROP POLICY IF EXISTS "Auth users can update food_items" ON public.food_items;
DROP POLICY IF EXISTS "Auth users can delete food_items" ON public.food_items;

CREATE POLICY "Auth users can view food_items" ON public.food_items FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can insert food_items" ON public.food_items FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can update food_items" ON public.food_items FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can delete food_items" ON public.food_items FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

-- meals
DROP POLICY IF EXISTS "Auth users can view meals" ON public.meals;
DROP POLICY IF EXISTS "Auth users can insert meals" ON public.meals;
DROP POLICY IF EXISTS "Auth users can update meals" ON public.meals;
DROP POLICY IF EXISTS "Auth users can delete meals" ON public.meals;

CREATE POLICY "Auth users can view meals" ON public.meals FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can insert meals" ON public.meals FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can update meals" ON public.meals FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can delete meals" ON public.meals FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

-- possible_meals
DROP POLICY IF EXISTS "Auth users can view possible_meals" ON public.possible_meals;
DROP POLICY IF EXISTS "Auth users can insert possible_meals" ON public.possible_meals;
DROP POLICY IF EXISTS "Auth users can update possible_meals" ON public.possible_meals;
DROP POLICY IF EXISTS "Auth users can delete possible_meals" ON public.possible_meals;

CREATE POLICY "Auth users can view possible_meals" ON public.possible_meals FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can insert possible_meals" ON public.possible_meals FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can update possible_meals" ON public.possible_meals FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can delete possible_meals" ON public.possible_meals FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

-- shopping_groups
DROP POLICY IF EXISTS "Auth users can view shopping_groups" ON public.shopping_groups;
DROP POLICY IF EXISTS "Auth users can insert shopping_groups" ON public.shopping_groups;
DROP POLICY IF EXISTS "Auth users can update shopping_groups" ON public.shopping_groups;
DROP POLICY IF EXISTS "Auth users can delete shopping_groups" ON public.shopping_groups;

CREATE POLICY "Auth users can view shopping_groups" ON public.shopping_groups FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can insert shopping_groups" ON public.shopping_groups FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can update shopping_groups" ON public.shopping_groups FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can delete shopping_groups" ON public.shopping_groups FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

-- shopping_items
DROP POLICY IF EXISTS "Auth users can view shopping_items" ON public.shopping_items;
DROP POLICY IF EXISTS "Auth users can insert shopping_items" ON public.shopping_items;
DROP POLICY IF EXISTS "Auth users can update shopping_items" ON public.shopping_items;
DROP POLICY IF EXISTS "Auth users can delete shopping_items" ON public.shopping_items;

CREATE POLICY "Auth users can view shopping_items" ON public.shopping_items FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can insert shopping_items" ON public.shopping_items FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can update shopping_items" ON public.shopping_items FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can delete shopping_items" ON public.shopping_items FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

-- user_preferences
DROP POLICY IF EXISTS "Users can view own preferences" ON public.user_preferences;
DROP POLICY IF EXISTS "Users can insert own preferences" ON public.user_preferences;
DROP POLICY IF EXISTS "Users can update own preferences" ON public.user_preferences;
DROP POLICY IF EXISTS "Users can delete own preferences" ON public.user_preferences;

CREATE POLICY "Users can view own preferences" ON public.user_preferences FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Users can insert own preferences" ON public.user_preferences FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Users can update own preferences" ON public.user_preferences FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Users can delete own preferences" ON public.user_preferences FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);
