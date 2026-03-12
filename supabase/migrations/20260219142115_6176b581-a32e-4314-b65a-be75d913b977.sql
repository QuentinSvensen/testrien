-- Add server-side length constraints on name columns
ALTER TABLE public.meals
  ADD CONSTRAINT meals_name_length
  CHECK (char_length(name) > 0 AND char_length(name) <= 100);

ALTER TABLE public.food_items
  ADD CONSTRAINT food_items_name_length
  CHECK (char_length(name) > 0 AND char_length(name) <= 100);

ALTER TABLE public.shopping_items
  ADD CONSTRAINT shopping_items_name_length
  CHECK (char_length(name) > 0 AND char_length(name) <= 100);

ALTER TABLE public.shopping_groups
  ADD CONSTRAINT shopping_groups_name_length
  CHECK (char_length(name) > 0 AND char_length(name) <= 100);
