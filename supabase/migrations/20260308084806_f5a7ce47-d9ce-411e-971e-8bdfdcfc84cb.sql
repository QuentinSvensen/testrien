
ALTER TABLE public.food_items ADD COLUMN IF NOT EXISTS protein text DEFAULT NULL;
ALTER TABLE public.meals ADD COLUMN IF NOT EXISTS protein text DEFAULT NULL;
ALTER TABLE public.food_items ADD COLUMN IF NOT EXISTS is_indivisible boolean NOT NULL DEFAULT false;
