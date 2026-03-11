
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meals_category_valid') THEN
    ALTER TABLE public.meals ADD CONSTRAINT meals_category_valid CHECK (category IN ('petit_dejeuner', 'entree', 'plat', 'dessert', 'bonus'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'food_items_storage_type_valid') THEN
    ALTER TABLE public.food_items ADD CONSTRAINT food_items_storage_type_valid CHECK (storage_type IN ('frigo', 'sec', 'surgele', 'toujours'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'possible_meals_day_valid') THEN
    ALTER TABLE public.possible_meals ADD CONSTRAINT possible_meals_day_valid CHECK (day_of_week IS NULL OR day_of_week IN ('lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'possible_meals_time_valid') THEN
    ALTER TABLE public.possible_meals ADD CONSTRAINT possible_meals_time_valid CHECK (meal_time IS NULL OR meal_time IN ('midi', 'soir'));
  END IF;
END $$;
